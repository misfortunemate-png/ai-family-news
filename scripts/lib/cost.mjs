import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readJsonl, appendJsonl } from './jsonl.mjs';

const COSTS_DIR = 'logs/costs';

// 週の月曜日 (UTC) を YYYY-MM-DD で返す
export function weekKey(date = new Date()) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export async function weeklyTotal() {
  const wk = weekKey();
  let total = 0;
  try {
    const files = await readdir(COSTS_DIR);
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const rows = await readJsonl(join(COSTS_DIR, f));
      for (const r of rows) {
        if (weekKey(new Date(r.ts)) === wk) total += r.cost_usd ?? 0;
      }
    }
  } catch { /* no logs yet */ }
  return total;
}

export async function recordCost(entry) {
  const date = new Date().toISOString().slice(0, 10);
  await appendJsonl(join(COSTS_DIR, `${date}.jsonl`), entry);
}
