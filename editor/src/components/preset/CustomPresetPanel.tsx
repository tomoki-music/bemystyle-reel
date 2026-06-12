import { useMemo } from 'react'
import type React from 'react'
import type { TemplateInfo } from '../../types'
import type { AIPresetKey, CustomPreset } from '../../storyGenerator'
import {
  PRESET_TEMPLATE_CATEGORY_MAP,
  type PresetInsight,
  type RecommendedPreset,
} from '../story/useStoryGenerator'

type AIPresetOption = {
  key: AIPresetKey
  label: string
  description: string
}

type CustomPresetForm = {
  name: string
  presetKey: AIPresetKey | ''
  tone: string
  targetAudience: string
  platform: string
  imageStyle: string
  ctaText: string
}

type CustomPresetAnalytics = {
  totalUse: number
  favoriteCount: number
  top3: CustomPreset[]
  recentlyUsed: CustomPreset[]
  last7Days: number
  todayCount: number
  usageByDay: { date: string; label: string; count: number }[]
  chartMax: number
  topCta?: [string, number]
  topStyle?: [string, number]
}

type CustomPresetPanelProps = {
  aiPresets: AIPresetOption[]
  selectedPresetKey: AIPresetKey | ''
  onSelectPresetKey: (key: AIPresetKey | '') => void
  isGenerating: boolean
  isRendering: boolean
  autoApplyRecommendedTemplate: boolean
  onChangeAutoApplyRecommendedTemplate: (value: boolean) => void
  autoApplyTemplateNotice: string
  templates: TemplateInfo[]
  usageMap: Record<string, number>
  onConfirmLoadTemplate: (id: string) => void
  customPresets: CustomPreset[]
  customPresetForm: CustomPresetForm
  onChangeCustomPresetForm: React.Dispatch<React.SetStateAction<CustomPresetForm>>
  selectedCustomPresetId: string
  presetImportNotice: string
  presetImportRef: React.RefObject<HTMLInputElement>
  editingCustomPresetId: string
  onChangeEditingCustomPresetId: (id: string) => void
  editingCustomPresetForm: CustomPresetForm | null
  onChangeEditingCustomPresetForm: React.Dispatch<React.SetStateAction<CustomPresetForm | null>>
  presetInsight: PresetInsight | null
  isGeneratingPresetInsight: boolean
  presetInsightError: string
  createdInsightIndices: Set<number>
  isAnalyticsExpanded: boolean
  onToggleAnalyticsExpanded: () => void
  onSaveCustomPreset: () => void
  onDeleteCustomPreset: (id: string) => void
  onUseCustomPreset: (preset: CustomPreset) => void
  onExportCustomPresets: () => void
  onImportCustomPresets: (e: React.ChangeEvent<HTMLInputElement>) => void
  onSaveEditCustomPreset: () => void
  onDuplicateCustomPreset: (preset: CustomPreset) => void
  onClearCustomPresets: () => void
  onExportAnalyticsCsv: () => void
  onGeneratePresetInsight: () => void
  onSaveInsightPreset: (preset: RecommendedPreset, index: number) => void
  onToggleFavoriteCustomPreset: (id: string) => void
  onMoveCustomPreset: (id: string, direction: 'up' | 'down') => void
}

export function CustomPresetPanel({
  aiPresets,
  selectedPresetKey,
  onSelectPresetKey,
  isGenerating,
  isRendering,
  autoApplyRecommendedTemplate,
  onChangeAutoApplyRecommendedTemplate,
  autoApplyTemplateNotice,
  templates,
  usageMap,
  onConfirmLoadTemplate,
  customPresets,
  customPresetForm,
  onChangeCustomPresetForm,
  selectedCustomPresetId,
  presetImportNotice,
  presetImportRef,
  editingCustomPresetId,
  onChangeEditingCustomPresetId,
  editingCustomPresetForm,
  onChangeEditingCustomPresetForm,
  presetInsight,
  isGeneratingPresetInsight,
  presetInsightError,
  createdInsightIndices,
  isAnalyticsExpanded,
  onToggleAnalyticsExpanded,
  onSaveCustomPreset,
  onDeleteCustomPreset,
  onUseCustomPreset,
  onExportCustomPresets,
  onImportCustomPresets,
  onSaveEditCustomPreset,
  onDuplicateCustomPreset,
  onClearCustomPresets,
  onExportAnalyticsCsv,
  onGeneratePresetInsight,
  onSaveInsightPreset,
  onToggleFavoriteCustomPreset,
  onMoveCustomPreset,
}: CustomPresetPanelProps) {
  const { sortedCustomPresets, customPresetAnalytics, suggestedTemplates } = useMemo(() => {
    const sortedCustomPresets = [...customPresets].sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1
      if (!a.isFavorite && b.isFavorite) return 1
      const ao = a.sortOrder ?? Infinity
      const bo = b.sortOrder ?? Infinity
      if (ao !== bo) return ao - bo
      const ac = a.useCount ?? 0
      const bc = b.useCount ?? 0
      if (ac !== bc) return bc - ac
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

    let customPresetAnalytics: CustomPresetAnalytics | null = null
    if (customPresets.length > 0) {
      const now = Date.now()
      const todayStr = new Date().toISOString().slice(0, 10)
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

      const totalUse = customPresets.reduce((s, p) => s + (p.useCount ?? 0), 0)
      const favoriteCount = customPresets.filter((p) => p.isFavorite).length

      let last7Days = 0
      let todayCount = 0
      for (const p of customPresets) {
        for (const ts of p.usedAt ?? []) {
          const t = new Date(ts).getTime()
          if (t >= sevenDaysAgo) last7Days++
          if (ts.slice(0, 10) === todayStr) todayCount++
        }
      }

      const top3 = [...customPresets]
        .filter((p) => (p.useCount ?? 0) > 0)
        .sort((a, b) => (b.useCount ?? 0) - (a.useCount ?? 0))
        .slice(0, 3)

      const recentlyUsed = [...customPresets]
        .filter((p) => p.lastUsedAt)
        .sort((a, b) => new Date(b.lastUsedAt!).getTime() - new Date(a.lastUsedAt!).getTime())
        .slice(0, 5)

      const usageByDay: { date: string; label: string; count: number }[] = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now - i * 24 * 60 * 60 * 1000)
        usageByDay.push({ date: d.toISOString().slice(0, 10), label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, count: 0 })
      }
      const ctaMap: Record<string, number> = {}
      const styleMap: Record<string, number> = {}
      for (const p of customPresets) {
        const cnt = p.useCount ?? 0
        if (p.ctaText) ctaMap[p.ctaText] = (ctaMap[p.ctaText] ?? 0) + cnt
        if (p.imageStyle) styleMap[p.imageStyle] = (styleMap[p.imageStyle] ?? 0) + cnt
        for (const ts of p.usedAt ?? []) {
          const day = usageByDay.find((d) => d.date === ts.slice(0, 10))
          if (day) day.count++
        }
      }
      const chartMax = Math.max(...usageByDay.map((d) => d.count), 1)
      const topCta = Object.entries(ctaMap).sort((a, b) => b[1] - a[1])[0]
      const topStyle = Object.entries(styleMap).sort((a, b) => b[1] - a[1])[0]
      customPresetAnalytics = { totalUse, favoriteCount, top3, recentlyUsed, last7Days, todayCount, usageByDay, chartMax, topCta, topStyle }
    }

    let suggestedTemplates: { items: TemplateInfo[]; isFallback: boolean } | null = null
    if (selectedPresetKey) {
      const categories = PRESET_TEMPLATE_CATEGORY_MAP[selectedPresetKey]
      const matched = templates.filter((t) => categories.includes(t.category ?? '')).slice(0, 3)
      if (matched.length > 0) {
        suggestedTemplates = { items: matched, isFallback: false }
      } else {
        const fallback = [...templates]
          .sort((a, b) => (usageMap[b.id] ?? 0) - (usageMap[a.id] ?? 0))
          .slice(0, 3)
        suggestedTemplates = { items: fallback, isFallback: true }
      }
    }

    return { sortedCustomPresets, customPresetAnalytics, suggestedTemplates }
  }, [customPresets, selectedPresetKey, templates, usageMap])

  return (
    <div className="ai-generator">
      <p className="ai-generator-label">用途プリセット</p>
      <div className="ai-preset-list">
        {aiPresets.map((preset) => {
          const isActive = selectedPresetKey === preset.key
          return (
            <button
              key={preset.key}
              className={`ai-preset-btn${isActive ? ' ai-preset-btn--active' : ''}`}
              onClick={() => onSelectPresetKey(isActive ? '' : preset.key)}
              disabled={isGenerating || isRendering}
              title={preset.description}
            >
              {isActive && <span className="ai-preset-badge">選択中</span>}
              {preset.label}
            </button>
          )
        })}
      </div>
      <label className="ai-auto-apply-toggle">
        <input
          type="checkbox"
          checked={autoApplyRecommendedTemplate}
          onChange={(e) => onChangeAutoApplyRecommendedTemplate(e.target.checked)}
          disabled={isGenerating || isRendering}
        />
        おすすめテンプレートを自動で使う
      </label>
      {autoApplyRecommendedTemplate && (
        <p className="ai-auto-apply-desc">
          プリセット選択時に、最適なテンプレートを自動で読み込みます。
        </p>
      )}
      {autoApplyTemplateNotice && (
        <p className={`ai-auto-apply-notice${autoApplyTemplateNotice.includes('見つかりません') ? ' ai-auto-apply-notice--warn' : ' ai-auto-apply-notice--ok'}`}>
          {autoApplyTemplateNotice}
        </p>
      )}
      {selectedPresetKey && (
        <p className="ai-preset-desc">
          {aiPresets.find((p) => p.key === selectedPresetKey)?.description}
        </p>
      )}
      {suggestedTemplates && suggestedTemplates.items.length > 0 && (
        <div className="ai-recommended">
          <p className="ai-recommended-label">
            {suggestedTemplates.isFallback ? '人気テンプレート（該当なし時）' : 'おすすめテンプレート'}
          </p>
          {suggestedTemplates.items.map((t) => (
            <div key={t.id} className="ai-recommended-card">
              <div className="ai-recommended-card-header">
                <span className="ai-recommended-card-name" title={t.name}>{t.name}</span>
                {t.category && (
                  <span className="ai-recommended-card-cat">{t.category}</span>
                )}
              </div>
              {t.description && (
                <p className="ai-recommended-card-desc">{t.description}</p>
              )}
              <button
                className="ai-recommended-use-btn"
                onClick={() => !isRendering && onConfirmLoadTemplate(t.id)}
                disabled={isRendering}
              >
                このテンプレートを使う
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="custom-preset-section">
        <div className="custom-preset-header-row" style={{ marginTop: 10 }}>
          <p className="ai-generator-label" style={{ margin: 0 }}>カスタムプリセット</p>
          <div className="custom-preset-header-actions">
            <button
              className="custom-preset-io-btn"
              onClick={onExportCustomPresets}
              disabled={customPresets.length === 0}
              title="カスタムプリセットをJSONでダウンロード"
            >
              エクスポート
            </button>
            <button
              className="custom-preset-io-btn"
              onClick={() => presetImportRef.current?.click()}
              title="JSONファイルからインポート"
            >
              インポート
            </button>
            <input
              ref={presetImportRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={onImportCustomPresets}
            />
            <button
              className="custom-preset-io-btn custom-preset-io-btn--danger"
              onClick={onClearCustomPresets}
              disabled={customPresets.length === 0}
              title="保存済みプリセットをすべて削除"
            >
              すべて削除
            </button>
          </div>
        </div>
        {customPresetAnalytics && (
          <div className="cp-analytics-card">
            <div className="cp-analytics-header">
              <p className="cp-analytics-title">📊 CustomPreset Analytics</p>
              <button
                className="cp-analytics-expand-btn"
                onClick={onToggleAnalyticsExpanded}
              >
                {isAnalyticsExpanded ? '閉じる' : '詳細を見る'}
              </button>
            </div>
            <div className="cp-analytics-summary">
              <span>総プリセット数：<strong>{customPresets.length}</strong></span>
              <span>Favorite：<strong>{customPresetAnalytics.favoriteCount}</strong></span>
              <span>総使用回数：<strong>{customPresetAnalytics.totalUse}</strong></span>
              <span>今日：<strong>{customPresetAnalytics.todayCount}</strong></span>
              <span>直近7日：<strong>{customPresetAnalytics.last7Days}</strong></span>
            </div>
            {isAnalyticsExpanded && (
              <div className="cp-analytics-details">
                <div className="cp-analytics-block">
                  <p className="cp-analytics-block-label">📈 直近7日間の使用推移</p>
                  <div className="cp-analytics-chart">
                    {customPresetAnalytics.usageByDay.map((day) => (
                      <div key={day.date} className="cp-analytics-bar">
                        <span className="cp-analytics-bar-count">{day.count > 0 ? day.count : ''}</span>
                        <div
                          className="cp-analytics-bar-fill"
                          style={{ '--bar-h': `${Math.round((day.count / customPresetAnalytics.chartMax) * 40)}px` } as React.CSSProperties}
                        />
                        <span className="cp-analytics-bar-label">{day.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {customPresetAnalytics.top3.length > 0 && (
                  <div className="cp-analytics-block">
                    <p className="cp-analytics-block-label">よく使うプリセット TOP3</p>
                    {customPresetAnalytics.top3.map((p, i) => (
                      <div key={p.id} className="cp-analytics-row">
                        <span className="cp-analytics-rank">{i + 1}.</span>
                        <span className="cp-analytics-name">{p.name}</span>
                        <span className="cp-analytics-count">{p.useCount}回</span>
                      </div>
                    ))}
                  </div>
                )}
                {customPresetAnalytics.recentlyUsed.length > 0 && (
                  <div className="cp-analytics-block">
                    <p className="cp-analytics-block-label">最近使われたプリセット</p>
                    {customPresetAnalytics.recentlyUsed.map((p) => (
                      <div key={p.id} className="cp-analytics-row">
                        <span className="cp-analytics-name">{p.name}</span>
                        <span className="cp-analytics-last-used">{new Date(p.lastUsedAt!).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    ))}
                  </div>
                )}
                {customPresetAnalytics.topCta && customPresetAnalytics.topCta[1] > 0 && (
                  <div className="cp-analytics-block">
                    <p className="cp-analytics-block-label">人気CTA</p>
                    <div className="cp-analytics-row">
                      <span className="cp-analytics-name">{customPresetAnalytics.topCta[0]}</span>
                      <span className="cp-analytics-count">{customPresetAnalytics.topCta[1]}回</span>
                    </div>
                  </div>
                )}
                {customPresetAnalytics.topStyle && customPresetAnalytics.topStyle[1] > 0 && (
                  <div className="cp-analytics-block">
                    <p className="cp-analytics-block-label">人気画像スタイル</p>
                    <div className="cp-analytics-row">
                      <span className="cp-analytics-name">{customPresetAnalytics.topStyle[0]}</span>
                      <span className="cp-analytics-count">{customPresetAnalytics.topStyle[1]}回</span>
                    </div>
                  </div>
                )}
                <div className="cp-analytics-block">
                  <button
                    className="cp-analytics-csv-btn"
                    onClick={onExportAnalyticsCsv}
                    disabled={customPresets.length === 0}
                    title="利用状況をCSVでダウンロード"
                  >
                    CSVエクスポート
                  </button>
                </div>
                <div className="cp-insight-trigger">
                  <button
                    className="cp-insight-btn"
                    onClick={onGeneratePresetInsight}
                    disabled={isGeneratingPresetInsight || customPresets.length === 0}
                  >
                    {isGeneratingPresetInsight ? '分析中…' : '🤖 AI改善提案'}
                  </button>
                </div>
                {presetInsightError && (
                  <p className="cp-insight-error">{presetInsightError}</p>
                )}
                {presetInsight && (
                  <div className="cp-insight-panel">
                    <p className="cp-analytics-block-label">🤖 AI改善提案</p>
                    <p className="cp-insight-summary">{presetInsight.summary}</p>
                    {presetInsight.strongestPresets.length > 0 && (
                      <div className="cp-insight-section">
                        <p className="cp-insight-section-label">勝ちパターン</p>
                        <ul className="cp-insight-list">
                          {presetInsight.strongestPresets.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {presetInsight.improvementIdeas.length > 0 && (
                      <div className="cp-insight-section">
                        <p className="cp-insight-section-label">改善できるプリセット</p>
                        <ul className="cp-insight-list">
                          {presetInsight.improvementIdeas.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {presetInsight.recommendedCombinations.length > 0 && (
                      <div className="cp-insight-section">
                        <p className="cp-insight-section-label">おすすめ新プリセット案</p>
                        {presetInsight.recommendedCombinations.map((combo, i) => (
                          <div key={i} className="cp-insight-combo-card">
                            <div className="cp-insight-combo-header">
                              <span className="cp-insight-combo-name">{combo.name || 'AI提案プリセット'}</span>
                              <button
                                className={`cp-insight-create-btn${createdInsightIndices.has(i) ? ' cp-insight-create-btn--done' : ''}`}
                                onClick={() => onSaveInsightPreset(combo, i)}
                                disabled={createdInsightIndices.has(i) || customPresets.length >= 10}
                                title={customPresets.length >= 10 ? 'プリセットは最大10件です' : undefined}
                              >
                                {createdInsightIndices.has(i) ? '作成済み ✓' : 'このプリセットを作成'}
                              </button>
                            </div>
                            {combo.reason && <p className="cp-insight-combo-reason">{combo.reason}</p>}
                            <div className="cp-insight-combo-tags">
                              {combo.platform && <span className="cp-insight-combo-tag">{combo.platform}</span>}
                              {combo.tone && <span className="cp-insight-combo-tag">{combo.tone}</span>}
                              {combo.ctaText && <span className="cp-insight-combo-tag">CTA: {combo.ctaText}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {presetImportNotice && (
          <p className={`custom-preset-import-notice${presetImportNotice.includes('失敗') ? ' custom-preset-import-notice--error' : ' custom-preset-import-notice--ok'}`}>
            {presetImportNotice}
          </p>
        )}
        <div className="custom-preset-form">
          <p className="custom-preset-form-label">カスタムプリセットを追加</p>
          <input
            className="custom-preset-input"
            type="text"
            placeholder="名前"
            value={customPresetForm.name}
            onChange={(e) => onChangeCustomPresetForm((prev) => ({ ...prev, name: e.target.value }))}
          />
          <select
            className="custom-preset-select"
            value={customPresetForm.presetKey}
            onChange={(e) => onChangeCustomPresetForm((prev) => ({ ...prev, presetKey: e.target.value as AIPresetKey | '' }))}
          >
            <option value="">ベースプリセット（なし）</option>
            {aiPresets.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
          <input
            className="custom-preset-input"
            type="text"
            placeholder="トーン"
            value={customPresetForm.tone}
            onChange={(e) => onChangeCustomPresetForm((prev) => ({ ...prev, tone: e.target.value }))}
          />
          <input
            className="custom-preset-input"
            type="text"
            placeholder="対象読者"
            value={customPresetForm.targetAudience}
            onChange={(e) => onChangeCustomPresetForm((prev) => ({ ...prev, targetAudience: e.target.value }))}
          />
          <input
            className="custom-preset-input"
            type="text"
            placeholder="プラットフォーム"
            value={customPresetForm.platform}
            onChange={(e) => onChangeCustomPresetForm((prev) => ({ ...prev, platform: e.target.value }))}
          />
          <input
            className="custom-preset-input"
            type="text"
            placeholder="画像スタイル"
            value={customPresetForm.imageStyle}
            onChange={(e) => onChangeCustomPresetForm((prev) => ({ ...prev, imageStyle: e.target.value }))}
          />
          <input
            className="custom-preset-input"
            type="text"
            placeholder="CTA"
            value={customPresetForm.ctaText}
            onChange={(e) => onChangeCustomPresetForm((prev) => ({ ...prev, ctaText: e.target.value }))}
          />
          <button
            className="custom-preset-save-btn"
            onClick={onSaveCustomPreset}
            disabled={
              !customPresetForm.name ||
              !customPresetForm.tone ||
              !customPresetForm.targetAudience ||
              !customPresetForm.platform ||
              !customPresetForm.imageStyle ||
              !customPresetForm.ctaText
            }
          >
            保存
          </button>
        </div>
        {sortedCustomPresets.length > 0 && (
          <div className="custom-preset-list">
            {sortedCustomPresets.map((preset, sortedIdx) => {
              const isSelected = selectedCustomPresetId === preset.id
              const isEditing = editingCustomPresetId === preset.id
              const canMoveUp = sortedIdx > 0 && !(!preset.isFavorite && sortedCustomPresets[sortedIdx - 1]?.isFavorite)
              const canMoveDown = sortedIdx < sortedCustomPresets.length - 1 && !(preset.isFavorite && !sortedCustomPresets[sortedIdx + 1]?.isFavorite)
              return (
                <div key={preset.id} className={`custom-preset-card${isSelected ? ' custom-preset-card--active' : ''}`}>
                  {isEditing && editingCustomPresetForm ? (
                    <div className="custom-preset-edit-form">
                      <input
                        className="custom-preset-input"
                        type="text"
                        placeholder="名前"
                        value={editingCustomPresetForm.name}
                        onChange={(e) => onChangeEditingCustomPresetForm((prev) => prev && ({ ...prev, name: e.target.value }))}
                      />
                      <select
                        className="custom-preset-select"
                        value={editingCustomPresetForm.presetKey}
                        onChange={(e) => onChangeEditingCustomPresetForm((prev) => prev && ({ ...prev, presetKey: e.target.value as AIPresetKey | '' }))}
                      >
                        <option value="">ベースプリセット（なし）</option>
                        {aiPresets.map((p) => (
                          <option key={p.key} value={p.key}>{p.label}</option>
                        ))}
                      </select>
                      <input
                        className="custom-preset-input"
                        type="text"
                        placeholder="トーン"
                        value={editingCustomPresetForm.tone}
                        onChange={(e) => onChangeEditingCustomPresetForm((prev) => prev && ({ ...prev, tone: e.target.value }))}
                      />
                      <input
                        className="custom-preset-input"
                        type="text"
                        placeholder="対象読者"
                        value={editingCustomPresetForm.targetAudience}
                        onChange={(e) => onChangeEditingCustomPresetForm((prev) => prev && ({ ...prev, targetAudience: e.target.value }))}
                      />
                      <input
                        className="custom-preset-input"
                        type="text"
                        placeholder="プラットフォーム"
                        value={editingCustomPresetForm.platform}
                        onChange={(e) => onChangeEditingCustomPresetForm((prev) => prev && ({ ...prev, platform: e.target.value }))}
                      />
                      <input
                        className="custom-preset-input"
                        type="text"
                        placeholder="画像スタイル"
                        value={editingCustomPresetForm.imageStyle}
                        onChange={(e) => onChangeEditingCustomPresetForm((prev) => prev && ({ ...prev, imageStyle: e.target.value }))}
                      />
                      <input
                        className="custom-preset-input"
                        type="text"
                        placeholder="CTA"
                        value={editingCustomPresetForm.ctaText}
                        onChange={(e) => onChangeEditingCustomPresetForm((prev) => prev && ({ ...prev, ctaText: e.target.value }))}
                      />
                      <div className="custom-preset-edit-actions">
                        <button
                          className="custom-preset-edit-save-btn"
                          onClick={onSaveEditCustomPreset}
                          disabled={
                            !editingCustomPresetForm.name ||
                            !editingCustomPresetForm.tone ||
                            !editingCustomPresetForm.targetAudience ||
                            !editingCustomPresetForm.platform ||
                            !editingCustomPresetForm.imageStyle ||
                            !editingCustomPresetForm.ctaText
                          }
                        >
                          保存
                        </button>
                        <button
                          className="custom-preset-edit-cancel-btn"
                          onClick={() => { onChangeEditingCustomPresetId(''); onChangeEditingCustomPresetForm(null) }}
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="custom-preset-card-header">
                        <button
                          className={`custom-preset-fav-btn${preset.isFavorite ? ' custom-preset-fav-btn--active' : ''}`}
                          onClick={() => onToggleFavoriteCustomPreset(preset.id)}
                          title="お気に入り"
                        >
                          {preset.isFavorite ? '⭐' : '☆'}
                        </button>
                        <span className="custom-preset-card-name">{preset.name}</span>
                        {preset.presetKey && (
                          <span className="custom-preset-card-base">
                            {aiPresets.find((p) => p.key === preset.presetKey)?.label ?? preset.presetKey}
                          </span>
                        )}
                      </div>
                      <div className="custom-preset-use-count">
                        使用回数 {preset.useCount ?? 0}
                      </div>
                      <div className="custom-preset-card-body">
                        <span className="custom-preset-tag">トーン: {preset.tone}</span>
                        <span className="custom-preset-tag">対象: {preset.targetAudience}</span>
                        <span className="custom-preset-tag">PF: {preset.platform}</span>
                        <span className="custom-preset-tag">スタイル: {preset.imageStyle}</span>
                        <span className="custom-preset-tag">CTA: {preset.ctaText}</span>
                      </div>
                      <div className="custom-preset-card-actions">
                        <button
                          className={`custom-preset-use-btn${isSelected ? ' custom-preset-use-btn--active' : ''}`}
                          onClick={() => onUseCustomPreset(preset)}
                        >
                          {isSelected ? '適用中' : '使用'}
                        </button>
                        <button
                          className="custom-preset-edit-btn"
                          onClick={() => {
                            onChangeEditingCustomPresetId(preset.id)
                            onChangeEditingCustomPresetForm({
                              name: preset.name,
                              presetKey: preset.presetKey,
                              tone: preset.tone,
                              targetAudience: preset.targetAudience,
                              platform: preset.platform,
                              imageStyle: preset.imageStyle,
                              ctaText: preset.ctaText,
                            })
                          }}
                        >
                          編集
                        </button>
                        <button
                          className="custom-preset-duplicate-btn"
                          onClick={() => onDuplicateCustomPreset(preset)}
                        >
                          複製
                        </button>
                        <button
                          className="custom-preset-delete-btn"
                          onClick={() => onDeleteCustomPreset(preset.id)}
                        >
                          削除
                        </button>
                        <button
                          className="custom-preset-move-btn"
                          onClick={() => onMoveCustomPreset(preset.id, 'up')}
                          disabled={!canMoveUp}
                          title="上に移動"
                        >↑</button>
                        <button
                          className="custom-preset-move-btn"
                          onClick={() => onMoveCustomPreset(preset.id, 'down')}
                          disabled={!canMoveDown}
                          title="下に移動"
                        >↓</button>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
