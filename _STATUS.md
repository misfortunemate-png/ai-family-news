---
version: M3n
badge: M3n実装完了・dispatch検分待ち
next: daily.yml貼り替え → workflow_dispatch(dry_run=true)で§4-1確認
waiting_on: owner
---
# プロジェクトステータス

プロジェクト: ai-family-news
最終更新: 2026-08-13 21:30
更新者: PG

## 現在のフェーズ
Phase M3n: パイプライン再編

## 完了事項（M3n）
- 廃止: voice.mjs, article.mjs, cards/, pool.yaml
- profile/config.yaml 新設（§2.2）
- profile/news-role.md SHA256確認済み（7e63ab271ee3d0b7）
- collect.mjs: 画像抽出追加（enclosure→media:content→media:thumbnail）
- scripts/cleanup.mjs 新設（§2.5）
- logs/errors/, logs/conversations/ ディレクトリ作成
- inspect.mjs 改訂（voice検査削除・config/ログ/cleanup検査追加）
- inspect全21項目合格

## 未完了事項
- daily.yml貼り替え（Voiceステップ削除・Cleanupステップ追加）→ report-m3n.md参照
- §4-1: dispatch実走でimage_url付き/Voice不走行の確認（発注者）

## 次のアクション
- 誰が: 発注者
- 何を: docs/reports/report-m3n.md の daily.yml を GitHub UI で貼り替え後、dispatch実走
