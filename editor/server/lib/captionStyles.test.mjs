import { describe, it, expect, afterEach } from 'vitest'
import { buildAssContent, CAPTION_TYPES, buildDialogueText, planCaptionFits } from './captionStyles.mjs'

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

  it('全スタイルが縁取り(BorderStyle=1)で、紫などの不透明な全面バナー(BorderStyle=3)を使わない', () => {
    const content = buildAssContent({ width: 1920, height: 1080, captions: [] })
    const styles = extractStyleLines(content)
    expect(Object.keys(styles)).toHaveLength(6)
    for (const s of Object.values(styles)) expect(s.borderStyle).toBe(1)
    expect(content).not.toContain('&H00FC84C0&') // 旧ブランド紫
  })

  it('通常字幕はcaptionTypeによらず白文字・黒縁で統一される（色を頻繁に変えない）', () => {
    const content = buildAssContent({ width: 1920, height: 1080, captions: [] })
    const styles = extractStyleLines(content)
    for (const name of ['Normal', 'Main', 'Emphasis', 'Heading']) {
      expect(styles[name].primaryColour).toBe('&H00FFFFFF&')
      expect(styles[name].outlineColour).toBe('&H00000000&')
      expect(styles[name].bold).toBe(1)
    }
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

  it('emphasisタイプでも文全体をアクセント色にしない（強調は部分オーバーライドだけ）', () => {
    const content = buildAssContent({ width: 1920, height: 1080, captions: [] })
    const styles = extractStyleLines(content)
    expect(styles.Emphasis.primaryColour).toBe(styles.Normal.primaryColour)
    expect(styles.Emphasis.bold).toBe(1)
  })

  it('アクセント色は動画全体で1色（落ち着いた琥珀色）で、全スタイル共通のhighlightを使う', () => {
    const ass = buildAssContent({
      width: 1920,
      height: 1080,
      captions: [
        { startSec: 0, endSec: 1, text: 'これは大事です', captionType: 'normal', emphasisText: '大事', displayOrder: 0 },
        { startSec: 1, endSec: 2, text: 'ここも重要です', captionType: 'main', emphasisText: '重要', displayOrder: 1 },
        { startSec: 2, endSec: 3, text: 'さらに肝心です', captionType: 'heading', emphasisText: '肝心', displayOrder: 2 },
      ],
    })
    const colours = new Set([...ass.matchAll(/\{\\c([0-9A-F]{8})&\}/g)].map((m) => m[1]))
    expect(colours.size).toBe(1)
    expect([...colours][0]).toBe('004AB3F0')
  })

  it('headingは最も大きいが、上部の黒帯(不透明ボックス)は使わず縁取り文字のみ', () => {
    const content = buildAssContent({ width: 1920, height: 1080, captions: [] })
    const styles = extractStyleLines(content)
    const allSizes = Object.values(styles).map((s) => s.fontsize)
    expect(styles.Heading.fontsize).toBe(Math.max(...allSizes))
    expect(styles.Heading.borderStyle).toBe(1)
    const headingLine = content.split('\n').find((l) => l.startsWith('Style: Heading'))
    expect(headingLine.split(',')[18]).toBe('8') // 上部中央
  })

  it('mainは全面バナーにせず、normalより少し大きい程度', () => {
    const content = buildAssContent({ width: 1920, height: 1080, captions: [] })
    const styles = extractStyleLines(content)
    expect(styles.Main.borderStyle).toBe(1)
    expect(styles.Main.fontsize / styles.Normal.fontsize).toBeLessThan(1.2)
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

  it('最大級のcaption(1行20文字ハード上限)でも、全スタイルが動的縮小の後は使用可能幅(88%)に収まる', () => {
    // 文字幅は実際のフォント(libass描画)で校正した推定式で判定する（全角1文字=1emの保守的推定はしない）。
    const long = 'あ'.repeat(20)
    const captions = ['normal', 'main', 'emphasis', 'sub'].map((captionType) => ({ text: long, lines: [long], captionType }))
    for (const f of planCaptionFits(captions, 1920, 1080)) {
      expect(f.fits).toBe(true)
      expect(f.widthPx).toBeLessThanOrEqual(1920 * 0.88)
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
