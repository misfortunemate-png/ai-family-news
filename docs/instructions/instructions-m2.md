# 実装指示書 M2 v1.0

宛先: PG（Claude Code on フラン） ／ 発令: ショウゴさん ／ 仕様: docs/spec-m2.md

## 手順

1. `git pull` 後、docs/spec-m2.md を読む（データ定義の抜粋は付録A。外部リポジトリへのアクセスは不要）
2. 支給物確認: S-3 pool.yaml・S-4 cards/cleade.yaml。SHA-256は**LF正規化後**（`sed 's/\r$//' <file> | sha256sum`）で照合し、結果をreportに記録
3. 是正4件（仕様§4）→ voice.mjs・article.mjs（§3）→ daily.yml（§5）→ inspect拡張 の順に実装
4. ローカル試走: 白紙面テスト（items空）→ dry-run → 実採点＋実声（.envのキー使用）の順
5. inspect合格後、docs/reports/report-m2.md（SHA照合・試走結果・実測コスト・生成された紙面の抜粋）をpush

## 宛先振り分け

仕様疑義→docs/reports/へ起票しPMへ ／ シークレット・Actions→発注者へ直接

## 完了条件

仕様§6の1〜4のうち、1〜3はPG実走で確認。4はローカルテストで確認。schedule実走は発注者検分。
