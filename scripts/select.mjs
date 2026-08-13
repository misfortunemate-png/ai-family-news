#!/usr/bin/env node
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { dump as yamlDump } from 'js-yaml';
import { readJsonl, appendJsonl } from './lib/jsonl.mjs';
import { budgetCheck, recordCost } from './lib/guard.mjs';

const DATE = new Date().toISOString().slice(0, 10);
const ITEMS_FILE = join('data', 'items', `${DATE}.jsonl`);
const CANDIDATES_FILE = join('data', 'candidates', `${DATE}.yaml`);
const REJECTS_FILE = join('logs', 'rejects', `${DATE}-select.jsonl`);

const DRY_RUN = process.env.DRY_RUN === '1';
const API_KEY = process.env.OPENROUTER_API_KEY ?? '';
const MODEL = 'deepseek/deepseek-v4-flash';

const PREF_MAX = 27;
const EXPLORE_COUNT = 3;
const MAX_PER_SOURCE = 8;
const MAX_CANDIDATES = 30;

async function reject(id, sourceId, reason) {
  await appendJsonl(REJECTS_FILE, { ts: new Date().toISOString(), id, source_id: sourceId, reason });
}

// 過去7日のitemsからid一覧を収集
async function pastIds() {
  const ids = new Set();
  try {
    const files = await readdir('data/items');
    const now = Date.now();
    for (const f of files) {
      if (!f.endsWith('.jsonl') || f === `${DATE}.jsonl`) continue;
      const d = new Date(f.replace('.jsonl', '')).getTime();
      if (now - d > 7 * 86400_000) continue;
      const rows = await readJsonl(join('data', 'items', f));
      for (const r of rows) ids.add(r.id);
    }
  } catch { /* no past data */ }
  return ids;
}

// rawContentを前処理: <think>ブロック・markdownコードフェンス・前後ガベージを除去し
// JSONとして解釈できる最初の文字列を返す
function preprocessContent(raw) {
  let s = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')   // DeepSeekの思考ブロック除去
    .replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1') // markdownコードフェンス除去
    .trim();

  // 先頭に JSON 構造（[ または {）が来るよう先頭ガベージを刈る
  const arrPos = s.indexOf('[');
  const objPos = s.indexOf('{');
  const start = (arrPos >= 0 && (objPos < 0 || arrPos < objPos)) ? arrPos : objPos;
  if (start > 0) s = s.slice(start);
  return s;
}

// オブジェクトを再帰的に探索して配列値を返す（深さ制限付き）
function deepFindArray(obj, depth = 0) {
  if (depth > 5 || obj == null) return null;
  for (const val of Object.values(obj)) {
    if (Array.isArray(val) && val.length > 0) return val;
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const found = deepFindArray(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// 5段階パーサー。nullを返したら呼び出し元でparse_fallback縮退
function parseScoreResponse(rawContent) {
  console.log('[scoreWithLlm] raw (先頭500字):', rawContent.slice(0, 500));
  const content = preprocessContent(rawContent);

  // ① JSON.parse → 配列ならそのまま
  let parsed = null;
  try { parsed = JSON.parse(content); } catch { /* 次へ */ }

  if (Array.isArray(parsed) && parsed.length > 0) {
    console.log('[scoreWithLlm] ①配列直接');
    return parsed;
  }

  // ② オブジェクトの値に配列があれば採用
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const arr = deepFindArray(parsed);
    if (arr) {
      console.log('[scoreWithLlm] ②オブジェクト内配列');
      return arr;
    }

    // ③ id と score を持つ単一オブジェクトなら [obj] に包む
    if ('id' in parsed && 'score' in parsed) {
      console.log('[scoreWithLlm] ③単一オブジェクト→配列化');
      return [parsed];
    }
  }

  // ④ 改行分割してJSONL解析
  const lines = rawContent.split('\n').map(l => l.trim()).filter(Boolean);
  const jsonlItems = [];
  for (const line of lines) {
    if (!line.startsWith('{') && !line.startsWith('[')) continue;
    try {
      const obj = JSON.parse(line);
      if (Array.isArray(obj)) jsonlItems.push(...obj);
      else if (obj && typeof obj === 'object') jsonlItems.push(obj);
    } catch { /* skip */ }
  }
  if (jsonlItems.length > 0) {
    console.log(`[scoreWithLlm] ④JSONL ${jsonlItems.length}行`);
    return jsonlItems;
  }

  // ⑤ 全失敗
  console.error('[scoreWithLlm] ⑤パース全失敗。content先頭:', content.slice(0, 200));
  return null;
}

// 各要素にidとscoreがあることを検証。不正要素は除外してログ
function validateScoreItems(arr) {
  const valid = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      console.warn('[scoreWithLlm] 不正要素スキップ (非オブジェクト):', String(item).slice(0, 80));
      continue;
    }
    if (!('id' in item)) {
      console.warn('[scoreWithLlm] id欠落スキップ:', JSON.stringify(item).slice(0, 100));
      continue;
    }
    if (!('score' in item)) {
      console.warn('[scoreWithLlm] score欠落スキップ:', JSON.stringify(item).slice(0, 100));
      continue;
    }
    valid.push(item);
  }
  if (valid.length < arr.length) {
    console.log(`[scoreWithLlm] 検証: ${arr.length}件中 ${valid.length}件有効`);
  }
  return valid;
}

// nullを返したら呼び出し元でparse_fallback縮退
async function scoreWithLlm(items, preferences) {
  const payload = {
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `あなたはニュース採点者です。以下の嗜好文書に基づき、各記事を0-100で採点してください。\n\n${preferences}\n\n出力はJSON配列のみ。各要素: {"id": "...", "score": 0-100, "reason_code": "英単語1語", "category": "ai|dev|construction|game|food|weather|world|other"}`,
      },
      {
        role: 'user',
        content: JSON.stringify(items.map(i => ({ id: i.id, title: i.title, summary: i.summary }))),
      },
    ],
    response_format: { type: 'json_object' },
    reasoning: { enabled: false },
  };

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
  const json = await res.json();
  const usage = json.usage ?? {};
  const costUsd = usage.cost ?? ((usage.prompt_tokens ?? 0) * 0.00000014 + (usage.completion_tokens ?? 0) * 0.00000028);

  await recordCost({
    ts: new Date().toISOString(),
    job: 'select',
    model: MODEL,
    usage,
    cost_usd: costUsd,
  });

  const rawContent = json.choices?.[0]?.message?.content ?? '';
  const arr = parseScoreResponse(rawContent);
  if (!arr) return null;

  const valid = validateScoreItems(arr);
  if (valid.length === 0) {
    console.error('[scoreWithLlm] 有効要素ゼロ');
    return null;
  }
  return valid;
}

async function main() {
  const items = await readJsonl(ITEMS_FILE);
  if (items.length === 0) {
    console.log('[select] itemsが空。終了。');
    return;
  }

  // fixed アイテムを分離
  const fixed = items.filter(i => i.fixed);
  const scorable = items.filter(i => !i.fixed);

  // 予算ガード
  const stopped = await budgetCheck(DATE);

  // 重複排除
  const seen = await pastIds();
  const todayIds = new Set();
  const deduped = [];
  for (const item of scorable) {
    if (seen.has(item.id) || todayIds.has(item.id)) {
      await reject(item.id, item.source_id, 'duplicate');
      continue;
    }
    todayIds.add(item.id);
    deduped.push(item);
  }

  // 鮮度フィルタ
  const now = Date.now();
  const fresh = [];
  for (const item of deduped) {
    if (!item.published_at) { fresh.push(item); continue; }
    const age = now - new Date(item.published_at).getTime();
    // sources.yamlのfreshness_hoursは現状未実装: 48h固定
    if (age > 48 * 3600_000) {
      await reject(item.id, item.source_id, 'stale');
      continue;
    }
    fresh.push(item);
  }

  let scored;
  if (DRY_RUN || stopped) {
    // dry-run: score=null, 鮮度順
    const sorted = [...fresh].sort((a, b) =>
      new Date(b.published_at ?? 0) - new Date(a.published_at ?? 0)
    );
    scored = sorted.map(i => ({ ...i, score: null, reason_code: 'dry_run', category: i.category }));
  } else {
    // LLM採点
    const preferences = await readFile('profile/preferences.md', 'utf8');
    const results = await scoreWithLlm(fresh, preferences);

    if (results === null) {
      // パース失敗 → dry-run縮退、全件 parse_fallback 記帳
      console.warn('[select] LLM応答パース失敗。dry-run縮退で続行。');
      for (const item of fresh) {
        await appendJsonl(REJECTS_FILE, {
          ts: new Date().toISOString(),
          id: item.id,
          source_id: item.source_id,
          reason: 'parse_fallback',
        });
      }
      const sorted = [...fresh].sort((a, b) =>
        new Date(b.published_at ?? 0) - new Date(a.published_at ?? 0)
      );
      scored = sorted.map(i => ({ ...i, score: null, reason_code: 'parse_fallback', category: i.category }));
    } else {
      const scoreMap = new Map(results.map(r => [r.id, r]));
      scored = fresh.map(i => {
        const r = scoreMap.get(i.id);
        return { ...i, score: r?.score ?? 0, reason_code: r?.reason_code ?? 'unknown', category: r?.category ?? i.category };
      });
    }
  }

  // preference枠: score降順上位27
  const prefPool = DRY_RUN || stopped
    ? scored.slice(0, PREF_MAX)
    : scored.filter(i => i.score !== null).sort((a, b) => b.score - a.score);

  // low_score脱落帯
  const lowScoreThreshold = 40;
  const prefSelected = [];
  const sourceCounts = {};
  const lowScorePool = [];

  for (const item of prefPool) {
    if (!DRY_RUN && !stopped && item.score < lowScoreThreshold) {
      lowScorePool.push(item);
      await reject(item.id, item.source_id, 'low_score');
      continue;
    }
    const cnt = sourceCounts[item.source_id] ?? 0;
    if (cnt >= MAX_PER_SOURCE) {
      await reject(item.id, item.source_id, 'diversity_cut');
      continue;
    }
    if (prefSelected.length >= PREF_MAX) {
      await reject(item.id, item.source_id, 'capacity_cut');
      continue;
    }
    sourceCounts[item.source_id] = cnt + 1;
    prefSelected.push({ ...item, slot: 'preference' });
  }

  // explore枠: low_score帯から日付シードで乱択3件
  const dateSeed = parseInt(DATE.replace(/-/g, ''), 10);
  const explorePool = [...(DRY_RUN || stopped ? scored.slice(PREF_MAX) : lowScorePool)];
  const exploreSelected = [];
  if (explorePool.length > 0) {
    for (let i = 0; i < EXPLORE_COUNT && i < explorePool.length; i++) {
      const idx = (dateSeed + i * 7) % explorePool.length;
      exploreSelected.push({ ...explorePool[idx], slot: 'explore' });
    }
  }

  const candidates = [...prefSelected, ...exploreSelected, ...fixed.map(i => ({ ...i, slot: 'fixed', score: null }))];

  if (candidates.length > MAX_CANDIDATES) {
    for (const item of candidates.splice(MAX_CANDIDATES)) {
      await reject(item.id, item.source_id, 'capacity_cut');
    }
  }

  // YAML書き出し
  await writeFile(CANDIDATES_FILE, yamlDump({ date: DATE, count: candidates.length, candidates }), 'utf8');
  console.log(`[select] 短冊 ${candidates.length}件 → ${CANDIDATES_FILE}`);
  if (DRY_RUN) console.log('[select] DRY_RUN モード（採点スキップ）');
}

main().catch(e => { console.error(e); process.exit(1); });
