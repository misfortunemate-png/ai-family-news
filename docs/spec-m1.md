# ai-family-news 仕様書 M1「収集と選別」 v1.0

発行: 2026-08-13 ／ 作成: クリーデ（開発PM） ／ 実装: PG（Claude Code）
上位文書: 要件定義書v1.3・データ定義書v1.1（ai-family-memory ops/docs/family-news-*.md）
本仕様の完成状態: **毎朝06:00 JST頃、無人で「収集→正規化→下処理→DeepSeek採点→候補短冊」が走り、棄却ログ①②と費用台帳が残る。workflow_dispatchでdry-run可能。**

## 1. スコープ

- 含む: 収集（RSS/JSON）／正規化／重複排除・鮮度・分類／DeepSeek一括採点／短冊生成（15〜30件＋探索枠3件）／棄却ログ①②／費用台帳／週次コストガード／dry-run／ローカル実行スクリプト
- 含まない: 抽選・セリフ（M2）／UI（M3）／開拓（M4）／reddit（OAuth取得後に水源追加）

## 2. リポジトリ構成（M1で作るもの）

```
sources.yaml                      支給物S-1（PM支給・PGはテスト取得で採否確定）
profile/preferences.md            支給物S-2（嗜好文書v0・発注者朱入れ前提）
scripts/collect.mjs               収集・正規化
scripts/select.mjs                下処理・採点・短冊生成
scripts/stats.mjs                 水源別採用率・棄却理由分布の集計（決定的）
scripts/inspect.mjs               PG自己検査
scripts/lib/                      共通（fetch, hash, jsonl, cost, guard）
.github/workflows/daily.yml       日次ワークフロー
data/ logs/                       出力（.gitkeep）
run-local.bat / run-local.sh      ローカル実行（ASCII・CRLF/LF）
.env.example                      OPENROUTER_API_KEY=
_STATUS.md / CLAUDE.md / README.md   devスキルtemplates準拠
```

## 3. 処理仕様

### 3.1 collect.mjs（決定的・LLMゼロ）

1. sources.yaml の enabled 水源を順次取得（User-Agent明示・タイムアウト15s・失敗は棄却ログ① `fetch_error`、他水源へ続行）
2. RSS/Atom→fast-xml-parserで解析、JSON→そのまま。解析不能は `parse_error`
3. 正規化itemスキーマ（データ定義書B）で `data/items/YYYY-MM-DD.jsonl` へ。titleとsummaryのみ・**本文は取得しない**。summaryは300字で切り詰め
4. id = URL正規化（クエリ除去・小文字化）のsha256先頭16桁
5. type=json（気象庁）は category=weather・fixed=true で格納（採点対象外）

### 3.2 select.mjs

順序固定。各段の脱落は棄却ログ②へ理由コード付き記帳。

1. **予算ガード**: `logs/costs/` 当週（月曜起点）合計を集計。$1.5超→警告を費用台帳へ記帳し続行。$3.0超→LLMを呼ばずdry-run挙動へ縮退し `budget_stop` を記帳
2. **重複排除**: id重複＋過去7日のitemsとのid照合 → `duplicate`
3. **鮮度**: published_atが48時間超 → `stale`（週刊系水源はsources.yamlの `freshness_hours` で個別緩和可）
4. **採点（DeepSeek）**: モデル `deepseek/deepseek-v4-flash`（OpenRouter）。1リクエストに全件をJSONで渡し、嗜好文書全文をシステム側に貼付。出力は `[{id, score(0-100), reason_code, category}]` のJSONのみ（structured output利用）。categoryは採点と同時に付与（ai/dev/construction/game/food/weather/world/other）
5. **短冊生成**: score降順に上位27件を preference 枠、`low_score` 脱落帯から日付シード乱択で3件を explore 枠（計最大30）。同一水源は preference 枠内で最大8件（超過は `diversity_cut`）。30超過は `capacity_cut`
6. `data/candidates/YYYY-MM-DD.yaml` へ書き出し（fixed水源は別節でそのまま通す）
7. 費用台帳へ記帳: `{ts, job:"select", model, usage, cost_usd}`（usageはAPIレスポンスから）

### 3.3 dry-run

`workflow_dispatch` の input `dry_run=true` または env `DRY_RUN=1`。採点をスキップし、鮮度順上位27＋乱択3で短冊生成（score=null, reason_code="dry_run"）。LLM・費用ゼロで全経路を検証できること。

### 3.4 daily.yml

```yaml
on:
  schedule:
    - cron: '0 6 * * *'
      timezone: 'Asia/Tokyo'   # timezone未対応環境なら '0 21 * * *'(UTC) に読み替え
  workflow_dispatch:
    inputs: { dry_run: {type: boolean, default: false} }
```

steps: checkout → setup-node(20) → `node scripts/collect.mjs` → `node scripts/select.mjs` → data/ logs/ をcommit＆push（組込みGITHUB_TOKEN・コミットメッセージ `[daily] YYYY-MM-DD 収集N件 短冊M件`）。連続実行の競合はpull --rebase一回で解決、失敗時はジョブ失敗として通知に任せる。

## 4. 制約・禁止事項

- R-010: 本仕様外の設計判断は停止しdocs/reports/へ疑義起票
- APIキーはシークレットのみ。コード・ログ・コミットへの出力禁止（inspectでgrep検査）
- 依存はfast-xml-parser＋標準ライブラリを基本。追加時は報告
- LLM呼び出しはselect.mjsの採点1回のみ（M1の全工程で1日1リクエスト）
- 出力ファイルはすべてデータ定義書v1.1のスキーマに従う。乖離が必要なら疑義起票

## 5. inspect.mjs（自己検査項目）

1. スキーマ検証: items/candidates/rejects/costsのサンプル1日分を生成し必須キー検査
2. 禁止参照grep: `sk-or-`・`OPENROUTER_API_KEY=`実値のハードコード検出
3. dry-run実走がexitコード0・短冊30件以下
4. bat/shのASCII検査・_STATUS.md 30行以内
5. 結果をdocs/reports/report-m1.mdに添付

## 6. 検分（発注者・PM）

1. workflow_dispatch（dry_run=true→false の2回）で全出力が生成される
2. schedule起動が1回成立する（翌朝）
3. stats.mjsで水源別採用率・棄却理由分布が表示される
4. 費用台帳に実コストが記帳され、試算（$0.005/日規模）と桁が合う

## 支給物

- S-1 sources.yaml初版（本仕様と同時にリポジトリへ直接push・SHA-256は指示書に記載）
- S-2 profile/preferences.md v0（同上・**発注者の朱入れ待ちの仮案**。朱入れ前でも実装・試走は可）
