#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { appendJsonl } from './lib/jsonl.mjs';
import { recordCost } from './lib/cost.mjs';
import { fetchArticle } from './lib/article.mjs';

const DATE = new Date().toISOString().slice(0, 10);
const CANDIDATES_FILE = join('data', 'candidates', `${DATE}.yaml`);
const ISSUES_FILE = join('data', 'issues', `${DATE}.yaml`);
const REJECTS_FILE = join('logs', 'rejects', `${DATE}-voice.jsonl`);

const API_KEY = process.env.OPENROUTER_API_KEY ?? '';
const MODEL = 'anthropic/claude-sonnet-4.6';

// 日付シードによる抽選: spec§3.1
function lottery(editors) {
  const seed = BigInt(parseInt(DATE.replace(/-/g, ''), 10));
  const idx = Number(seed * 2654435761n % (2n ** 32n)) % editors.length;
  return editors[idx];
}

// OpenRouterに1リクエスト送信。cost_usdはusage.costを優先
async function callLlm(messages, maxTokens, jobLabel) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status} (${jobLabel})`);
  const json = await res.json();
  const usage = json.usage ?? {};
  const costUsd = usage.cost ?? ((usage.prompt_tokens ?? 0) * 0.000003 + (usage.completion_tokens ?? 0) * 0.000015);
  await recordCost({ ts: new Date().toISOString(), job: jobLabel, model: MODEL, usage, cost_usd: costUsd });
  const content = json.choices?.[0]?.message?.content ?? '{}';
  console.log(`[${jobLabel}] raw (先頭300字):`, content.slice(0, 300));
  return { content, costUsd };
}

// JSONを再帰的に探してキーを持つオブジェクトを返す
function findObject(obj, key, depth = 0) {
  if (depth > 5 || obj == null) return null;
  if (typeof obj === 'object' && !Array.isArray(obj) && key in obj) return obj;
  if (typeof obj === 'object') {
    for (const v of Object.values(obj)) {
      const found = findObject(v, key, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function safeParse(content) {
  try { return JSON.parse(content || '{}'); } catch { return {}; }
}

async function rejectLog(id, reason, detail) {
  await appendJsonl(REJECTS_FILE, {
    ts: new Date().toISOString(),
    stage: 3,
    id: id ?? null,
    reason,
    detail: detail ?? undefined,
  });
}

async function writeIssue(issue) {
  await writeFile(ISSUES_FILE, yamlDump(issue, { lineWidth: 120 }), 'utf8');
  console.log(`[voice] 紙面生成 → ${ISSUES_FILE}`);
}

async function main() {
  // DRY_RUN時はスキップ (仕様§3.9)
  if (process.env.DRY_RUN === '1') {
    console.log('[voice] DRY_RUN=1 のためスキップ');
    return;
  }

  // pool.yaml読込
  const pool = yamlLoad(await readFile('profile/pool.yaml', 'utf8'));
  const editors = pool.editors ?? [];
  if (editors.length === 0) throw new Error('pool.yaml: editors が空');

  // 抽選
  const editor = lottery(editors);
  console.log(`[voice] 当番エディタ: ${editor}`);

  // 人格カード読込
  const cardPath = join('profile', 'cards', `${editor}.yaml`);
  if (!existsSync(cardPath)) {
    console.error(`[voice] 人格カード不在: ${cardPath}`);
    process.exit(1);
  }
  const card = yamlLoad(await readFile(cardPath, 'utf8'));
  const cardText = await readFile(cardPath, 'utf8');

  // candidates.yaml読込
  if (!existsSync(CANDIDATES_FILE)) {
    console.warn('[voice] candidates.yaml なし → 白紙面生成');
    await writeIssue({ date: DATE, editor, topics: [], none_reason: 'no_candidates', weather: null });
    return;
  }
  const candData = yamlLoad(await readFile(CANDIDATES_FILE, 'utf8'));
  const allCands = candData.candidates ?? [];

  // fixed（天気）と採点対象を分離
  const fixedCands = allCands.filter(c => c.fixed || c.slot === 'fixed');
  const scorable = allCands.filter(c => !c.fixed && c.slot !== 'fixed');

  // weatherノード準備
  const weather = fixedCands.length > 0
    ? { title: fixedCands[0].title ?? '', summary: fixedCands[0].summary ?? '' }
    : null;

  // 採点候補が空の場合は白紙面
  if (scorable.length === 0) {
    console.warn('[voice] 採点候補ゼロ → 白紙面生成');
    await rejectLog(null, 'editor_none', 'no_scorable_candidates');
    await writeIssue({ date: DATE, editor, topics: [], none_reason: 'no_scorable_candidates', weather });
    return;
  }

  // ── 選定コール ──
  const selectionSystem = `${cardText}\n\n---\nあなたは選者です。情報の網羅ではなく、自分の偏りで1〜5話題を選んでください。惹かれない日は選ばない（NONE）も正しい選択です。\n出力JSON: {"selected": [{"id": "...", "why": "..."}], "passed_over": [{"id": "...", "why": "..."}], "none_reason": null}\nnone_reasonはselectedが空のときのみ文字列を入れてください。passed_overは目に留まったが見送った話題を0〜3件。`;
  const selectionUser = JSON.stringify(
    scorable.map(c => ({ id: c.id, title: c.title, summary: c.summary, score: c.score, category: c.category }))
  );

  let selectionResult = null;
  let totalVoiceCost = 0;

  try {
    const { content, costUsd } = await callLlm(
      [{ role: 'system', content: selectionSystem }, { role: 'user', content: selectionUser }],
      1500,
      'voice_select'
    );
    totalVoiceCost += costUsd;
    const parsed = safeParse(content);
    selectionResult = findObject(parsed, 'selected');
  } catch (e) {
    console.error('[voice] 選定コール失敗:', e.message);
  }

  // 選定失敗 or NONE
  if (!selectionResult || !Array.isArray(selectionResult.selected)) {
    await rejectLog(null, 'editor_none', 'selection_api_error');
    await writeIssue({ date: DATE, editor, topics: [], none_reason: 'api_error', weather });
    return;
  }

  let selected = selectionResult.selected ?? [];
  const passedOver = selectionResult.passed_over ?? [];
  const noneReason = selectionResult.none_reason ?? null;

  // capacity_cut: 6件以上は先頭5件に切り詰め
  if (selected.length > 5) {
    for (const item of selected.slice(5)) {
      await rejectLog(item.id, 'capacity_cut', 'selected > 5');
    }
    selected = selected.slice(0, 5);
  }

  // passed_over 棄却ログ③
  for (const item of passedOver) {
    await rejectLog(item.id, 'editor_skip', item.why ?? '');
  }

  // NONE
  if (selected.length === 0) {
    await rejectLog(null, 'editor_none', noneReason ?? 'no selection');
    await writeIssue({ date: DATE, editor, topics: [], none_reason: noneReason ?? 'no_selection', passed_over: passedOver.map(p => ({ item_id: p.id, why: p.why })), weather });
    return;
  }

  // ── 本文読解 ──
  const candMap = new Map(allCands.map(c => [c.id, c]));
  const articleMap = {};
  for (const sel of selected) {
    const cand = candMap.get(sel.id);
    if (!cand?.url) { articleMap[sel.id] = { text: cand?.summary ?? '', read: false }; continue; }
    const body = await fetchArticle(cand.url);
    if (body) {
      articleMap[sel.id] = { text: body, read: true };
    } else {
      articleMap[sel.id] = { text: cand.summary ?? '', read: false };
    }
  }

  // ── セリフコール ──
  const serifSystem = `${cardText}\n\n---\nあなたは選んだ話題ごとにセリフとコメントを書きます。\nserif: 見出しセリフ40字以内・一人称の声。商品説明でなく、なぜ面白いと思ったかを言う。\ncomment: 200字以内。同じく「なぜ面白いか」。\n出力JSON: {"topics": [{"id": "...", "serif": "...", "comment": "..."}]}`;
  const serifUser = selected.map(sel => {
    const art = articleMap[sel.id];
    const title = candMap.get(sel.id)?.title ?? '';
    return `id: ${sel.id}\ntitle: ${title}\nbody:\n${art?.text ?? ''}`;
  }).join('\n\n---\n\n');

  let serifTopics = null;
  try {
    const { content, costUsd } = await callLlm(
      [{ role: 'system', content: serifSystem }, { role: 'user', content: serifUser }],
      2000,
      'voice_serif'
    );
    totalVoiceCost += costUsd;
    const parsed = safeParse(content);
    const found = findObject(parsed, 'topics');
    serifTopics = Array.isArray(found?.topics) ? found.topics : null;
  } catch (e) {
    console.error('[voice] セリフコール失敗:', e.message);
  }

  const serifMap = new Map((serifTopics ?? []).map(t => [t.id, t]));

  // ── 紙面生成 ──
  const topics = selected.map(sel => {
    const serif = serifMap.get(sel.id);
    const art = articleMap[sel.id];
    return {
      item_id: sel.id,
      serif: serif?.serif ?? '',
      comment: serif?.comment ?? '',
      body_read: art?.read ?? false,
      selection_reason: sel.why ?? '',
    };
  });

  const issue = {
    date: DATE,
    editor,
    topics,
    passed_over: passedOver.map(p => ({ item_id: p.id, why: p.why ?? '' })),
    none_reason: null,
    weather,
  };

  await writeIssue(issue);

  // 費用超過チェック（停止はしない）
  const costLimit = topics.length * 0.2;
  if (totalVoiceCost > costLimit) {
    console.warn(`[voice] cost_overrun: $${totalVoiceCost.toFixed(4)} > $${costLimit.toFixed(2)} (${topics.length}話題×$0.2)`);
    await rejectLog(null, 'cost_overrun', `$${totalVoiceCost.toFixed(4)}`);
  }

  console.log(`[voice] 完了: ${topics.length}話題 / 費用 $${totalVoiceCost.toFixed(4)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
