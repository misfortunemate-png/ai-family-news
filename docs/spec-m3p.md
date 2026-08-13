# ai-family-news 仕様書 M3p「感想への応答」 v1.0

発行: 2026-08-13 ／ 作成: クリーデ（開発PM） ／ 実装: PG（Claude Code）
前提: M2納品済み。フロント（chat-pwa v2.6）が data/feedback/ に感想を書き込む。本仕様はその帰還路のパイプライン側。
完成状態: **翌サイクルの当番が、未処理の感想（kind=comment）に応答セリフを書き、紙面のreplies節に載せ、処理済み消込が行われる。**

## 1. feedbackスキーマ（フロントと共有・書き込みはフロント）

`data/feedback/YYYY-MM.jsonl` 追記型。
`{id, ts, kind(reaction|comment|calibration), target(item_id|null), reaction?, text?, label?, processed(bool)}`

- voice.mjsが応答対象とするのは `kind=comment` かつ `processed=false` のみ
- reaction / calibration は応答不要。processedは触らない（M4庭仕事の材料として残す）

## 2. voice.mjs拡張

1. 選定コールの前に、当月と前月のfeedbackファイルから未処理commentを収集（最大5件・古い順）
2. セリフコールのsystemに応答役割を追記し、userに感想本文（＋targetがあれば該当話題のtitle）を追加
3. 出力JSONを拡張: `{topics: [...], replies: [{feedback_id, serif}]}` — repliesは感想ごとに1〜3文の応答。義務であって長文は不要
4. 紙面issueに `replies: [{feedback_id, serif}]` を記録
5. 応答済みcommentの `processed` を true に書き換え（jsonl行の置換・同一コミットでpush対象）
6. 未処理commentゼロの日はreplies節を省略（空配列を書かない）

## 3. 制約

- 感想が5件を超えて滞留していたら古い5件のみ応答し、残りは翌日へ（1日の応答上限）
- feedbackファイルのパース失敗行はスキップし棄却ログ③へ `feedback_parse_error`
- コスト・ガードは既存の枠内（セリフコールに同乗するため追加コールなし）

## 4. 検分

1. テスト用feedback（comment×2）を手置き→voice実走→紙面にreplies・processedがtrueになる
2. reaction/calibrationのみの日はreplies無しで正常完了

## 5. inspect追加

- feedbackスキーマ検査（存在する場合のみ）・repliesスキーマ検査
