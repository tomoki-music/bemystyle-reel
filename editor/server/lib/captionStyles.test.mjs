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

describe('captionType別デザイン (Phase: AI分類デザイン)', () => {
  function extractStyleLines(content) {
    const lines = content.split('\n').filter((l) => l.startsWith('Style:'))
    const byName = {}
    for (const line of lines) {
      const fields = line.replace('Style:', '').trim().split(',')
      const [name, fontname, fontsize, primaryColour, , outlineColour, backColour, bold, , , , , , , , borderStyle, outline] = fields
      byName[name] = { fontname, fontsize: Number(fontsize), primaryColour, outlineColour, backColour, bold: Number(bold), borderStyle: Number(borderStyle), outline: Number(outline) }
    }
    return byName
  }

  it('6種類のスタイルが互いに異なる見た目(色または太さまたは枠)を持つ', () => {
    const content = buildAssContent({ width: 1920, height: 1080, captions: [] })
    const styles = extractStyleLines(content)
    const signature = (s) => `${s.primaryColour}|${s.bold}|${s.borderStyle}|${s.outline}`
    const signatures = new Set(Object.values(styles).map(signature))
    expect(signatures.size).toBe(6) // 6種類すべてが一意の見た目
  })

  it('mainはnormalより大きく、画面を覆いすぎない範囲に収まる', () => {
    const content = buildAssContent({ width: 1920, height: 1080, captions: [] })
    const styles = extractStyleLines(content)
    expect(styles.Main.fontsize).toBeGreaterThan(styles.Normal.fontsize)
    expect(styles.Main.fontsize).toBeLessThan(styles.Heading.fontsize)
  })

  it('subはmainより明確に小さい', () => {
    const content = buildAssContent({ width: 1920, height: 1080, captions: [] })
    const styles = extractStyleLines(content)
    expect(styles.Sub.fontsize).toBeLessThan(styles.Main.fontsize)
  })

  it('emphasisは太字かつ強めの縁取りでアクセント色を使う', () => {
    const content = buildAssContent({ width: 1920, height: 1080, captions: [] })
    const styles = extractStyleLines(content)
    expect(styles.Emphasis.bold).toBe(1)
    expect(styles.Emphasis.outline).toBeGreaterThanOrEqual(3)
    expect(styles.Emphasis.primaryColour).not.toBe(styles.Normal.primaryColour)
  })

  it('headingは最も大きく、他タイプと明確に区別される(不透明ボックス)', () => {
    const content = buildAssContent({ width: 1920, height: 1080, captions: [] })
    const styles = extractStyleLines(content)
    const allSizes = Object.values(styles).map((s) => s.fontsize)
    expect(styles.Heading.fontsize).toBe(Math.max(...allSizes))
    expect(styles.Heading.borderStyle).toBe(3)
  })

  it('annotationは最も小さく控えめ', () => {
    const content = buildAssContent({ width: 1920, height: 1080, captions: [] })
    const styles = extractStyleLines(content)
    const allSizes = Object.values(styles).map((s) => s.fontsize)
    expect(styles.Annotation.fontsize).toBe(Math.min(...allSizes))
  })

  it('全スタイルが指定フォントファミリーを使う(文字化け防止)', () => {
    const content = buildAssContent({ width: 1920, height: 1080, captions: [] })
    const styles = extractStyleLines(content)
    for (const s of Object.values(styles)) {
      expect(s.fontname).toBe('Noto Sans CJK JP')
    }
  })

  it('1920x1080基準で、2行×フォントサイズがセーフエリア内に収まる(縦動画へ固定しない)', () => {
    const content = buildAssContent({ width: 1920, height: 1080, captions: [] })
    expect(content).toContain('PlayResX: 1920')
    expect(content).toContain('PlayResY: 1080')
    const styles = extractStyleLines(content)
    for (const s of Object.values(styles)) {
      const twoLineHeight = s.fontsize * 2 * 1.3
      expect(twoLineHeight).toBeLessThan(1080 * 0.8) // 画面の8割未満に収まる
    }
  })

  it('最大級の長さのcaption(37文字程度)でも2行に収まる想定の横幅になる', () => {
    // captionSegmenterの実データ分割結果の最大文字数(約37文字)を想定。
    // CJKフォントは概ね正方形(1文字幅 ≈ fontsize)なので、2行なら1行あたり
    // 19文字程度。 fontsize * 19 が PlayResX - 左右マージン に収まるかを確認する。
    const content = buildAssContent({ width: 1920, height: 1080, captions: [] })
    const styles = extractStyleLines(content)
    const playResX = 1920
    const safeMarginH = Math.max(20, Math.round(playResX * 0.06))
    const usableWidth = playResX - safeMarginH * 2
    const maxCharsPerLine = Math.ceil(37 / 2)
    for (const s of Object.values(styles)) {
      expect(s.fontsize * maxCharsPerLine).toBeLessThan(usableWidth * 1.05) // 多少の等幅近似誤差を許容
    }
  })

  it('元動画の解像度をそのまま使う(縦動画1080x1920へ固定しない)', () => {
    const landscape = buildAssContent({ width: 1920, height: 1080, captions: [] })
    expect(landscape).toContain('PlayResX: 1920')
    expect(landscape).toContain('PlayResY: 1080')
    const portrait = buildAssContent({ width: 1080, height: 1920, captions: [] })
    expect(portrait).toContain('PlayResX: 1080')
    expect(portrait).toContain('PlayResY: 1920')
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
