# ai-family-news 仕様書 M2「抽選と声」 v1.0

発行: 2026-08-13 ／ 作成: クリーデ（開発PM） ／ 実装: PG（Claude Code）
上位文書: 要件定義書v1.4・データ定義書v1.2（ai-family-memory ops/docs/）※PGのPATはai-family-newsのみ対象のため、スキーマ抜粋を本書付録Aに転記済み。ai-family-memoryへのアクセスは不要
本仕様の完成状態: **毎朝、短冊生成に続いて当番抽選→選定→本文読解→セリフ→紙面YAMLが無人で生成される。1〜5話題またはNONE（白紙面）。棄却ログ③と費用記帳が残る。**

## 1. スコープ

- 含む: 抽選（決定的）／選定・セリフの二段LLM／本文読解（当選のみ）／紙面issue生成／棄却ログ③／M1是正4件／daily.yml拡張／node 24化
- 含まない: UI（M3）／感想応答（M3）／開拓（M4）

## 2. 追加・変更ファイル

```
profile/pool.yaml                 支給物S-3（抽選プール。増員はここに1行＋カード1枚のみ）
profile/cards/cleade.yaml         支給物S-4（クリーデ人格カード・本人起草）
scripts/voice.mjs                 抽選・選定・セリフ・紙面生成
scripts/lib/article.mjs           本文取得（HTML→テキスト先頭4000字）
.github/workflows/daily.yml       Voiceステップ追加・node 24化
scripts/inspect.mjs               issueスキーマ検査を追加
```

## 3. 処理仕様（voice.mjs）

1. **抽選**: pool.yamlの `editors: []` から日付シード（`parseInt(YYYYMMDD) * 2654435761 % 2^32 % length`）で当番決定。プール1名なら常にその者。紙面に `editor` を記録
2. **人格カード読込**: `profile/cards/<editor>.yaml`。存在しなければ即失敗（exit 1）
3. **選定コール**: モデル `anthropic/claude-sonnet-4.6`（OpenRouter）・max_tokens 1500
   - system: 人格カード全文＋選者の役割（「情報の網羅ではなく自分の偏りで1〜5話題を選ぶ。惹かれなければ選ばない=NONEも正しい選択」）
   - user: 短冊（fixed除く。id/title/summary/score/category）
   - 出力JSON: `{selected: [{id, why}], passed_over: [{id, why}]（目に留まったが見送った0〜3件）, none_reason?}`
   - selectedが6件以上返ったら先頭5件に切り詰め `capacity_cut` 記帳
4. **本文読解**: selected各話題のURLをfetch→タグ除去→先頭4000字。失敗時はsummaryで続行し `body_read: false`
5. **セリフコール**: 同モデル・max_tokens 2000
   - system: 人格カード全文＋書式（serif=見出しセリフ40字以内・一人称の声／comment=200字以内・なぜ面白いと思ったか。商品説明にしない）
   - user: 話題ごとの本文（またはsummary）
   - 出力JSON: `{topics: [{id, serif, comment}]}`
6. **紙面生成**: `data/issues/YYYY-MM-DD.yaml`（付録Aスキーマ）。fixed枠（天気）はLLMを通さず `weather` 節へ転記。selectedゼロなら `none_reason` のみの白紙面を必ず生成する（ファイルを作らない日はない）
7. **棄却ログ③**: passed_over→`editor_skip`（why併記）、NONE→`editor_none`
8. **費用**: コール毎に記帳（usage.cost採用）。話題数×$0.2超過時は `cost_overrun` を警告記帳（停止はしない。停止は週次ガードの役割）
9. dry-run時（DRY_RUN=1）はvoice全体をスキップ

## 4. M1是正（本フェーズに同梱）

1. collect.mjs: title/summaryのHTMLエンティティ（`&#x...;`・`&amp;`等）をデコードして格納
2. collect.mjs: RSS 1.0の `dc:date` をpublished_atに採用（はてブのnull対策）
3. cost系: OpenRouterレスポンスの `usage.cost` があれば `cost_usd` にそのまま採用。ハードコード単価は概算フォールバックに降格
4. inspect.mjs: issueスキーマ（付録A）の検査を追加

## 5. daily.yml変更

- Select後に `Voice` ステップ追加: `if: ${{ !inputs.dry_run }}`・env同様
- setup-node を `node-version: '24'` へ
- コミット対象に `data/issues/` を追加

## 6. 検分

1. workflow_dispatch（dry_run=false）で紙面YAMLが生成され、serifが人格カードの声で書かれている
2. 棄却ログ③にeditor_skipが理由付きで残る（passed_overが空の日は無くてよい）
3. 費用台帳の1日合計が$0.2×話題数以内
4. 白紙面の動作: 短冊を意図的に空にしたローカルテストでnone_reason付きissueが生成される

## 付録A スキーマ抜粋（データ定義書v1.2より転記）

**issue**: `date / editor(persona_id) / topics[]{item_id, serif, comment, body_read(bool), selection_reason} / passed_over[]{item_id, why}? / none_reason? / weather{...固定枠転記}`
**reject(stage3)**: `ts / stage:3 / id / reason(editor_skip|editor_none|capacity_cut|cost_overrun) / detail?`
**cost**: `ts / job(select|voice_select|voice_serif) / model / usage / cost_usd`

## 支給物SHA-256（LF正規化後・先頭16桁）

計算方法: `sed 's/\r$//' <file> | sha256sum`（CRLF環境ではLFに正規化してから照合すること。疑義#001の再発防止）
- S-3 profile/pool.yaml: `736a83bd263f15e6`
- S-4 profile/cards/cleade.yaml: `7b94f2b70819160a`
