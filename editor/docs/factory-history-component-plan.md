# Factory History Component Extraction Plan

Phase16-B: 設計メモ / Phase16-M: 実装完了・進捗更新

---

## 実装状況

**Phase16-C〜L にて全コンポーネントの分離完了。**

| コンポーネント | 状態 |
|---|---|
| `FactoryPanel` | ✅ 実装済み |
| `FactoryRunSection` | ✅ 実装済み |
| `FactorySummaryCard` | ✅ 実装済み |
| `FactoryHistoryPanel` | ✅ 実装済み |
| `FactoryHistoryStats` | ✅ 実装済み |
| `FactoryHistoryFilters` | ✅ 実装済み |
| `FactoryHistoryBulkBar` | ✅ 実装済み |
| `FactoryHistoryItemCard` | ✅ 実装済み |
| `FactoryHistoryActions` | ✅ 実装済み |
| `FactoryHistoryTags` | ✅ 実装済み |

---

## 現在のコンポーネント構造

```text
FactoryPanel
  ├─ FactoryRunSection
  ├─ FactorySummaryCard
  └─ FactoryHistoryPanel
       ├─ FactoryHistoryBulkBar
       ├─ FactoryHistoryStats
       ├─ FactoryHistoryFilters
       └─ FactoryHistoryItemCard
            ├─ FactoryHistoryActions
            └─ FactoryHistoryTags
```

---

## ファイル配置（実装済み）

```text
editor/src/
  components/
    factory/
      FactoryPanel.tsx
      FactoryRunSection.tsx
      FactorySummaryCard.tsx
      FactoryHistoryPanel.tsx
      FactoryHistoryStats.tsx
      FactoryHistoryFilters.tsx
      FactoryHistoryBulkBar.tsx
      FactoryHistoryItemCard.tsx
      FactoryHistoryActions.tsx
      FactoryHistoryTags.tsx
```

---

## 責務分離ルール

```text
App.tsx
- state管理
- localStorage更新
- API通信
- Factory Run本体
- Render Queue / Compare連携
- computed values生成

components/factory/*
- 表示
- props callback呼び出し
- localStorage/APIに触らない
- stateを持たない（FactoryHistoryPanel: filter/search/selection状態のみ例外）
```

### App.tsx に残るもの

| 項目 | 理由 |
|---|---|
| `localStorage` 読み書き | 他コンポーネントとのデータ共有、副作用の一元管理 |
| Factory Run 本体 | API呼び出し・Queue管理は副作用が大きい |
| Render Queue 連携 | RenderQueue状態はApp全体で共有 |
| Compare Dashboard 連携 | Compare用エントリ選択状態はApp全体で共有 |
| 大域エラー/ローディング状態 | 複数コンポーネントに影響する状態 |

---

## Phase16-C〜L 実施ログ

| フェーズ | コンポーネント | 概要 |
|---|---|---|
| Phase16-C | `FactorySummaryCard` | 集計数値・KPI表示（Presentational、副作用なし） |
| Phase16-D | `FactoryHistoryStats` | タグ統計・使用率グラフ表示（読み取り専用） |
| Phase16-E | `FactoryHistoryFilters` | Search/Filter/TagFilter UIと状態 |
| Phase16-F | `FactoryHistoryBulkBar` | 一括選択・一括削除バー表示 |
| Phase16-G | `FactoryHistoryActions` | Reuse/Duplicate/Rerun/Delete ボタン群 |
| Phase16-H | `FactoryHistoryTags` | カード内タグ表示・編集UI |
| Phase16-I | `FactoryHistoryItemCard` | 1件分の履歴カード（Actions/Tagsを統合） |
| Phase16-J | `FactoryHistoryPanel` | 履歴リスト全体・filter/search/selection状態保持 |
| Phase16-K | `FactoryRunSection` | Factory実行セクション（パラメータ入力・実行ボタン） |
| Phase16-L | `FactoryPanel` | Factory全体レイアウト・タブ切り替え（最終統合） |

---

## Compare Dashboard コンポーネント構成（Phase16-P〜T 実装済み）

```text
CompareDashboardPanel
  ├─ CompareDashboardHeader        （見出し描画）
  ├─ LastPipelineSummaryCard       （Last Pipeline 結果サマリー、null → return null）
  ├─ CompareSummaryCard            （完了件数・Best variant 名表示）
  ├─ BestVariantAnalysisPanel      （AI Best Variant Analysis、Best 未選択時は非表示）
  └─ CompareVariantCard × N        （完了バリアントのカード一覧）
```

### ファイル配置

```text
editor/src/
  components/
    compare/
      CompareDashboardPanel.tsx    （配置専用・ロジックなし）
      CompareDashboardHeader.tsx   （見出しのみ）
      LastPipelineSummaryCard.tsx  （Last Pipeline サマリー）
      CompareSummaryCard.tsx       （件数・Best 名サマリー）
      BestVariantAnalysisPanel.tsx （AI 分析結果パネル）
      CompareVariantCard.tsx       （1 バリアント分のカード）
```

### 責務分離ルール（Compare）

```text
App.tsx
- renderQueue / completedVariants 管理
- bestVariantId / expandedSnapshotIds / expandedDiffIds 管理
- rewriteExplainResults / loadingIds / errors 管理
- bestVariantAnalysis / loading / error 管理
- API呼び出し（analyze, explainRewrite）

components/compare/*
- 表示のみ
- state / localStorage / API に触らない
- props callback 経由でのみ親に通知
```

---

## 次フェーズ候補

| フェーズ候補 | 対象 |
|---|---|
| Phase16-U | Render Queue component extraction |
| Phase16-V | SNS Caption section extraction |
| Phase16-W | Factory types shared file extraction（`types.ts` の Factory関連型を分離） |

---

## Props設計メモ（参考）

### FactorySummaryCard

```typescript
type FactorySummaryCardProps = {
  totalCount: number;
  successCount: number;
  failedCount: number;
  favoriteCount: number;
};
// callbackなし / local stateなし
```

### FactoryHistoryStats

```typescript
type FactoryHistoryStatsProps = {
  entries: FactoryHistoryEntry[];
};
// callbackなし / local state: 表示折りたたみ状態のみ可
```

### FactoryHistoryFilters

```typescript
type FactoryHistoryFiltersProps = {
  searchText: string;
  onSearchChange: (text: string) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  presetFilter: string;
  onPresetFilterChange: (preset: string) => void;
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
  availableTags: string[];
};
// local state: 入力中のIME状態のみ可
```

### FactoryHistoryItemCard

```typescript
type FactoryHistoryItemCardProps = {
  entry: FactoryHistoryEntry;
  isSelected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onFavorite: (id: string) => void;
  onReuse: (entry: FactoryHistoryEntry) => void;
  onDuplicate: (entry: FactoryHistoryEntry) => void;
  onRerun: (entry: FactoryHistoryEntry) => void;
  onDelete: (id: string) => void;
  onTagAdd: (id: string, tag: string) => void;
  onTagRemove: (id: string, tag: string) => void;
  onThemeEdit: (entry: FactoryHistoryEntry) => void;
};
// local state: 展開/折りたたみ状態のみ可
```

### FactoryHistoryBulkBar

```typescript
type FactoryHistoryBulkBarProps = {
  selectedIds: string[];
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkDelete: () => void;
};
// callbackなし / local stateなし
```

### FactoryHistoryPanel

```typescript
type FactoryHistoryPanelProps = {
  entries: FactoryHistoryEntry[];
  onUpdate: (entries: FactoryHistoryEntry[]) => void;  // localStorage更新は親経由
  onReuse: (entry: FactoryHistoryEntry) => void;
  onRerun: (entry: FactoryHistoryEntry) => void;
};
// local state: filter/search/selection状態を保持
```

### FactoryPanel

```typescript
type FactoryPanelProps = {
  entries: FactoryHistoryEntry[];
  onUpdate: (entries: FactoryHistoryEntry[]) => void;
  onReuse: (entry: FactoryHistoryEntry) => void;
  onRerun: (entry: FactoryHistoryEntry) => void;
  onRunFactory: () => void;
};
// local state: タブ選択状態のみ
```

---

## 含まれる機能（参考）

| 機能 | 概要 |
|---|---|
| Summary | 生成件数・成功率などの集計表示 |
| History List | 生成履歴の一覧表示 |
| Search | テキスト検索 |
| Filter | ステータス・プリセット等による絞り込み |
| Tag Filter | タグによる絞り込み |
| Tag Stats | タグ別の使用統計 |
| Favorite | お気に入り登録・解除 |
| Reuse | 過去のパラメータを再利用 |
| Duplicate | 履歴エントリの複製 |
| Rerun | 同一パラメータで再生成 |
| Delete | 単件削除 |
| Bulk Delete | 複数件選択削除 |
| Import / Export | JSON形式での履歴入出力 |
| Theme Edit | テーマの編集 |
| Tag Edit | タグの追加・削除 |

---

---

## App.tsx 責務棚卸し（Phase16-U）

更新日: 2026-06-04

### state 一覧（グループ別）

| グループ | state 変数 | 個数 |
|---|---|---|
| コアエディタ | slides, ctaConfig, title, selectedId, loading, saved, saveStatus, saveError, hasUnsavedChanges | 9 |
| シングルレンダー | renderStatus, renderError, isPreparingRender, renderStartedAt, elapsedSec, latestDownloadUrl | 6 |
| レンダー履歴 | history, historyError | 2 |
| SNS キャプション | snsCaption, isGeneratingSnsCaption, snsCaptionError, copiedSnsField, copiedUrl | 5 |
| テンプレート管理 | templates, selectedTemplateId, templateConfirmPending, templateHints, saveTemplateModal, saveTemplateName, saveTemplateCategory, saveTemplateDescription, saveTemplateStatus | 9 |
| テンプレート変数 | rawTemplateSlides, templateVariableKeys, variableValues | 3 |
| AI 生成 | aiTheme, selectedPresetKey, isGenerating, generateError, generateSuccess | 5 |
| 自動テンプレ適用 | autoApplyRecommendedTemplate, autoApplyTemplateNotice | 2 |
| AI 生成履歴 | aiGenerationHistory, importNotice | 2 |
| Render Queue / Batch | renderVariantName, renderQueue, isBatchRendering, bestVariantId, autoGenerateNotice | 5 |
| AI バリアント生成 | generatedVariants, isGeneratingVariants, variantGenerateError | 3 |
| AI ストーリーリライト | rewrittenStories, isRewritingStory, rewriteStoryError | 3 |
| バリアント学習 | variantLearningEvents | 1 |
| AI バリアントスコア | variantScores, isScoringVariants, variantScoreError | 3 |
| Smart Queue | smartQueueMessage | 1 |
| Auto Render Pipeline | isAutoPipelineRunning, pipelineStatus, lastPipeline | 3 |
| Best Variant Analyzer | bestVariantAnalysis, isAnalyzingBestVariant, bestVariantAnalysisError | 3 |
| Smart Pipeline | isSmartPipelineRunning, smartPipelineStatus, smartPipelineError, lastSmartPipeline | 4 |
| Smart Rewrite Pipeline | isSmartRewritePipelineRunning, smartRewritePipelineStatus, smartRewritePipelineError, lastSmartRewritePipeline | 4 |
| Multi Rewrite Queue | isMultiRewriteQueueRunning, multiRewriteQueueStatus, multiRewriteQueueError, lastMultiRewriteQueue | 4 |
| Factory 実行 | factoryRunning, factoryStep, factoryError, factoryLog, factorySummary, factoryNotice | 6 |
| Factory History UI | factoryHistory, editingFactoryHistoryTags, editingFactoryHistoryTag, factoryHistoryFilter, factoryHistorySearch, factoryHistorySelectedTag, editingFactoryHistoryTheme, selectedFactoryHistoryIds | 8 |
| Snapshot / Diff | expandedSnapshotIds, expandedDiffIds | 2 |
| AI Rewrite Explain | rewriteExplainResults, rewriteExplainLoadingIds, rewriteExplainErrors | 3 |
| カスタムプリセット | customPresets, customPresetForm, selectedCustomPresetId, presetImportNotice | 4 |
| AI Insight | presetInsight, isGeneratingPresetInsight, presetInsightError, createdInsightIndices, isAnalyticsExpanded | 5 |
| カスタムプリセット編集 | editingCustomPresetId, editingCustomPresetForm | 2 |
| 画像生成 | imageGeneratingId, imageGenerateErrors | 2 |
| 一括画像生成 | bulkImageGenerating, bulkImageProgress, bulkImageMessage | 3 |
| AI ワークフロー | workflowStep, workflowMessage, workflowError, autoWorkflowRunning | 4 |
| 生成済みアセット | generatedAssets, assetsLoading, assetsMessage | 3 |
| テンプレートギャラリー UI | templateSearch, selectedCategory, recentTemplateIds, renameTemplateId, renameTemplateName, renameTemplateStatus, deleteConfirmId, deleteStatus | 8 |
| ギャラリー表示設定 | viewMode, sortOrder, usageMap | 3 |
| **合計** | | **~130** |

---

### handler / helper 一覧（グループ別）

| グループ | 主な関数 |
|---|---|
| データ取得 | fetchGeneratedAssets, fetchHistory, fetchTemplates |
| テンプレート CRUD | confirmLoadTemplate, loadTemplate, saveAsTemplate, duplicateTemplate, deleteTemplate, renameTemplate, handleVariableChange |
| AI 生成 | handleAIGenerate |
| AI 生成履歴 | deleteAIGenerationHistoryItem, clearAIGenerationHistory, updateLatestHistory, exportAIGenerationHistory, handleImport, handleReuseHistory |
| カスタムプリセット | handleSaveCustomPreset, handleDeleteCustomPreset, handleUseCustomPreset, handleExportCustomPresets, handleImportCustomPresets, handleSaveEditCustomPreset, handleDuplicateCustomPreset, handleClearCustomPresets, handleExportAnalyticsCsv, handleGeneratePresetInsight, handleSaveInsightPreset, handleToggleFavoriteCustomPreset, handleMoveCustomPreset |
| バリアント / Queue | scoreVariants, recordLearningEvent, clearLearningData, handleExplainRewrite, selectBestVariant, autoGenerateVariants, addToQueue, removeFromQueue, clearQueue, toggleSnapshotPreview, toggleDiffView, generateAIVariants, rewriteStory, applyRewrittenStory, addVariantToQueue, addAllVariantsToQueue, addSmartQueue, updateQueueItem |
| パイプライン | batchRender, handleAutoRenderPipeline, handleSmartPipeline, handleSmartRewritePipeline, handleMultiRewriteQueue |
| Factory | findFactoryQueueItem, handleJumpToQueueItem, handleRunReelFactory, showFactoryNotice, handleReuseFactoryTheme, handleDuplicateFactoryTheme, handleRerunFactoryTheme, toggleFactoryHistoryFavorite, handleExportFactoryHistory, handleExportFactoryHistoryCsv, handleImportFactoryHistory, handleDeleteFactoryHistoryItem, toggleFactoryHistorySelection, handleBulkDeleteFactoryHistory, handleClearFactoryHistory, handleFactoryTagInputChange, addFactoryHistoryTagValue, addFactoryHistoryTag, removeFactoryHistoryTag, saveFactoryHistoryTagEdit, saveFactoryHistoryThemeEdit |
| Best Variant | analyzeBestVariant |
| レンダー / ポーリング | stopPolling, startPolling, startRender, toggleFavorite |
| ワークフロー | handleWorkflowStory, handleWorkflowImages, handleWorkflowSave, handleWorkflowRender, handleAutoWorkflow |
| エディタ操作 | updateSlide, toggleVisible, moveSlide, handleCtaChange, saveSnapshotToServer, saveToServer |
| 画像生成 | handleGenerateImage, handleGenerateAllImages |
| Post Render | downloadVideo, copyRenderUrl, scrollToHistory, generateSnsCaption, copySnsText |
| アセット管理 | deleteGeneratedAsset, deleteUnusedAssets |
| ユーティリティ | formatHistoryDate, formatSize, downloadJSON |
| モジュールレベル | inferFactoryTags, escapeCsvValue, isFactoryHistoryItem, renderInlineDiff, renderDiffPanel, extractTemplateVariables, applyTemplateVariables |

---

### 責務分類：残す / 切り出し候補

| 責務 | 判定 | 理由 |
|---|---|---|
| slides / ctaConfig / title / selectedId | **App に残す** | 複数コンポーネント（Preview・Form・Render 等）が参照 |
| saveToServer / startRender / startPolling | **App に残す** | API + localStorage の副作用を一元管理 |
| batchRender / handleAutoRenderPipeline / handleSmartPipeline | **App に残す** | パイプライン全体を制御するオーケストレーター |
| handleRunReelFactory | **App に残す** | Factory API 呼び出し・Queue 連携の中核 |
| renderQueue / bestVariantId / expandedSnapshotIds / expandedDiffIds / rewriteExplain* | **App に残す** | Compare Dashboard 全体で共有 |
| **Factory History UI state**（factoryHistoryFilter / Search / SelectedTag / editingTag / editingTheme / selectedIds） | **切り出し候補 ①** | FactoryHistoryPanel 専用の UI state → local state に移管可能 |
| **Template Gallery UI state**（templateSearch / selectedCategory / viewMode / sortOrder / renameTemplateId / renameTemplateName / renameTemplateStatus / deleteConfirmId / deleteStatus） | **切り出し候補 ②** | テンプレートギャラリー専用 → TemplateGalleryPanel コンポーネントに委譲可能 |
| **Custom Preset form state**（customPresetForm / editingCustomPresetId / editingCustomPresetForm / isAnalyticsExpanded） | **切り出し候補 ③** | Custom Preset UI 専用 → CustomPresetPanel コンポーネントに委譲可能 |
| renderStatus / renderError / isPreparingRender / renderStartedAt / elapsedSec / pipelineStatus | **切り出し候補 ④** | Render Progress 表示専用 → RenderProgressPanel コンポーネントに切り出し可能 |
| モジュールレベルヘルパー（renderInlineDiff / renderDiffPanel / extractTemplateVariables 等） | **切り出し候補 ⑤** | utils ファイルへの移動で App.tsx 冒頭を整理できる |

---

### 次フェーズ候補

| フェーズ候補 | 対象 | 削減見込み |
|---|---|---|
| **Phase16-V** | Factory History UI state の FactoryHistoryPanel local state 化（factoryHistoryFilter / Search / Tag / editingTag / editingTheme / selectedIds を FactoryPanel → FactoryHistoryPanel に降ろす） | App から ~8 state 削減 |
| **Phase16-W** | Template Gallery UI state の TemplateGalleryPanel 分離（templateSearch / selectedCategory / viewMode / sortOrder / rename* / deleteConfirmId / deleteStatus） | App から ~8 state 削減 |
| **Phase16-X** | Custom Preset Panel 分離（customPresetForm / editingCustomPresetId / editingCustomPresetForm / isAnalyticsExpanded） | App から ~4 state 削減 |
| **Phase16-Y** | RenderProgressPanel 分離（renderStatus / renderError / isPreparingRender / renderStartedAt / elapsedSec / pipelineStatus の UI 切り出し） | 表示ロジックの集約 |
| **Phase16-Z** | モジュールレベルヘルパーを utils/ に移動（renderInlineDiff / renderDiffPanel / extractTemplateVariables / applyTemplateVariables / inferFactoryTags 等） | App.tsx 冒頭 ~150 行削減 |

---

## 作成日

2026-06-01 (Phase16-B)  
更新日: 2026-06-04 (Phase16-U — App.tsx 責務棚卸し)
