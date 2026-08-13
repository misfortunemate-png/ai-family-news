#!/usr/bin/env node
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';

const DATE = new Date().toISOString().slice(0, 10);
const ERRORS_FILE = join('logs', 'errors', `${DATE}.jsonl`);

async function logError(source, job, code, detail) {
  try {
    await mkdir(join('logs', 'errors'), { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), source: 'actions', job, level: 'error', code, detail }) + '\n';
    const { appendFile } = await import('node:fs/promises');
    await appendFile(ERRORS_FILE, line, 'utf8');
  } catch { /* ログ失敗は握りつぶす */ }
}

function isOldDate(dateStr, cutoffStr) {
  return dateStr < cutoffStr;
}

function extractDateFromFilename(fname) {
  const m = fname.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

async function readFavoriteRefs() {
  const favFile = join('data', 'favorites.jsonl');
  if (!existsSync(favFile)) return new Set();
  const refs = new Set();
  try {
    const lines = (await readFile(favFile, 'utf8')).split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const fav = JSON.parse(line);
        if (fav.ref) refs.add(fav.ref);
      } catch { /* skip malformed line */ }
    }
  } catch (e) {
    await logError('cleanup', 'cleanup', 'favorites_read_error', e.message);
  }
  return refs;
}

// favRefsを含むissueの日付セットを返す
async function findFavIssueDates(cutoffStr, favRefs) {
  const dates = new Set();
  if (favRefs.size === 0) return dates;
  const issueDir = join('data', 'issues');
  if (!existsSync(issueDir)) return dates;
  for (const fname of readdirSync(issueDir)) {
    const dateStr = extractDateFromFilename(fname);
    if (!dateStr || !isOldDate(dateStr, cutoffStr)) continue;
    try {
      const issue = yamlLoad(await readFile(join(issueDir, fname), 'utf8'));
      const topics = issue?.topics ?? [];
      for (const topic of topics) {
        if (favRefs.has(topic.item_id)) {
          dates.add(dateStr);
          break;
        }
      }
    } catch { /* skip unreadable issue */ }
  }
  return dates;
}

// data/items/ を retention_days 超で削除（favorites除外なし）
async function cleanItems(cutoffStr) {
  const dir = join('data', 'items');
  if (!existsSync(dir)) return;
  for (const fname of readdirSync(dir)) {
    if (fname === '.gitkeep') continue;
    const dateStr = extractDateFromFilename(fname);
    if (!dateStr || !isOldDate(dateStr, cutoffStr)) continue;
    try {
      await rm(join(dir, fname));
      console.log(`[cleanup] 削除: data/items/${fname}`);
    } catch (e) {
      await logError('cleanup', 'cleanup', 'delete_error', `data/items/${fname}: ${e.message}`);
    }
  }
}

// logs/rejects/ を retention_days 超で削除（favorites除外なし）
async function cleanRejects(cutoffStr) {
  const dir = join('logs', 'rejects');
  if (!existsSync(dir)) return;
  for (const fname of readdirSync(dir)) {
    if (fname === '.gitkeep') continue;
    const dateStr = extractDateFromFilename(fname);
    if (!dateStr || !isOldDate(dateStr, cutoffStr)) continue;
    try {
      await rm(join(dir, fname));
      console.log(`[cleanup] 削除: logs/rejects/${fname}`);
    } catch (e) {
      await logError('cleanup', 'cleanup', 'delete_error', `logs/rejects/${fname}: ${e.message}`);
    }
  }
}

// data/issues/ をファイル単位で保全（favIssueDatesに含まれる日は残す）
async function cleanIssues(cutoffStr, favIssueDates) {
  const dir = join('data', 'issues');
  if (!existsSync(dir)) return;
  for (const fname of readdirSync(dir)) {
    if (fname === '.gitkeep') continue;
    const dateStr = extractDateFromFilename(fname);
    if (!dateStr || !isOldDate(dateStr, cutoffStr)) continue;
    if (favIssueDates.has(dateStr)) {
      console.log(`[cleanup] 保全（favorites）: data/issues/${fname}`);
      continue;
    }
    try {
      await rm(join(dir, fname));
      console.log(`[cleanup] 削除: data/issues/${fname}`);
    } catch (e) {
      await logError('cleanup', 'cleanup', 'delete_error', `data/issues/${fname}: ${e.message}`);
    }
  }
}

// data/candidates/ を行フィルタ（favIssueDatesの日はfavRefs一致行のみ残す）
async function cleanCandidates(cutoffStr, favIssueDates, favRefs) {
  const dir = join('data', 'candidates');
  if (!existsSync(dir)) return;
  for (const fname of readdirSync(dir)) {
    if (fname === '.gitkeep') continue;
    const dateStr = extractDateFromFilename(fname);
    if (!dateStr || !isOldDate(dateStr, cutoffStr)) continue;
    const fpath = join(dir, fname);
    if (favIssueDates.has(dateStr) && favRefs.size > 0) {
      // 行フィルタ: favRefsに一致するidの行のみ残す
      try {
        const data = yamlLoad(await readFile(fpath, 'utf8'));
        const kept = (data?.candidates ?? []).filter(c => favRefs.has(c.id));
        if (kept.length === 0) {
          await rm(fpath);
          console.log(`[cleanup] 削除（favorites対象行ゼロ）: data/candidates/${fname}`);
        } else {
          await writeFile(fpath, yamlDump({ ...data, candidates: kept, count: kept.length }, { lineWidth: 120 }), 'utf8');
          console.log(`[cleanup] 行フィルタ（${kept.length}行残）: data/candidates/${fname}`);
        }
      } catch (e) {
        await logError('cleanup', 'cleanup', 'filter_error', `data/candidates/${fname}: ${e.message}`);
      }
    } else {
      try {
        await rm(fpath);
        console.log(`[cleanup] 削除: data/candidates/${fname}`);
      } catch (e) {
        await logError('cleanup', 'cleanup', 'delete_error', `data/candidates/${fname}: ${e.message}`);
      }
    }
  }
}

async function main() {
  const config = yamlLoad(await readFile(join('profile', 'config.yaml'), 'utf8'));
  const retentionDays = config.retention_days ?? 30;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  console.log(`[cleanup] 保持期間 ${retentionDays}日 / カットオフ ${cutoffStr}`);

  const favRefs = await readFavoriteRefs();
  const favIssueDates = await findFavIssueDates(cutoffStr, favRefs);

  await cleanItems(cutoffStr);
  await cleanRejects(cutoffStr);
  await cleanIssues(cutoffStr, favIssueDates);
  await cleanCandidates(cutoffStr, favIssueDates, favRefs);

  console.log('[cleanup] 完了');
}

main().catch(async e => {
  await logError('cleanup', 'cleanup', 'fatal', e.message);
  console.error(e);
  process.exit(1);
});
