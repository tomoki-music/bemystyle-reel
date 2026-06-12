import React, { useState, useRef } from 'react'
import { FactoryRunSection } from './FactoryRunSection'
import { FactorySummaryCard } from './FactorySummaryCard'
import { FactoryHistoryPanel } from './FactoryHistoryPanel'
import { FactoryThemeInput } from './FactoryThemeInput'
import type { ReelAiConfig } from '../../types'

type GeneratedSlide = { id: number; headline: string; image: string }

type FactoryHistoryItemLike = {
  id: string
  theme: string
  favorite?: boolean
  tags?: string[]
  generatedAt: string
  generatedCount: number
  selectedCount: number
  averageRecommendation: number
  queueAddedCount: number
  bestVariantName: string
  bestRecommendation: number
  topVariants: { name: string; recommendation: number }[]
}

type FactorySummaryData = {
  generatedCount: number
  selectedCount: number
  averageRecommendation: number
  bestVariantName: string
  bestRecommendation: number
  queueAddedCount: number
  generatedAt: string
  topVariants: {
    name: string
    recommendation: number
    predictedViews?: number
    savePotential?: number
    ctaStrength?: number
  }[]
}

type FactoryPanelProps = {
  theme?: {
    value: string
    isGenerating?: boolean
    generateError?: string
    generateSuccess?: boolean
    quotaError?: boolean
    onChange: (v: string) => void
    onGenerate?: () => void
    onQuotaErrorDismiss?: () => void
  }
  run: {
    isRunning: boolean
    step: string
    stepNum: number
    progress: number
    currentImageIndex: number | null
    totalImageCount: number | null
    error: string
    log: string[]
    notice: string
    warning: string
    isPipelineDisabled: boolean
    hasTheme: boolean
    reelAiConfig: ReelAiConfig
    reuseImageMode?: boolean
    onRun: () => void
  }
  summary: {
    data: FactorySummaryData | null
    findQueueItem: (variantName: string) => { id: string; variantName: string } | undefined
    onClear: () => void
    onJumpToQueueItem: (variantName: string) => void
  }
  gallery: {
    generatedSlides: GeneratedSlide[]
  }
  history: {
    items: FactoryHistoryItemLike[]
    maxThemeLength: number
    quickTags: string[]
    onUpdate: (items: FactoryHistoryItemLike[]) => void
    onToggleFavorite: (id: string) => void
    onReuseTheme: (theme: string) => void
    onDuplicateTheme: (theme: string) => void
    onRerunFactory: (theme: string) => void
    onDelete: (id: string) => void
    onExportJson: () => void
    onExportCsv: () => void
    onImportFile: (file: File) => void
    onClear: () => void
  }
  viewState?: {
    hideHistory?: boolean
  }
}

function FactoryHomeCard({ hasTheme, onFocusThemeInput }: { hasTheme: boolean; onFocusThemeInput?: () => void }) {
  return (
    <div className="factory-home-card">
      <div className="factory-home-header">
        <p className="factory-home-title">SNS動画をまとめて作る</p>
        <ol className="factory-home-steps">
          <li className="factory-home-step"><span className="factory-home-step-num">1</span>テーマを追加</li>
          <li className="factory-home-step"><span className="factory-home-step-num">2</span>自動処理を選ぶ</li>
          <li className="factory-home-step"><span className="factory-home-step-num">3</span>開始ボタンを押す</li>
          <li className="factory-home-step"><span className="factory-home-step-num">4</span>投稿準備を進める</li>
        </ol>
      </div>
      <p className="factory-home-guide-text">
        この画面では、複数のSNS動画をまとめて準備できます。<br />
        テーマを入れて開始すれば、投稿前のチェックまで進められます。
      </p>
      <span className="factory-home-recommend-badge">おすすめ：Story + 画像 + キュー投入</span>
      {!hasTheme && (
        <button className="factory-home-cta" onClick={onFocusThemeInput}>
          まずテーマを追加する
        </button>
      )}
    </div>
  )
}

function GeneratedImageGallery({ slides }: { slides: GeneratedSlide[] }) {
  const [open, setOpen] = useState(false)
  if (slides.length === 0) return null
  return (
    <div className="factory-image-gallery">
      <button className="factory-image-gallery-toggle" onClick={() => setOpen((v) => !v)}>
        <span>🖼️ 生成済み画像 ({slides.length}枚)</span>
        <span className="factory-image-gallery-chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="factory-image-gallery-grid">
          {slides.map((s) => (
            <div key={s.id} className="factory-image-gallery-item">
              <img
                src={`/assets/${s.image}`}
                alt={s.headline || `スライド ${s.id}`}
                className="factory-image-gallery-thumb"
              />
              <p className="factory-image-gallery-label">{s.id}. {s.headline?.slice(0, 12) || '—'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function FactoryPanel({
  theme,
  run,
  summary,
  gallery,
  history,
  viewState,
}: FactoryPanelProps) {
  const themeInputRef = useRef<HTMLInputElement>(null)

  const focusThemeInput = () => {
    themeInputRef.current?.focus()
    themeInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const showDevModePanel =
    run.reelAiConfig.aiMode === 'mock' ||
    run.reelAiConfig.dryRun ||
    run.reelAiConfig.testImageLimit !== null

  const showThemeSection = theme !== undefined
  const hideHistory = viewState?.hideHistory ?? false

  return (
    <div className="factory-panel">
      <p className="factory-panel-title">🏭 AI自動作成</p>
      <FactoryHomeCard
        hasTheme={run.hasTheme}
        onFocusThemeInput={showThemeSection ? focusThemeInput : undefined}
      />
      {showThemeSection && (
        <>
          <FactoryThemeInput
            heading="作りたい動画のテーマを追加"
            example="例：6月のMMMセッション会を紹介"
            inputValue={theme.value}
            onInputValueChange={theme.onChange}
            onAdd={theme.onGenerate ?? (() => {})}
            addLabel={theme.onGenerate ? 'ストーリー生成' : undefined}
            isAddDisabled={!theme.value.trim() || theme.isGenerating}
            isDisabled={theme.isGenerating}
            placeholder="テーマを入力..."
            inputRef={themeInputRef}
          />
          {theme.generateError && !theme.quotaError && (
            <p className="ai-generator-error">{theme.generateError}</p>
          )}
          {theme.quotaError && (
            <div className="quota-error-panel">
              <p className="quota-error-title">OpenAI APIの利用枠が不足しています</p>
              <ol className="quota-error-steps">
                <li>Billing のクレジット残高を確認</li>
                <li>Usage の利用状況を確認</li>
                <li>Limits の月間上限を確認</li>
                <li>Project / Organization の予算設定を確認</li>
              </ol>
              <p className="quota-error-alt">「自分の画像を使う」を選ぶとAI画像生成なしで動画化できます。</p>
              <button className="btn-quota-error-dismiss" onClick={theme.onQuotaErrorDismiss} type="button">閉じる</button>
            </div>
          )}
          {theme.generateSuccess && !theme.generateError && (
            <p className="ai-generator-success">14枚のストーリーを生成しました</p>
          )}
        </>
      )}
      {showDevModePanel && (
        <div className="dev-mode-panel">
          <p className="dev-mode-panel__title">開発モード中</p>
          <div className="dev-mode-panel__grid">
            {run.reelAiConfig.aiMode === 'mock' && (
              <div className="dev-mode-panel__item">
                <span>AI</span>
                <strong>Mock</strong>
              </div>
            )}
            {run.reelAiConfig.dryRun && (
              <div className="dev-mode-panel__item">
                <span>動画生成</span>
                <strong>Dry Run</strong>
              </div>
            )}
            {run.reelAiConfig.testImageLimit !== null && (
              <div className="dev-mode-panel__item">
                <span>画像生成上限</span>
                <strong>{run.reelAiConfig.testImageLimit}枚</strong>
              </div>
            )}
          </div>
          <p className="dev-mode-panel__warning">
            この設定では本番用動画は生成されません。動作確認用です。
          </p>
        </div>
      )}
      <FactoryRunSection
        factoryRunning={run.isRunning}
        factoryStep={run.step}
        factoryStepNum={run.stepNum}
        factoryProgress={run.progress}
        factoryCurrentImageIndex={run.currentImageIndex}
        factoryTotalImageCount={run.totalImageCount}
        factoryError={run.error}
        factoryLog={run.log}
        factoryNotice={run.notice}
        factoryWarning={run.warning}
        isPipelineDisabled={run.isPipelineDisabled}
        hasTheme={run.hasTheme}
        reuseImageMode={run.reuseImageMode}
        onRunFactory={run.onRun}
      />
      <GeneratedImageGallery slides={gallery.generatedSlides} />
      {summary.data && !run.isRunning && (
        <FactorySummaryCard
          factorySummary={summary.data}
          findFactoryQueueItem={summary.findQueueItem}
          onClearSummary={summary.onClear}
          onJumpToQueueItem={summary.onJumpToQueueItem}
        />
      )}
      {!hideHistory && (
        <FactoryHistoryPanel
          factoryHistory={history.items}
          factoryRunning={run.isRunning}
          maxThemeLength={history.maxThemeLength}
          quickTags={history.quickTags}
          onHistoryUpdate={history.onUpdate}
          onToggleFavorite={history.onToggleFavorite}
          onReuseTheme={history.onReuseTheme}
          onDuplicateTheme={history.onDuplicateTheme}
          onRerunFactory={history.onRerunFactory}
          onDelete={history.onDelete}
          onExportJson={history.onExportJson}
          onExportCsv={history.onExportCsv}
          onImportFile={history.onImportFile}
          onClearHistory={history.onClear}
        />
      )}
    </div>
  )
}
