# ai-family-news

毎朝06:00 JST に RSS/JSON を収集し DeepSeek で採点、候補短冊を生成するパイプライン。

## 状態確認
作業開始前に `_STATUS.md` を読み、現在のフェーズと未完了事項を確認すること。
作業中断時は `_STATUS.md` を更新してから終了すること。

## 技術スタック
- Node.js 20（ESM）
- fast-xml-parser（RSS/Atom解析）
- js-yaml（YAML出力）
- OpenRouter API（DeepSeek採点）

## テスト実行方法
```
DRY_RUN=1 node scripts/collect.mjs && DRY_RUN=1 node scripts/select.mjs
node scripts/inspect.mjs
```

## 規約
- コミットメッセージは日本語・概要1行
- 仕様書に記載のない判断が必要な場合は作業を停止し docs/reports/ へ疑義起票
- 仕様書に記載のないファイルを新規作成しない
- APIキーはコード・ログ・コミットへ出力禁止
- 指示書は docs/instructions/、報告は docs/reports/ を経由する
