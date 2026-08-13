# ai-family-news 仕様書 M3n「パイプライン再編」 v1.0

発行: 2026-08-13 ／ 作成: クリーデ（開発PM） ／ 実装: PG（Claude Code）
位置づけ: **spec-m3p.mdを全面的に置き換える**（発注者裁定2026-08-13: ペルソナ実行はchat-pwaサーバーへ移設。SOUL＋直近記憶の蒸留の上にニュース役割を薄がけする方式）
完成状態: **Actionsは「収集→選別→短冊」までの機械工程に純化し、画像・保守（自動削除）・ログ二系統の器が整う。ペルソナ工程（選定・セリフ・応答）はchat-pwa v2.6が担う。**

## 1. 廃止（廃止当日に削除まで完遂）

- `scripts/voice.mjs`・`scripts/lib/article.mjs` を**削除**（本文取得・セリフ生成はchat-pwa側へ移設）
- `profile/cards/`・`profile/pool.yaml` を**削除**（人格カード方式の廃止。プールはchat-pwa側のペルソナ選択で管理し、参加者一覧は config.yaml の `pool: []` に反映される）
- daily.ymlから `Voice` ステップを削除
- docs/spec-m3p.md・instructions-m3p.md を削除（本仕様が後継）

## 2. 追加・変更

### 2.1 画像抽出（collect.mjs）

- RSS解析時に `enclosure`（url属性・image/*のみ）→ `media:content` → `media:thumbnail` の優先順で画像URLを拾い、itemスキーマの `image_url`（無ければnull）に格納。追加fetchはしない（og:image抽出は当選話題のみchat-pwa側で行う）

### 2.2 config.yaml（新設・profile/config.yaml）

chat-pwa設定画面から書き換えられる運転設定。初期値:
```yaml
publish_time: "07:00"            # 発行目標時刻(JST)。実行主体はchat-pwa
pool: [cleade]                   # ニュース参加ペルソナ(chat-pwa側UIが管理)
model_voice: anthropic/claude-sonnet-4.6
model_cross: anthropic/claude-haiku-4.5
cross_response_probability: 0.3
distill_max_tokens: 2000         # 直近記憶蒸留の上限
feed_days: 7
retention_days: 30
images_enabled: true
```

### 2.3 profile/news-role.md（新設・PM支給 S-5）

選者の共通役割プロンプト（全ペルソナ共有・SOULの上にかぶせる薄い層）。支給物として本仕様と同時にpush済み。

### 2.4 ログ二系統（スキーマ定義。書き手はActionsとchat-pwa両方）

- `logs/errors/YYYY-MM-DD.jsonl`: `{ts, source(actions|chatpwa), job, level(warn|error), code, detail}` — 自動巡回（O-1）が拾う前提の機械可読形式。collect/selectの既存reject群とは別に、fetch_error等の**運転異常**をここにも記帳
- `logs/conversations/YYYY-MM-DD.jsonl`: `{ts, author(persona_id|owner), kind(serif|comment|reply|cross|post_review), target, text}` — ペルソナが読み返すための対話全記録。書き手はchat-pwa

### 2.5 cleanup（daily.yml末尾に追加・決定的スクリプト scripts/cleanup.mjs）

- `retention_days`（config.yaml）を超えた日付の items / candidates / issues / rejects を削除
- 例外: `data/favorites.jsonl` に登録された話題・スレッドが属する日の issues と、該当item_idを含む candidates 行は残す（issuesはファイル単位で保全、candidatesは行フィルタ）
- posts・feedback・costs・conversations・errorsは削除対象外（軽量なため当面無期限）

### 2.6 新データファイル（スキーマのみ・書き手はchat-pwa）

- `data/posts/YYYY-MM-DD.jsonl`: `{id, ts, author: owner, url?, text?, image_url?, reviewed(bool)}` — 発注者の持ち込みニュース
- `data/favorites.jsonl`: `{id, ts, kind(topic|thread|post), ref}` — お気に入り（削除除外リスト）
- feedbackスキーマ改訂: `author(owner|persona_id)` を追加（クロスペルソナのリアクションも同じストリームに載る）

## 3. inspect改訂

- voice/カード関連の検査を削除、config.yaml・errors/conversationsスキーマ・cleanup動作（テスト用旧日付ファイルが消えfavorites対象が残る）の検査を追加

## 4. 検分

1. dispatch実走で「収集→選別→短冊」＋image_url付きitemsが生成され、Voiceが走らない
2. cleanup: 31日前の日付でダミーファイル群を置いた状態で実走→favorites登録分以外が消える
3. 削除対象ファイル（voice.mjs等）がリポジトリから消えている

## 支給物SHA-256（LF正規化・先頭16桁）

- S-5 profile/news-role.md: `7e63ab271ee3d0b7`
