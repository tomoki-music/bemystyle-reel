import React from 'react'

export type FactoryThemeTemplate = { type: string; label: string }

type FactoryThemeInputProps = {
  heading?: string
  example?: string
  inputValue: string
  onInputValueChange: (v: string) => void
  onAdd: () => void
  isAddDisabled?: boolean
  isDisabled?: boolean
  placeholder?: string
  addLabel?: string
  templates?: FactoryThemeTemplate[]
  inputType?: string
  onInputTypeChange?: (type: string) => void
  inputRef?: React.RefObject<HTMLInputElement>
}

export function FactoryThemeInput({
  heading,
  example,
  inputValue,
  onInputValueChange,
  onAdd,
  isAddDisabled,
  isDisabled,
  placeholder = 'テーマを入力...',
  addLabel = '追加',
  templates,
  inputType,
  onInputTypeChange,
  inputRef,
}: FactoryThemeInputProps) {
  return (
    <div className="factory-theme-input-section">
      {heading && <p className="factory-theme-input-heading">{heading}</p>}
      {example && <p className="factory-theme-input-example-hint">{example}</p>}
      {templates && templates.length > 0 && (
        <div className="factory-theme-type-row">
          {templates.map(({ type, label }) => (
            <button
              key={type}
              className={`factory-theme-type-btn${inputType === type ? ' active' : ''}`}
              onClick={() => onInputTypeChange?.(type)}
              disabled={isDisabled}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="factory-theme-input-row">
        <input
          ref={inputRef}
          className="factory-theme-input"
          type="text"
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => onInputValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isDisabled && !isAddDisabled && inputValue.trim()) onAdd()
          }}
          disabled={isDisabled}
        />
        <button
          className="btn-factory-theme-add"
          onClick={onAdd}
          disabled={isAddDisabled || isDisabled || !inputValue.trim()}
          type="button"
        >
          {addLabel}
        </button>
      </div>
    </div>
  )
}
