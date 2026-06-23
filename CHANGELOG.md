# CHANGELOG

## v1.0.0 (2026-06-23)

Initial Release

### 修正（RC1 → 1.0.0）

- `generateStory` の第1引数の型不一致（`string` → `StoryGenerationContext`）を4箇所修正
- `TelopPreviewCard` で `isSelected` / `onSelect` が destructuring されていなかったバグを修正
- `handleCaptionDelete` が `useEffect` の依存配列内で宣言前に参照されていたバグを修正

---

## v1.0.0-rc1 (2026-06-23)

Release Candidate 1

---

## 主要機能一覧

### ビジュアルエディタ（`editor/`）

| 機能 | 概要 |
|---|---|
| AI ストーリー生成 | GPT-4o によるスライドテキスト・構成の自動生成 |
| AI 画像生成 | DALL-E 3 による背景画像の自動生成（3並列・失敗時個別再試行） |
| テンプレート / プリセット | Standard / Event / Tutorial など複数テンプレート対応 |
| カスタムプリセット | ターゲット・トーン・CTA を保存・エクスポート（最大10件） |
| プロジェクト保存 | localStorage + `.json` エクスポート/インポート |
| AutoSave | 編集のたびに自動保存 |
| ウィザードモード | ステップ形式で動画を作成するガイド付きモード |
| ビデオエディタモード | 字幕（テロップ）を手動で詳細編集するモード |
| Undo / Redo | 最大50件の編集履歴（`Ctrl+Z` / `Ctrl+Y`） |
| BGM | ファイルアップロード・音量調整・プレビュー |
| SE（サウンドエフェクト） | スライドごとの効果音設定・音量調整 |
| Render | ブラウザ上から動画レンダリングをキューに追加・進捗確認 |
| Post Render Actions | 完了後のダウンロード・SNS キャプション生成・履歴保存 |
| SNS キャプション生成 | YouTube タイトル/説明文・Instagram 文・ハッシュタグを AI 生成 |
| Factory モード | 複数動画を連続生成するバッチ処理モード |
| Mass モード | 複数テーマを一括登録して連続生成 |
| Auto Render Pipeline | AI 生成 → キューレンダー → Compare Dashboard を 1 ボタンで実行 |
| Compare Dashboard | 複数バリアントの比較・Best 選定・スナップショット保存 |
| Analytics Dashboard | カスタムプリセットの使用統計・7日間チャート・CSV エクスポート |
| AI Insight | プリセット改善提案の AI 生成（GPT-4o-mini） |
| AI 生成履歴 | 生成結果の保存・復元・エクスポート/インポート |

### Remotion レンダラー（`src/`）

| 機能 | 概要 |
|---|---|
| スライドアニメーション | Ken Burns・フェード・スライドイン等のテキストアニメーション |
| 強調テキスト | headline 内の一部を薄紫色でハイライト |
| BGM | mp3 を動画全体に重ねて出力 |
| SE | スライドごとに効果音を挿入 |
| CTA スライド | ボタン・URL・補足テキストつきのラストスライド |
| 解像度 | 1080 × 1920 px / 30 FPS / H.264 mp4 |

---

## 既知の制限事項

- Remotion の `npm run render` はローカル実行のみ（CI/クラウド未対応）
- AI 画像生成は OpenAI API キーが必要（`.env` 要設定）
- カスタムプリセットは localStorage 保存のため、ブラウザ間で共有不可（エクスポートで対応）
- Mass モードで生成中にブラウザを閉じると途中から再開不可
- BGM・SE のブラウザプレビューはコーデックの制約で一部環境で音が出ない場合あり
- Render サーバー（`server.mjs`）はローカル専用（認証なし）

---

## 今後の予定

- v1.0.0 正式リリース
- クラウドレンダリング対応（Remotion Lambda）
- プロジェクトの複数管理（プロジェクト選択画面）
- テンプレートギャラリーの拡充
- チーム共有機能（プリセット・プロジェクトのクラウド同期）
