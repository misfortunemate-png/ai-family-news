# 実装指示書 M1 v1.0

宛先: PG（Claude Code on フラン） ／ 発令: ショウゴさん ／ 仕様: docs/spec-m1.md

## 手順

1. `git pull` 後、docs/spec-m1.md とai-family-memoryの `ops/docs/family-news-datadef.md`（データ定義v1.1）を読む
2. 支給物確認: sources.yaml（S-1）・profile/preferences.md（S-2）が存在すること。SHA-256をdocs/reports/に記録
3. 骨格作成: devスキルtemplates準拠で _STATUS.md・CLAUDE.md・README.md・.env.example・run-local.bat/sh
4. scripts/lib/ → collect.mjs → select.mjs → stats.mjs → daily.yml → inspect.mjs の順に実装
5. sources.yaml全水源のテスト取得を実施。失敗水源は enabled:false ＋ notesに理由を記入（**URLの独自修正は1回まで試行可、それ以上は疑義起票**）
6. ローカルでdry-run→実採点（.envのOPENROUTER_API_KEYは発注者から受領）の順に試走
7. inspect.mjs合格後、docs/reports/report-m1.md（結果・SHA-256照合・テスト取得成否表・実測コスト）を書いてpush

## 宛先振り分け

仕様疑義→docs/reports/へ起票しPMへ ／ シークレット・キー・Actions有効化→発注者へ直接

## 完了条件

仕様書§5全項合格＋§6-1（dispatch2回）がグリーン。schedule実走（§6-2）は発注者検分に委ねる。
