---
version: M2
badge: M2実装完了・Actions検分待ち
next: workflow_dispatch(dry_run=false)で紙面確認
waiting_on: owner
---
# プロジェクトステータス

プロジェクト: ai-family-news
最終更新: 2026-08-13 12:00
更新者: PG

## 現在のフェーズ
Phase M2: 抽選と声

## 完了事項
- 是正4件（エンティティデコード・dc:date・usage.cost・issueスキーマ検査）
- scripts/lib/article.mjs 実装
- scripts/voice.mjs 実装（抽選・選定・本文読解・セリフ・紙面生成）
- daily.yml: node 24化・Voiceステップ追加
- inspect全11項目合格
- 白紙面テスト合格・dry-run合格

## 未完了事項
- 実採点+実声ローカル試走（.envなし → Actions検分に委譲）

## 次のアクション
- 誰が: 発注者
- 何を: workflow_dispatch(dry_run=false)で§6-1〜3を検分
