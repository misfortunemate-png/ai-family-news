# M2 実装報告書

作成: PG（Claude Code on フラン）2026-08-13
対象仕様書: docs/spec-m2.md v1.0

## 1. SHA-256照合（LF正規化後）

| 支給物 | 期待値（先頭16桁） | 実測値 | 判定 |
|--------|-------------------|----|------|
| S-3 profile/pool.yaml | `736a83bd263f15e6` | `736a83bd263f15e6` | ✓ |
| S-4 profile/cards/cleade.yaml | `7b94f2b70819160a` | `7b94f2b70819160a` | ✓ |

## 2. 是正4件

| 番号 | 内容 | 実装場所 | 確認 |
|------|------|---------|------|
| 是正1 | title/summaryのHTMLエンティティデコード | collect.mjs: decodeEntities() | ✓ はてぶ日本語タイトル正常 |
| 是正2 | RSS 1.0のdc:dateをpublished_atに採用 | collect.mjs: e['dc:date'] | ✓ はてぶのpublished_at取得確認 |
| 是正3 | usage.costがあればcost_usdに採用 | select.mjs + voice.mjs | ✓ コード実装済 |
| 是正4 | issueスキーマ検査をinspectに追加 | inspect.mjs: checkIssueSchema() | ✓ inspect全項合格 |

## 3. ローカル試走結果

### 白紙面テスト（candidates空）
- 実行: `OPENROUTER_API_KEY="" node scripts/voice.mjs`
- 結果: `none_reason: no_scorable_candidates` の白紙面YAML生成 ✓
- issue内容:
  ```yaml
  date: '2026-08-13'
  editor: cleade
  topics: []
  none_reason: no_scorable_candidates
  weather: null
  ```

### dry-run（DRY_RUN=1）
```
[collect] 合計 304件（8水源全取得）
[select]  短冊 30件（DRY_RUNモード）
[voice]   DRY_RUN=1 のためスキップ
```

### 実採点+実声
ローカルに `.env` / `OPENROUTER_API_KEY` なし。§6-1〜3 はActions workflow_dispatch（dry_run=false）で発注者検分。

## 4. inspect結果（11項目全合格）

```
✓ itemsスキーマ必須キー: 304件OK
✓ candidatesスキーマ: 30件
✓ 候補必須キー: OK
✓ 棄却ログスキーマ: 78件OK
✓ 費用台帳スキーマ: OK
✓ APIキーハードコード不在
✓ dry-run短冊30件以下: 30件
✓ issue.yaml 存在: (voice未実行またはDRY_RUN)
✓ run-local.bat ASCII: OK
✓ run-local.sh ASCII: OK
✓ _STATUS.md 30行以内: 30行
```

## 5. 実測コスト

dry-runのため $0.00。実採点時の見積：
- select（DeepSeek）: ~$0.005/日
- voice（claude-sonnet-4.6）: 話題数×$0.2以内
- 合計: $0.2〜1.0/日（話題数依存）

## 6. 完了条件確認（仕様§6）

| 条件 | 状態 |
|------|------|
| §6-1 workflow_dispatch(false)で紙面YAML生成・セリフが人格カードの声 | Actions検分待ち |
| §6-2 棄却ログ③にeditor_skipが理由付きで残る | Actions検分待ち |
| §6-3 費用台帳1日合計が$0.2×話題数以内 | Actions検分待ち |
| §6-4 白紙面動作（none_reason付きissue生成） | ✓ ローカル確認済み |

## 7. 追加情報

- 抽選方式: `BigInt(parseInt(YYYYMMDD)) * 2654435761n % (2n**32n) % len`（仕様§3.1準拠）
- 本文取得失敗時: `body_read: false` でsummaryにフォールバック
- パース失敗時: 白紙面縮退（選定・セリフ両方対応）
