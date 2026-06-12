import React from 'react'
import { ReelAiConfig } from '../types'

type Props = {
  reelAiConfig: ReelAiConfig
}

type CheckItem = {
  done: boolean | null  // true=✅ false=❌ null=⬜（手動確認）
  label: string
  hint?: string
}

export function ProductionSafetyBanner({ reelAiConfig }: Props) {
  const isMock = reelAiConfig.aiMode === 'mock'
  const isDryRun = reelAiConfig.dryRun
  const hasImageLimit = reelAiConfig.testImageLimit !== null

  if (!isMock && !isDryRun && !hasImageLimit) {
    return (
      <div className="prod-ok-banner" role="status">
        ✅ 本番利用準備OK — AI生成・動画書き出し・画像生成上限は通常設定です。
      </div>
    )
  }

  const checklist: CheckItem[] = [
    {
      done: !isMock,
      label: 'AI モードが real になっている',
      hint: isMock ? '→ REEL_AI_MODE=mock を削除または変更してください' : undefined,
    },
    {
      done: !isDryRun,
      label: 'Dry Run が無効になっている',
      hint: isDryRun ? '→ REEL_DRY_RUN=true を削除または false に変更してください' : undefined,
    },
    {
      done: !hasImageLimit,
      label: '画像生成の枚数制限が解除されている',
      hint: hasImageLimit
        ? `→ REEL_TEST_IMAGE_LIMIT=${reelAiConfig.testImageLimit} を削除してください`
        : undefined,
    },
    {
      done: null,
      label: 'テスト用に 1 本生成して MP4 ファイルが作成できることを確認する',
    },
    {
      done: null,
      label: '投稿前に動画の内容・テキスト・画像を目視で確認する',
    },
  ]

  return (
    <div className="prod-safety-banner" role="alert" aria-live="assertive">
      <div className="prod-safety-banner__inner">
        <span className="prod-safety-banner__icon">⚠️</span>
        <div className="prod-safety-banner__content">
          <strong className="prod-safety-banner__title">
            本番利用前に確認してください — 開発用設定が有効になっています
          </strong>
          <div className="prod-safety-banner__tags">
            {isMock && (
              <span className="prod-safety-tag prod-safety-tag--mock">
                <span className="prod-safety-tag__label">AI モード</span>
                <span className="prod-safety-tag__value">Mock（ダミーデータ）</span>
              </span>
            )}
            {isDryRun && (
              <span className="prod-safety-tag prod-safety-tag--dryrun">
                <span className="prod-safety-tag__label">動画生成</span>
                <span className="prod-safety-tag__value">Dry Run（書き出しスキップ）</span>
              </span>
            )}
            {hasImageLimit && (
              <span className="prod-safety-tag prod-safety-tag--limit">
                <span className="prod-safety-tag__label">画像生成</span>
                <span className="prod-safety-tag__value">上限 {reelAiConfig.testImageLimit} 枚</span>
              </span>
            )}
          </div>

          <div className="prod-safety-checklist">
            <p className="prod-safety-checklist__heading">本番投稿前チェックリスト</p>
            <ol className="prod-safety-checklist__list">
              {checklist.map((item, i) => (
                <li
                  key={i}
                  className={`prod-safety-checklist__item${
                    item.done === true
                      ? ' prod-safety-checklist__item--done'
                      : item.done === false
                      ? ' prod-safety-checklist__item--ng'
                      : ' prod-safety-checklist__item--manual'
                  }`}
                >
                  <span className="prod-safety-checklist__mark">
                    {item.done === true ? '✅' : item.done === false ? '❌' : '⬜'}
                  </span>
                  <span className="prod-safety-checklist__text">
                    {item.label}
                    {item.hint && (
                      <span className="prod-safety-checklist__hint">{item.hint}</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
