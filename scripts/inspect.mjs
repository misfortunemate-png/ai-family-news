#!/usr/bin/env node
// PG自己検査 (仕様書§5)
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { readJsonl } from './lib/jsonl.mjs';

const DATE = new Date().toISOString().slice(0, 10);
const PASS = '✓';
const FAIL = '✗';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? PASS : FAIL} ${name}${detail ? ': ' + detail : ''}`);
}

// §5-1 スキーマ検証
async function checkSchema() {
  // items
  const itemsFile = join('data', 'items', `${DATE}.jsonl`);
  if (!existsSync(itemsFile)) {
    check('items.jsonl 存在', false, `${itemsFile} が存在しない`);
  } else {
    const items = await readJsonl(itemsFile);
    const sample = items[0];
    const requiredItem = ['id', 'url', 'source_id', 'category', 'title', 'collected_at'];
    const missingItem = requiredItem.filter(k => !(k in sample));
    check('itemsスキーマ必須キー', missingItem.length === 0, missingItem.join(',') || `${items.length}件OK`);
  }

  // candidates
  const candFile = join('data', 'candidates', `${DATE}.yaml`);
  if (!existsSync(candFile)) {
    check('candidates.yaml 存在', false, `${candFile} が存在しない`);
  } else {
    const raw = await readFile(candFile, 'utf8');
    const cand = yamlLoad(raw);
    const cnt = cand?.candidates?.length ?? 0;
    check('candidatesスキーマ', cnt > 0, `${cnt}件`);
    const req = ['id', 'source_id', 'title', 'slot'];
    const sample = cand?.candidates?.[0] ?? {};
    const missing = req.filter(k => !(k in sample));
    check('候補必須キー', missing.length === 0, missing.join(',') || 'OK');
  }

  // rejects
  const rejectFile = join('logs', 'rejects', `${DATE}-select.jsonl`);
  if (existsSync(rejectFile)) {
    const rejects = await readJsonl(rejectFile);
    const sample = rejects[0];
    const req = ['ts', 'id', 'reason'];
    const missing = req.filter(k => !(k in (sample ?? {})));
    check('棄却ログスキーマ', missing.length === 0, missing.join(',') || `${rejects.length}件OK`);
  } else {
    check('棄却ログ存在', true, '(空も可)');
  }

  // costs
  const costFile = join('logs', 'costs', `${DATE}.jsonl`);
  if (existsSync(costFile)) {
    const costs = await readJsonl(costFile);
    if (costs.length > 0) {
      const sample = costs[0];
      const req = ['ts', 'job', 'cost_usd'];
      const missing = req.filter(k => !(k in sample));
      check('費用台帳スキーマ', missing.length === 0, missing.join(',') || 'OK');
    } else {
      check('費用台帳存在', true, '空（dry-run）');
    }
  }
}

// §5-2 禁止参照grep (Node.jsネイティブ実装)
function grepDir(dir, exts, patterns) {
  const found = [];
  function walk(d) {
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!exts.some(e => entry.name.endsWith(e))) continue;
      try {
        const content = require('node:fs').readFileSync(full, 'utf8');
        for (const pat of patterns) {
          if (pat.test(content)) found.push(full);
        }
      } catch { /* skip */ }
    }
  }
  walk(dir);
  return found;
}

function checkSecrets() {
  // パターンをコードから分割して自己マッチを防止
  const KEY_PREFIX = 'sk-or-';
  const KEY_LITERAL = 'OPENROUTER' + '_API_KEY=';
  const patterns = [
    new RegExp(KEY_PREFIX + '[A-Za-z0-9]'),
    new RegExp(KEY_LITERAL + '[^$\\s"\'\\\\]'),
  ];
  const dirs = ['scripts', '.github'];
  const exts = ['.mjs', '.yml', '.yaml', '.sh', '.bat'];
  const found = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    function walk(d) {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!exts.some(e => entry.name.endsWith(e))) continue;
        const content = readFileSync(full, 'utf8');
        for (const pat of patterns) {
          if (pat.test(content)) found.push(full);
        }
      }
    }
    walk(dir);
  }
  if (found.length > 0) console.error('  APIキー疑惑:', found.join(', '));
  check('APIキーハードコード不在', found.length === 0);
}

// §5-3 dry-run実走 exit0・30件以下
async function checkDryRun() {
  const candFile = join('data', 'candidates', `${DATE}.yaml`);
  if (!existsSync(candFile)) {
    check('dry-run短冊生成', false, 'candidates.yaml なし');
    return;
  }
  const raw = await readFile(candFile, 'utf8');
  const cand = yamlLoad(raw);
  const cnt = cand?.candidates?.length ?? 0;
  check('dry-run短冊30件以下', cnt <= 30, `${cnt}件`);
}

// 是正4: issueスキーマ検査
async function checkIssueSchema() {
  const issueFile = join('data', 'issues', `${DATE}.yaml`);
  if (!existsSync(issueFile)) {
    check('issue.yaml 存在', true, '(voice未実行またはDRY_RUN)');
    return;
  }
  const raw = await readFile(issueFile, 'utf8');
  const issue = yamlLoad(raw);
  const req = ['date', 'editor', 'topics'];
  const missing = req.filter(k => !(k in (issue ?? {})));
  check('issueスキーマ必須キー', missing.length === 0, missing.join(',') || 'OK');
  // topics 各要素の必須キー
  const topics = issue?.topics ?? [];
  if (topics.length > 0) {
    const topicReq = ['item_id', 'serif', 'comment', 'body_read', 'selection_reason'];
    const topicMissing = topicReq.filter(k => !(k in topics[0]));
    check('issueトピック必須キー', topicMissing.length === 0, topicMissing.join(',') || `${topics.length}件OK`);
  }
  check('issue topics ≤ 5件', topics.length <= 5, `${topics.length}件`);
}

// §5-4 bat/shのASCII検査・_STATUS.md30行以内
async function checkFiles() {
  // ASCII check for bat/sh
  for (const f of ['run-local.bat', 'run-local.sh']) {
    if (!existsSync(f)) { check(`${f}存在`, false); continue; }
    const content = await readFile(f, 'utf8');
    const nonAscii = [...content].filter(c => c.charCodeAt(0) > 127);
    check(`${f} ASCII`, nonAscii.length === 0, nonAscii.length > 0 ? `非ASCII文字${nonAscii.length}個` : 'OK');
  }

  // _STATUS.md 30行以内
  if (existsSync('_STATUS.md')) {
    const content = await readFile('_STATUS.md', 'utf8');
    const lines = content.split('\n').length;
    check('_STATUS.md 30行以内', lines <= 30, `${lines}行`);
  }
}

async function main() {
  console.log(`\n=== inspect ${DATE} ===\n`);
  await checkSchema();
  checkSecrets();
  await checkDryRun();
  await checkIssueSchema();
  await checkFiles();

  const failed = results.filter(r => !r.ok);
  console.log(`\n--- 結果: ${results.length}項目中 ${failed.length}件失敗 ---`);
  if (failed.length > 0) {
    console.error('失敗項目:', failed.map(r => r.name).join(', '));
    process.exit(1);
  }
  console.log('全項目合格');
}

main().catch(e => { console.error(e); process.exit(1); });
