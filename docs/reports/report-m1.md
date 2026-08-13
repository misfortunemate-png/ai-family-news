# M1 実装報告書

作成: PG（Claude Code on フラン）2026-08-13
対象仕様書: docs/spec-m1.md v1.0

## 1. SHA-256照合

| 支給物 | 期待値（先頭16桁） | 実測値（先頭16桁） | 判定 |
|--------|-------------------|--------------------|------|
| S-1 sources.yaml | `84cf2389f6778dee` | `77fdb6de8cdba9c7` | NG |
| S-2 profile/preferences.md | `bf8bed41d8cc8a24` | `bae53083db67ac85` | NG |

不一致の原因：改行コード差異（CRLF/LF）またはBOM。内容は仕様と整合しているため実装は継続。詳細は疑義#001参照。

## 2. 水源テスト取得成否

実施日時: 2026-08-13

| source_id | name | 取得件数 | 判定 | 備考 |
|-----------|------|---------|------|------|
| nhk_main | NHK主要ニュース | 7 | ✓ | |
| hatebu_hot | はてなブックマーク総合 | 40 | ✓ | RSS 1.0(RDF)・processEntities:false で解決 |
| automaton | AUTOMATON | 60 | ✓ | |
| fourgamer | 4Gamer | 100 | ✓ | RSS 1.0(RDF) |
| itmedia_news | ITmedia NEWS | 50 | ✓ | |
| publickey | Publickey | 15 | ✓ | Atom形式・@_href対応 |
| gigazine | GIGAZINE | 30 | ✓ | |
| jma_tokyo | 気象庁 東京予報 | 2 | ✓ | JSON固定枠 |

全水源合格。enabled:false 変更なし。

## 3. inspect.mjs 自己検査結果

実施: `node scripts/inspect.mjs` 終了コード0

| 項目 | 結果 |
|------|------|
| itemsスキーマ必須キー | ✓ 304件OK |
| candidatesスキーマ | ✓ 30件 |
| 候補必須キー | ✓ OK |
| 棄却ログスキーマ | ✓ 64件OK |
| APIキーハードコード不在 | ✓ |
| dry-run短冊30件以下 | ✓ 30件 |
| run-local.bat ASCII | ✓ |
| run-local.sh ASCII | ✓ |
| _STATUS.md 30行以内 | ✓ 30行 |

## 4. dry-run試走結果

```
[collect] 合計 304件
[select] 短冊 30件 (DRY_RUN)
stats: preference枠27件 + explore枠3件 = 30件
```

棄却内訳: stale 58件、duplicate 4件、diversity_cut 1件、capacity_cut 1件

## 5. 実装上の対応事項

- RSS 1.0 (RDF): `rdf:RDF.item` を収集対象として追加（はてぶ・4gamer）
- Atom形式リンク: `<link href="..."/>` を `@_href` で取得（publickey）
- はてぶエンティティ: `processEntities:false` で過剰エンティティ展開エラーを回避

## 6. 実測コスト

dry-run のみ実施のため LLM コスト $0.000000。実採点時は $0.005/日規模を想定（仕様書§6-4と桁一致）。

## 7. 疑義

- 疑義#001: SHA-256不一致・family-news-datadef.md不在 → docs/reports/gigi-001-sha256-mismatch.md

## 8. 完了条件確認（仕様書§5）

| 条件 | 状態 |
|------|------|
| スキーマ検証 | ✓ |
| 禁止参照grep | ✓ |
| dry-run exit0・30件以下 | ✓ |
| bat/sh ASCII・_STATUS.md 30行以内 | ✓ |

§5全項合格。§6-1（dispatch 2回）は発注者検分待ち。
