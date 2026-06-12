type TemplateCategory = {
  id: string
  label: string
}

type TemplateModalsProps = {
  templateConfirmPending: string | null
  saveTemplateModal: boolean
  saveTemplateName: string
  saveTemplateCategory: string
  saveTemplateDescription: string
  saveTemplateStatus: 'idle' | 'saving' | 'ok' | 'error'
  categories: readonly TemplateCategory[]
  onCancelLoadTemplate: () => void
  onLoadTemplate: (templateId: string) => void
  onCancelSaveTemplateModal: () => void
  onSaveTemplate: () => void
  onChangeSaveTemplateName: (value: string) => void
  onChangeSaveTemplateCategory: (value: string) => void
  onChangeSaveTemplateDescription: (value: string) => void
}

export function TemplateModals({
  templateConfirmPending,
  saveTemplateModal,
  saveTemplateName,
  saveTemplateCategory,
  saveTemplateDescription,
  saveTemplateStatus,
  categories,
  onCancelLoadTemplate,
  onLoadTemplate,
  onCancelSaveTemplateModal,
  onSaveTemplate,
  onChangeSaveTemplateName,
  onChangeSaveTemplateCategory,
  onChangeSaveTemplateDescription,
}: TemplateModalsProps) {
  if (!templateConfirmPending && !saveTemplateModal) return null

  return (
    <>
      {/* ── テンプレート読み込み確認 ── */}
      {templateConfirmPending && (
        <div className="modal-overlay">
          <div className="modal">
            <p className="modal-title">テンプレートを読み込みますか？</p>
            <p className="modal-body">現在の編集内容は破棄されます。</p>
            <div className="modal-actions">
              <button className="btn-modal-cancel" onClick={onCancelLoadTemplate}>
                キャンセル
              </button>
              <button className="btn-modal-ok" onClick={() => onLoadTemplate(templateConfirmPending)}>
                読み込む
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── テンプレート保存モーダル ── */}
      {saveTemplateModal && (
        <div className="modal-overlay">
          <div className="modal modal--wide">
            <p className="modal-title">テンプレートとして保存</p>
            <input
              className="modal-input"
              type="text"
              placeholder="テンプレート名を入力"
              value={saveTemplateName}
              onChange={(e) => onChangeSaveTemplateName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSaveTemplate()}
              autoFocus
            />
            <select
              className="modal-select"
              value={saveTemplateCategory}
              onChange={(e) => onChangeSaveTemplateCategory(e.target.value)}
            >
              {categories.filter((c) => c.id !== 'all').map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <textarea
              className="modal-textarea"
              placeholder="説明文（任意）"
              value={saveTemplateDescription}
              onChange={(e) => onChangeSaveTemplateDescription(e.target.value)}
              rows={3}
            />
            {saveTemplateStatus === 'error' && (
              <p className="save-error">保存に失敗しました</p>
            )}
            <div className="modal-actions">
              <button
                className="btn-modal-cancel"
                onClick={onCancelSaveTemplateModal}
                disabled={saveTemplateStatus === 'saving'}
              >
                キャンセル
              </button>
              <button
                className="btn-modal-ok"
                onClick={onSaveTemplate}
                disabled={!saveTemplateName.trim() || saveTemplateStatus === 'saving'}
              >
                {saveTemplateStatus === 'saving' ? '保存中...' : saveTemplateStatus === 'ok' ? '✓ 保存完了' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
