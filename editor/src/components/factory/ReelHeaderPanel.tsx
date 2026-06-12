import { ProductionSafetyBanner } from '../ProductionSafetyBanner'
import type { ReelAiConfig } from '../../types'

type ReelHeaderPanelProps =
  | {
      section: 'safety-banner'
      reelAiConfig: ReelAiConfig
    }
  | {
      section: 'panel-header'
      simpleMode: boolean
      simpleStep: number
      hasUnsavedChanges: boolean
      saveStatus: 'idle' | 'saving' | 'ok' | 'error'
      isRendering: boolean
      slideCount: number
      onNewProject: () => void
      onSimpleNewProject: () => void
      onSave: () => void
    }
  | {
      section: 'mode-toggle'
      simpleMode: boolean
      onStartSimpleMode: () => void
      onExitSimpleMode: () => void
    }

export function ReelHeaderPanel(props: ReelHeaderPanelProps) {
  if (props.section === 'safety-banner') {
    return <ProductionSafetyBanner reelAiConfig={props.reelAiConfig} />
  }

  if (props.section === 'mode-toggle') {
    return props.simpleMode ? (
      <div className="mode-toggle mode-toggle--simple">
        <button
          className="btn-detail-mode"
          onClick={props.onExitSimpleMode}
        >
          ⚙️ 詳細編集
        </button>
      </div>
    ) : (
      <div className="mode-toggle">
        <span className="mode-toggle-label">モード</span>
        <div className="mode-toggle-buttons">
          <button
            className="mode-toggle-btn"
            onClick={props.onStartSimpleMode}
          >
            自動作成
          </button>
          <button
            className="mode-toggle-btn mode-toggle-btn--active"
          >
            詳細編集
          </button>
        </div>
      </div>
    )
  }

  return props.simpleMode ? (
    <div className="panel-header simple-app-header">
      <div className="panel-header-left">
        <span className="simple-app-title">🎬 BeMyStyle Reel</span>
        {props.hasUnsavedChanges && <span className="unsaved-badge">未保存</span>}
      </div>
      <div className="simple-app-header-actions">
        {props.simpleStep > 1 && (
          <button
            className="btn-simple-new-header"
            onClick={props.onSimpleNewProject}
          >
            ＋ 新規作成
          </button>
        )}
        <button className="btn-save-simple" onClick={props.onSave} disabled={props.saveStatus === 'saving' || props.isRendering} title="保存">
          {props.saveStatus === 'saving' ? '保存中...' : props.saveStatus === 'ok' ? '✓' : props.hasUnsavedChanges ? '⚠ 保存' : '💾 保存'}
        </button>
      </div>
    </div>
  ) : (
    <div className="panel-header">
      <div className="panel-header-left">
        <span className="panel-title">スライド一覧</span>
        {props.hasUnsavedChanges && <span className="unsaved-badge">未保存</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn-new-project" onClick={props.onNewProject} title="14枚の空白スライドで新規作成">
          ＋ 新規
        </button>
        <span className="panel-badge">{props.slideCount}枚</span>
      </div>
    </div>
  )
}
