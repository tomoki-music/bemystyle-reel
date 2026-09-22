import { describe, it, expect, afterEach } from 'vitest'
import { buildAssContent, CAPTION_TYPES, buildDialogueText } from './captionStyles.mjs'

afterEach(() => {
  delete process.env.CAPTION_VIDEO_FONT_FAMILY
})

describe('buildAssContent', () => {
  it('6種類すべてのスタイルを定義する（Phase1はnormalしか使わないが将来のために全定義）', () => {
    const content = buildAssContent({ width: 1080, height: 1920, captions: [] })
    for (const type of CAPTION_TYPES) {
      const styleName = type.charAt(0).toUpperCase() + type.slice(1)
      expect(content).toContain(`Style: ${styleName},`)
    }
  })

  it('PlayResX/PlayResYに回転補正済みの表示サイズを使う', () => {
    const content = buildAssContent({ width: 1080, height: 1920, captions: [] })
    expect(content).toContain('PlayResX: 1080')
    expect(content).toContain('PlayResY: 1920')
  })

  it('Dialogue行にエスケープ済みのテキストが出力される（インジェクション不可）', () => {
    const content = buildAssContent({
      width: 1080,
      height: 1920,
      captions: [
        {
          id: 'c1',
          startSec: 1,
          endSec: 2,
          text: '{危険}\\注入',
          captionType: 'normal',
          displayOrder: 0,
        },
      ],
    })
    expect(content).toContain('｛危険｝')
    expect(content).not.toMatch(/Dialogue:.*\{\\/) // Dialogue行に生のoverrideタグが無いこと
  })

  it('環境変数CAPTION_VIDEO_FONT_FAMILYでフォントを差し替えられる', () => {
    process.env.CAPTION_VIDEO_FONT_FAMILY = 'Hiragino Sans'
    const content = buildAssContent({ width: 1080, height: 1920, captions: [] })
    expect(content).toContain('Hiragino Sans')
  })
})

describe('buildDialogueText (emphasisText 強調)', () => {
  it('emphasisTextがtext内に実在する場合のみカラーオーバーライドを付与する', () => {
    const withEmphasis = buildDialogueText({ text: '大事な単語を強調', emphasisText: '大事な単語' }, '&H0000A5FF&')
    expect(withEmphasis).toMatch(/^\{\\c0000A5FF&\}大事な単語\{\\r\}を強調$/)
  })

  it('emphasisTextがtext内に存在しない場合は通常エスケープのみ', () => {
    const result = buildDialogueText({ text: 'テキスト', emphasisText: '存在しない単語' }, '&H0000A5FF&')
    expect(result).toBe('テキスト')
  })
})
