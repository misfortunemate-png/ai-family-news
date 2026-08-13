# 実装指示書 M3p v1.0

宛先: PG（Claude Code on フラン） ／ 発令: ショウゴさん ／ 仕様: docs/spec-m3p.md

## 手順
1. `git pull` → docs/spec-m3p.md を読む
2. voice.mjs拡張（仕様§2）→ inspect拡張（§5）
3. テスト用feedbackを `data/feedback/2026-08.jsonl` に手置きし、ローカルで §4-1〜2 を確認（.envキーがあれば実走、なければ白紙面経路＋ユニット的確認で可。実走検分は発注者のdispatchに委ねる）
4. テストで置いたfeedback行は検分用にそのまま残してよい（processed=trueになった状態が検分証跡になる）
5. docs/reports/report-m3p.md をpush

## 完了条件
inspect合格＋§4の確認記録。
