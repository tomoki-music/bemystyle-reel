# 強調語の候補ID選択方式（not-in-text を原理的に防ぐ設計）

## 背景

AI に強調語の文字列を自由に生成させると、本文にない文字列・長すぎる文字列が返り、候補単位で拒否しても有効な強調が不足する
（5分検証の試行2では、強調5件のうち本文不一致3件・長すぎ1件）。

## 方式

1. **ローカルで候補生成**（`server/lib/emphasisCandidates.mjs`）: caption 本文から、語（Intl.Segmenter）単位の連続 1〜4 語を候補にする。
   2〜10文字・句読点/空白を含まない・先頭は内容語・末尾は助詞でない・助詞だけ/文全体に近いものを除外・同一 caption 内は文字列重複を除外。
   すべて本文の完全な部分文字列で、`start`/`end`（位置）を保持する。
2. **安定した candidate ID**: `${captionId}:e${start}-${end}`。同じ本文なら何度生成しても同じ。
3. **AI は candidate ID だけを選ぶ**: 入力は `buildCandidateSelectionInput`（各 caption の候補 `{id, text}` 一覧）、応答 schema は
   `candidateId / category / confidence` のみで、強調語の文字列フィールドを持たない。
4. **ローカルで復元**: `resolveEmphasisSelection` が、ID から本文の `slice(start, end)` を取り出す（AIの文字列は使わない）。
   未知の ID・本文と食い違う候補（stale）・1caption に複数の選択・category/confidence 不正は、その候補だけを拒否する。

## 保証

- 復元される強調語は常に caption 本文の完全な部分文字列（not-in-text は発生しない）。
- 文字数（2〜10）・助詞/句読点だけでない・文全体でない、は生成時に保証される。
- 手動で追加した強調（source:'manual'）は従来どおり AI 候補より優先される。

## 現状

ロジック・検証・テストまで実装済み。現在の `analyze`（自由文字列方式）はまだ差し替えていない。差し替える場合は、
`buildAnalysisRequestBody` の強調部分を `buildCandidateSelectionInput` / `buildCandidateSelectionSchema` に置き換え、
応答を `resolveEmphasisSelection` に通す（新しい API 試行の許可が必要）。
