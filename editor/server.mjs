import express from 'express'
import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SLIDES_PATH = resolve(__dirname, '../public/data/slides.json')

const app = express()
app.use(express.json({ limit: '10mb' }))

app.post('/api/slides', (req, res) => {
  const body = req.body

  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, message: 'リクエストボディが不正です' })
  }
  if (!Array.isArray(body.slides)) {
    return res.status(400).json({ ok: false, message: 'slides が配列ではありません' })
  }
  if (body.slides.length === 0) {
    return res.status(400).json({ ok: false, message: 'slides が空です' })
  }
  for (const slide of body.slides) {
    if (slide.id == null) {
      return res.status(400).json({ ok: false, message: `slide に id がありません: ${JSON.stringify(slide)}` })
    }
    if (!slide.headline) {
      return res.status(400).json({ ok: false, message: `slide (id=${slide.id}) に headline がありません` })
    }
  }

  try {
    writeFileSync(SLIDES_PATH, JSON.stringify(body, null, 2), 'utf-8')
    res.json({ ok: true, message: '保存しました' })
  } catch (err) {
    console.error('Failed to write slides.json:', err)
    res.status(500).json({ ok: false, message: '保存に失敗しました' })
  }
})

const PORT = 3002
app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`)
})
