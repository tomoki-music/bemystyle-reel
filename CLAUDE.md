# bemystyle-reel — Claude 作業ガイド

## 完了報告フォーマット

フェーズ実装が完了したら、必ず以下の構成で完了報告を行う。

### 報告項目

1. **変更ファイル一覧** — 変更したファイルを列挙
2. **各実装要件の仕様説明** — フェーズ仕様書に沿った項目ごとの説明
3. **動作確認結果** — 仕様書の「動作確認」リストをテーブルで ✅/❌ 表記
4. **既存機能への影響** — 影響なし・あり・注意点
5. **次フェーズ提案** — 次にやるべきことを簡潔に提案

### スタイル指針

- 各項目はマークダウンの `###` 見出しで区切る
- コードブロックは仕様の核心部分のみ（全コードは貼らない）
- テーブルは確認項目が多いときに使う
- 「変更しました」「追加しました」などの冗長な動詞説明は省く

---

## プロジェクト概要

- **editor/** — Vite + React + TypeScript の編集UI（メイン作業場所）
- **src/** — Remotion によるスライド動画レンダラー
- **editor/src/App.tsx** — アプリのメインコンポーネント（ほぼすべてのロジックが集中）
- **editor/src/types.ts** — 共通型定義
- **editor/src/storyGenerator.ts** — OpenAI を呼ぶAI生成ロジック

## 開発フロー

```bash
npm run editor   # 編集UIサーバー起動（http://localhost:5173）
npm run build    # editor のビルド（dist/ に出力）
npx tsc --noEmit # 型チェックのみ
```

## フェーズ命名規則

`Phase12-A`, `Phase12-B`, ... のようにアルファベット連番でフェーズを管理している。
各フェーズはユーザーが仕様書を貼るので、それに従って実装する。

## Phase12 進捗サマリー

| フェーズ | 内容 | 状態 |
|---|---|---|
| Phase12-A〜L | AIストーリー生成・画像生成・ワークフロー基盤 | 完了 |
| Phase12-M | プリセット→おすすめテンプレート自動適用 | 完了 |
| Phase12-N/O | AI生成履歴（保存・復元・エクスポート/インポート） | 完了 |
| Phase12-P | カスタムプリセット（追加・使用・削除・localStorage） | 完了 |
| Phase12-Q | カスタムプリセット エクスポート/インポート/全削除 | 完了 |
| Phase12-R | カスタムプリセット 編集・複製 | 完了 |
| Phase12-S | カスタムプリセット Favorite / useCount / sortOrder / 並び替え | 完了 |
| Phase12-T | CustomPreset Analytics Card（総使用・TOP3・人気CTA/スタイル） | 完了 |
| Phase12-U | CustomPreset Usage Logs（usedAt / lastUsedAt 記録・表示） | 完了 |
| Phase12-V | CustomPreset 7-Day Usage Chart（CSS棒グラフ） | 完了 |
| Phase12-W | CustomPreset Analytics CSV Export（BOM付き・全フィールド） | 完了 |
| Phase12-X | AI CustomPreset Insight（GPT-4o-mini による改善提案パネル） | 完了 |
| Phase12-Y | Create Preset from AI Insight（提案からワンクリック作成） | 完了 |
| Phase12-Z | Analytics Dashboard Collapse UX（折りたたみ・サマリー常時表示） | 完了 |
| Phase13-A | Render/Export UX Stabilization（再レンダリング・エラー表示・outputPath保存） | 完了 |
| Phase13-B | Render Preconditions / Safety Check（precheck表示・disabled条件・startRenderガード） | 完了 |
| Phase13-C | Render Progress Detail（経過秒数・ステップ表示・プログレスバー） | 完了 |
| Phase13-D | Post Render Actions（完了カード・DLボタン強調・URLコピー・履歴導線・再レンダリング） | 完了 |
| Phase13-E | SNS Caption Helper（投稿文生成API・YouTubeタイトル/説明文・Instagram文・ハッシュタグ・コピー） | 完了 |
| Phase13-F | SNS Caption History（SnsCaption型・履歴保存・バッジ表示・履歴復元） | 完了 |

## カスタムプリセット仕様メモ（Phase12-P/Q/S）

- localStorage key: `bemystyle-reel-custom-presets`
- 最大10件、id重複スキップ
- エクスポートファイル名: `bemystyle-reel-custom-presets.json`
- バリデーション: id/name/tone/targetAudience/platform/imageStyle/ctaText/createdAt 必須、presetKey は有効キーか空文字
- server.mjs の `effectivePreset` で STORY_PRESETS を上書きして AI 生成に反映
- Phase12-S 追加フィールド: `isFavorite?` / `useCount?` / `sortOrder?`（optional、既存データ互換）
- 表示順: isFavorite 優先 → sortOrder 昇順 → useCount 降順 → createdAt 新しい順
- ↑↓ 並び替え: isFavorite グループを跨いだ移動は不可（disabled）
- AI 生成時に selectedCustomPresetId がある場合、useCount を +1 して localStorage に即反映
