import { weeklyTotal, recordCost } from './cost.mjs';
export { recordCost } from './cost.mjs';

const WARN_USD = 1.5;
const STOP_USD = 3.0;

// 予算チェック。STOP閾値超過時は true を返す（LLM呼び出し禁止）
export async function budgetCheck(date) {
  const total = await weeklyTotal();
  if (total > STOP_USD) {
    await recordCost({ ts: new Date().toISOString(), job: 'guard', note: 'budget_stop', cost_usd: 0 });
    console.warn(`[guard] 週次コスト $${total.toFixed(4)} が上限 $${STOP_USD} を超過。LLMをスキップ。`);
    return true;
  }
  if (total > WARN_USD) {
    console.warn(`[guard] 週次コスト $${total.toFixed(4)} が警告閾値 $${WARN_USD} を超過。`);
    await recordCost({ ts: new Date().toISOString(), job: 'guard', note: 'budget_warn', cost_usd: 0 });
  }
  return false;
}
