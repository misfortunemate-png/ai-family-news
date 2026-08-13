# 報告書 M3n「パイプライン再編」

発行: 2026-08-13 ／ 作成: PG（Claude Code）

## 1. 廃止確認（仕様§1）

| 対象 | 状態 |
|------|------|
| `scripts/voice.mjs` | 削除済み |
| `scripts/lib/article.mjs` | 削除済み |
| `profile/cards/` （cleade.yaml含む） | 削除済み |
| `profile/pool.yaml` | 削除済み |
| `docs/spec-m3p.md` / `instructions-m3p.md` | 元々存在しない（M3p未着工） |

## 2. 支給物確認（S-5）

- `profile/news-role.md` SHA-256（LF正規化・先頭16桁）: `7e63ab271ee3d0b7` ✓

## 3. 追加・変更確認

| 項目 | 内容 |
|------|------|
| `profile/config.yaml` 新設 | §2.2の初期値で作成済み |
| `collect.mjs` 画像抽出 | enclosure→media:content→media:thumbnail の優先順、image_url（null可）をitemスキーマに追加 |
| `scripts/cleanup.mjs` 新設 | retention_days超の items/candidates/issues/rejects を削除。favorites保全ロジック実装済み |
| `logs/errors/.gitkeep` 新設 | §2.4 errorsログディレクトリ |
| `logs/conversations/.gitkeep` 新設 | §2.4 conversationsログディレクトリ |
| `inspect.mjs` 改訂 | voice/card検査削除。config.yaml・ログディレクトリ・cleanup動作の検査を追加（全21項目） |

## 4. inspect結果（全21項目合格）

```
=== inspect 2026-08-13 ===

✓ itemsスキーマ必須キー: 304件OK
✓ candidatesスキーマ: 28件
✓ 候補必須キー: OK
✓ 棄却ログスキーマ: 586件OK
✓ 費用台帳スキーマ: OK
✓ APIキーハードコード不在
✓ dry-run短冊30件以下: 28件
✓ config.yaml 存在
✓ config.yaml必須キー: OK
✓ retention_days正値: 30
✓ logs/errors/ 存在
✓ logs/conversations/ 存在
✓ cleanup.mjs存在
✓ cleanup実行: OK
✓ cleanup items削除
✓ cleanup rejects削除
✓ cleanup issues保全
✓ cleanup candidates行フィルタ: 1件(期待1件)
✓ run-local.bat ASCII: OK
✓ run-local.sh ASCII: OK
✓ _STATUS.md 30行以内: 30行

--- 結果: 21項目中 0件失敗 ---
全項目合格
```

## 5. §4 検分状況

| # | 内容 | 状態 |
|---|------|------|
| §4-1 | dispatch実走で収集→選別→短冊＋image_url付きitemsが生成され、Voiceが走らない | **→ daily.yml貼り替え後に発注者確認** |
| §4-2 | cleanup: favorites対象が残り、それ以外が消える | ✓ inspect cleanup動作テストで確認済み |
| §4-3 | 削除対象ファイルがリポジトリから消えている | ✓ 確認済み |

## 6. daily.yml 貼り替え依頼

⚠️ **発注者にお願い**: `.github/workflows/daily.yml` を GitHub UI で以下の内容に置き換えてください。
変更点: **Voiceステップ削除** / **Cleanupステップ追加**（SelectとCommitの間）

```yaml
name: daily
on:
  schedule:
    - cron: '0 21 * * *'
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'LLM採点をスキップ'
        type: boolean
        default: false

permissions:
  contents: write

jobs:
  pipeline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'

      - run: npm ci

      - name: Collect
        run: node scripts/collect.mjs

      - name: Select
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          DRY_RUN: ${{ inputs.dry_run && '1' || '0' }}
        run: node scripts/select.mjs

      - name: Cleanup
        run: node scripts/cleanup.mjs

      - name: Commit & Push
        run: |
          git config user.name "family-news-bot"
          git config user.email "bot@family-news"
          DATE=$(date -u +%Y-%m-%d)
          ITEMS=$(cat data/items/${DATE}.jsonl 2>/dev/null | wc -l || echo 0)
          CANDS=$(grep -c 'id:' data/candidates/${DATE}.yaml 2>/dev/null || echo 0)
          git add data/ logs/
          git diff --cached --quiet || git commit -m "[daily] ${DATE} 収集${ITEMS}件 短冊${CANDS}件"
          git pull --rebase -X ours
          git push
```

貼り替え後、`workflow_dispatch`（dry_run=true）で動作確認をお願いします。
