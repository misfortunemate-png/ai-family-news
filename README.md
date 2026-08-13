# ai-family-news

毎朝 06:00 JST に RSS/JSON を収集・採点し、候補短冊を生成するパイプライン（M1）。

## 構成

```
sources.yaml          水源台帳
profile/preferences.md 嗜好文書
scripts/collect.mjs   収集・正規化
scripts/select.mjs    採点・短冊生成
scripts/stats.mjs     集計表示
scripts/inspect.mjs   自己検査
.github/workflows/daily.yml 日次ワークフロー
data/items/           正規化済みアイテム (JSONL)
data/candidates/      候補短冊 (YAML)
logs/rejects/         棄却ログ (JSONL)
logs/costs/           費用台帳 (JSONL)
```

## ローカル実行

```bash
cp .env.example .env  # OPENROUTER_API_KEY を設定
./run-local.sh        # dry-run
```

## 必要シークレット

GitHub Actions Secrets に `OPENROUTER_API_KEY` を設定すること（発注者対応）。
