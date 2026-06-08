const { default: puppeteer } = await import('/tmp/node_modules/puppeteer/lib/puppeteer/puppeteer.js')
import { mkdirSync } from 'fs'

const CHROME_PATH = '/Users/tomokiimaizumi/.cache/puppeteer/chrome/mac_arm-149.0.7827.22/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const OUT_DIR = '/Users/tomokiimaizumi/bemystyle-reel/editor/docs/screenshots'
const APP_URL = 'http://localhost:3001'

mkdirSync(OUT_DIR, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  defaultViewport: { width: 1440, height: 900 },
})

const page = await browser.newPage()
await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 20000 })
await new Promise(r => setTimeout(r, 2000))

const scrollTo = async (selector) => {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' })
  }, selector)
  await new Promise(r => setTimeout(r, 400))
}

const shotEl = async (selector, filename) => {
  const el = await page.$(selector)
  if (el) {
    await el.screenshot({ path: `${OUT_DIR}/${filename}` })
    console.log(`✅ ${filename}`)
    return true
  }
  console.log(`⚠️  ${filename} — ${selector} not found`)
  return false
}

// ── 1. アプリ全体
await page.screenshot({ path: `${OUT_DIR}/01_overview.png` })
console.log('✅ 01_overview.png')

// ── 2. 中央プレビュー
await shotEl('.panel-center', '02_preview.png')

// ── 3. テーマ入力 + ストーリー生成
await scrollTo('.ai-generator')
await shotEl('.ai-generator', '03_theme_input.png')

// ── 4. ファクトリーパネル全体
await scrollTo('.factory-panel')
await shotEl('.factory-panel', '04_factory_panel.png')

// ── 5. レンダーエリア（render-area が存在する）
await scrollTo('.render-area')
const renderAreaEl = await page.$('.render-area')
if (renderAreaEl) {
  // render-area 周辺を含む親要素を取得
  const renderParent = await renderAreaEl.evaluateHandle(el => {
    let p = el
    for (let i = 0; i < 3; i++) {
      if (p.parentElement && p.parentElement.className && p.parentElement.className.includes('panel')) break
      p = p.parentElement || p
    }
    return p
  })
  await renderParent.asElement()?.screenshot({ path: `${OUT_DIR}/05_render_area.png` })
  console.log('✅ 05_render_area.png')
} else {
  console.log('⚠️  05_render_area.png — .render-area not found')
}

// ── 6. レンダーアクション（キューレンダーボタン）
await scrollTo('.render-queue-actions, .btn-batch-render')
await shotEl('.render-queue-actions', '06_render_actions.png')

// ── 7. 右パネル（編集フォーム）
await shotEl('.panel-right', '07_edit_form.png')

// ── 8. ファクトリー履歴パネル
await scrollTo('.factory-history-panel')
await shotEl('.factory-history-panel', '08_factory_history.png')

await browser.close()
console.log('\nDone. Screenshots in:', OUT_DIR)
