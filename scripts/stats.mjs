#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readJsonl } from './lib/jsonl.mjs';

async function main() {
  const DATE = new Date().toISOString().slice(0, 10);

  // 短冊から水源別採用率
  const candidates = await readJsonl(join('data', 'candidates', `${DATE}.yaml`)).catch(() => []);
  // YAML なので別処理
  const { readFile } = await import('node:fs/promises');
  const { load: yamlLoad } = await import('js-yaml');

  let candData = { candidates: [] };
  try {
    const raw = await readFile(join('data', 'candidates', `${DATE}.yaml`), 'utf8');
    candData = yamlLoad(raw);
  } catch { /* not yet */ }

  const bySource = {};
  for (const c of candData.candidates ?? []) {
    const sid = c.source_id ?? 'unknown';
    bySource[sid] = (bySource[sid] ?? 0) + 1;
  }

  // 棄却ログから理由分布
  const rejectFile = join('logs', 'rejects', `${DATE}-select.jsonl`);
  const rejects = await readJsonl(rejectFile);
  const byReason = {};
  const rejectBySource = {};
  for (const r of rejects) {
    byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
    const sid = r.source_id ?? 'unknown';
    rejectBySource[sid] = (rejectBySource[sid] ?? 0) + 1;
  }

  console.log(`\n=== stats ${DATE} ===`);
  console.log('\n--- 水源別採用数 ---');
  for (const [sid, cnt] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    const rej = rejectBySource[sid] ?? 0;
    const total = cnt + rej;
    const rate = total > 0 ? ((cnt / total) * 100).toFixed(0) : '?';
    console.log(`  ${sid.padEnd(20)} 採用 ${cnt} / 計 ${total} (${rate}%)`);
  }

  console.log('\n--- 棄却理由分布 ---');
  for (const [reason, cnt] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(20)} ${cnt}件`);
  }

  // 費用
  const costFile = join('logs', 'costs', `${DATE}.jsonl`);
  const costs = await readJsonl(costFile);
  const totalCost = costs.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  console.log(`\n--- 本日費用 ---`);
  console.log(`  $${totalCost.toFixed(6)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
