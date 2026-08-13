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

// 採点オブジェクトの配列をJSONから再帰的に探す（最大深さ5）
function findScoreArray(obj, depth = 0) {
  if (depth > 5) return null;
  if (Array.isArray(obj)) {
    // 先頭要素に id があれば採点配列とみなす
    if (obj.length > 0 && obj[0] != null && 'id' in obj[0]) return obj;
    // 空配列は次の候補を探す
  }
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const val of Object.values(obj)) {
      const found = findScoreArray(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// null を返したら呼び出し元で parse_fallback 縮退
async function scoreWithLlm(items, preferences) {
  const payload = {
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `あなたはニュース採点者です。以下の嗜好文書に基づき、各記事を0-100で採点してください。\n\n${preferences}\n\n出力はJSON配列のみ。各要素: {id, score, reason_code, category}。reason_codeはワンワード英語。categoryはai/dev/construction/game/food/weather/world/otherのいずれか。`,
      },
      {
        role: 'user',
        content: JSON.stringify(items.map(i => ({ id: i.id, title: i.title, summary: i.summary }))),
      },
    ],
    response_format: { type: 'json_object' },
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
  const costUsd = ((usage.prompt_tokens ?? 0) * 0.00000014 + (usage.completion_tokens ?? 0) * 0.00000028);

  await recordCost({
    ts: new Date().toISOString(),
    job: 'select',
    model: MODEL,
    usage,
    cost_usd: costUsd,
  });

  const rawContent = json.choices?.[0]?.message?.content ?? '';
  // デバッグ用ログ（本番安定後に除去可）
  console.log('[scoreWithLlm] raw content (先頭500字):', rawContent.slice(0, 500));

  let parsed;
  try {
    parsed = JSON.parse(rawContent || '{}');
  } catch (e) {
    console.error('[scoreWithLlm] JSON.parse失敗:', e.message);
    return null;
  }

  const arr = findScoreArray(parsed);
  if (!arr) {
    console.error('[scoreWithLlm] 採点配列が見つからない。parsed keys:', Object.keys(parsed ?? {}));
    return null;
  }
  return arr;
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
