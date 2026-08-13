# 実装指示書 M3n v1.0

宛先: PG（Claude Code on フラン・ai-family-newsリポジトリ） ／ 発令: ショウゴさん ／ 仕様: docs/spec-m3n.md

## 手順
1. `git pull` → docs/spec-m3n.md を読む
2. 廃止（仕様§1）を先に完遂: voice.mjs・article.mjs・cards/・pool.yaml・spec-m3p系の削除、daily.ymlのVoiceステップ除去
3. 支給物確認: S-5 news-role.md（LF正規化SHA照合）。config.yaml は仕様§2.2の初期値で新規作成
4. collect.mjs画像抽出（§2.1）→ cleanup.mjs（§2.5）→ ログ器（§2.4のディレクトリと.gitkeep）→ inspect改訂（§3）
5. 検分§4の1〜3をローカル＋dispatchで確認し、docs/reports/report-m3n.md をpush

## 完了条件
仕様§4全項＋inspect合格。daily.ymlの変更はGitHub UI経由が必要なため、変更後のdaily.yml全文をreportに添付し発注者に貼り替えを依頼する。
