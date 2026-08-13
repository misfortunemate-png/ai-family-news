#!/usr/bin/env node
// PG自己検査 (仕様書M3n §3)
import { readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { spawnSync } from 'node:child_process';
import { readJsonl } from './lib/jsonl.mjs';

const DATE = new Date().toISOString().slice(0, 10);
const PASS = '✓';
const FAIL = '✗';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? PASS : FAIL} ${name}${detail ? ': ' + detail : ''}`);
}

// § スキーマ検証
async function checkSchema() {
  // items (image_url含む)
  const itemsFile = join('data', 'items', `${DATE}.jsonl`);
  if (!existsSync(itemsFile)) {
    check('items.jsonl 存在', false, `${itemsFile} が存在しない`);
  } else {
    const items = await readJsonl(itemsFile);
    const sample = items[0];
    const requiredItem = ['id', 'url', 'source_id', 'category', 'title', 'collected_at', 'image_url'];
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

  // rejects (select)
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

// § 禁止参照grep
function checkSecrets() {
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

// § dry-run短冊30件以下
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

// § config.yaml検査
async function checkConfig() {
  const configFile = join('profile', 'config.yaml');
  if (!existsSync(configFile)) {
    check('config.yaml 存在', false);
    return;
  }
  check('config.yaml 存在', true);
  const config = yamlLoad(await readFile(configFile, 'utf8'));
  const req = ['publish_time', 'pool', 'retention_days', 'images_enabled'];
  const missing = req.filter(k => !(k in (config ?? {})));
  check('config.yaml必須キー', missing.length === 0, missing.join(',') || 'OK');
  check('retention_days正値', typeof config?.retention_days === 'number' && config.retention_days > 0,
    String(config?.retention_days ?? '未設定'));
}

// § ログディレクトリ・スキーマ検査
function checkLogDirs() {
  for (const dir of ['logs/errors', 'logs/conversations']) {
    check(`${dir}/ 存在`, existsSync(dir));
  }

  // errors スキーマ（今日のファイルがあれば）
  const errFile = join('logs', 'errors', `${DATE}.jsonl`);
  if (existsSync(errFile)) {
    try {
      const lines = readFileSync(errFile, 'utf8').split('\n').filter(Boolean);
      if (lines.length > 0) {
        const sample = JSON.parse(lines[0]);
        const req = ['ts', 'source', 'job', 'level', 'code', 'detail'];
        const missing = req.filter(k => !(k in sample));
        check('errorsスキーマ', missing.length === 0, missing.join(',') || `${lines.length}件OK`);
      } else {
        check('errorsスキーマ', true, '空（正常）');
      }
    } catch { check('errorsスキーマ', false, '読み込みエラー'); }
  }

  // conversations スキーマ（今日のファイルがあれば）
  const convFile = join('logs', 'conversations', `${DATE}.jsonl`);
  if (existsSync(convFile)) {
    try {
      const lines = readFileSync(convFile, 'utf8').split('\n').filter(Boolean);
      if (lines.length > 0) {
        const sample = JSON.parse(lines[0]);
        const req = ['ts', 'author', 'kind', 'text'];
        const missing = req.filter(k => !(k in sample));
        check('conversationsスキーマ', missing.length === 0, missing.join(',') || `${lines.length}件OK`);
      } else {
        check('conversationsスキーマ', true, '空（正常）');
      }
    } catch { check('conversationsスキーマ', false, '読み込みエラー'); }
  }
}

// § cleanup動作テスト（旧日付ファイル削除 + favorites保全）
async function checkCleanup() {
  if (!existsSync('scripts/cleanup.mjs')) {
    check('cleanup.mjs存在', false);
    return;
  }
  check('cleanup.mjs存在', true);

  const testDate = '2000-01-01';
  const favItemId = 'inspect-test-fav-item';
  const delItemId = 'inspect-test-del-item';

  const testFiles = {
    items: join('data', 'items', `${testDate}.jsonl`),
    candidates: join('data', 'candidates', `${testDate}.yaml`),
    issues: join('data', 'issues', `${testDate}.yaml`),
    rejects: join('logs', 'rejects', `${testDate}-inspect.jsonl`),
  };

  // テスト用ファイル作成
  await writeFile(testFiles.items,
    [
      JSON.stringify({ id: delItemId, url: 'http://example.com/del', source_id: 'test', category: 'tech', title: '削除対象', collected_at: `${testDate}T00:00:00Z`, image_url: null }),
      JSON.stringify({ id: favItemId, url: 'http://example.com/fav', source_id: 'test', category: 'tech', title: 'お気に入り対象', collected_at: `${testDate}T00:00:00Z`, image_url: null }),
    ].join('\n') + '\n', 'utf8');
  await writeFile(testFiles.candidates,
    `date: '${testDate}'\ncount: 2\ncandidates:\n  - id: ${delItemId}\n    url: http://example.com/del\n    source_id: test\n    category: tech\n    title: 削除対象\n    slot: normal\n  - id: ${favItemId}\n    url: http://example.com/fav\n    source_id: test\n    category: tech\n    title: お気に入り対象\n    slot: normal\n`, 'utf8');
  await writeFile(testFiles.issues,
    `date: '${testDate}'\neditor: cleade\ntopics:\n  - item_id: ${favItemId}\n    serif: テスト\n    comment: テストコメント\n`, 'utf8');
  await writeFile(testFiles.rejects,
    JSON.stringify({ ts: `${testDate}T00:00:00Z`, id: delItemId, reason: 'low_score' }) + '\n', 'utf8');

  // favorites.jsonl バックアップ & テスト用エントリ追加
  const favFile = join('data', 'favorites.jsonl');
  let favBackup = null;
  if (existsSync(favFile)) favBackup = await readFile(favFile, 'utf8');
  const testFavEntry = JSON.stringify({ id: 'inspect-fav-1', ts: `${testDate}T00:00:00Z`, kind: 'topic', ref: favItemId }) + '\n';
  await writeFile(favFile, (favBackup ?? '') + testFavEntry, 'utf8');

  let cleanupOk = false;
  try {
    const result = spawnSync('node', ['scripts/cleanup.mjs'], { encoding: 'utf8' });
    cleanupOk = result.status === 0;
    if (!cleanupOk) console.error('[inspect] cleanup stderr:', result.stderr);
  } catch (e) {
    console.error('[inspect] cleanup実行エラー:', e.message);
  }
  check('cleanup実行', cleanupOk, cleanupOk ? 'OK' : 'exit non-zero');

  // 削除確認（items・rejectsはfavorites除外なし）
  check('cleanup items削除', !existsSync(testFiles.items));
  check('cleanup rejects削除', !existsSync(testFiles.rejects));
  // issues保全確認（favoritesに登録されたitem_idを含む日のため）
  check('cleanup issues保全', existsSync(testFiles.issues));
  // candidates行フィルタ確認
  if (existsSync(testFiles.candidates)) {
    const cand = yamlLoad(await readFile(testFiles.candidates, 'utf8'));
    const kept = cand?.candidates ?? [];
    const onlyFav = kept.length === 1 && kept[0].id === favItemId;
    check('cleanup candidates行フィルタ', onlyFav, `${kept.length}件(期待1件)`);
  } else {
    check('cleanup candidates行フィルタ', false, 'ファイルが存在しない');
  }

  // テストファイル後始末
  for (const f of Object.values(testFiles)) {
    if (existsSync(f)) { try { await rm(f); } catch { /* ignore */ } }
  }
  // favorites.jsonl 復元
  if (favBackup !== null) {
    await writeFile(favFile, favBackup, 'utf8');
  } else if (existsSync(favFile)) {
    try { await rm(favFile); } catch { /* ignore */ }
  }
}

// § bat/shのASCII検査・_STATUS.md30行以内
async function checkFiles() {
  for (const f of ['run-local.bat', 'run-local.sh']) {
    if (!existsSync(f)) { check(`${f}存在`, false); continue; }
    const content = await readFile(f, 'utf8');
    const nonAscii = [...content].filter(c => c.charCodeAt(0) > 127);
    check(`${f} ASCII`, nonAscii.length === 0, nonAscii.length > 0 ? `非ASCII文字${nonAscii.length}個` : 'OK');
  }

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
  await checkConfig();
  checkLogDirs();
  await checkCleanup();
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
