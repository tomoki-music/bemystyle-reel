import express from 'express'
import { writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname, extname } from 'path'
import { fileURLToPath } from 'url'
import multer from 'multer'
import { randomUUID } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SLIDES_PATH = resolve(__dirname, '../public/data/slides.json')
const UPLOADS_DIR = resolve(__dirname, '../public/assets/uploads')

mkdirSync(UPLOADS_DIR, { recursive: true })

const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const MAX_SIZE = 10 * 1024 * 1024 // 10MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase()
    cb(null, `${randomUUID()}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase()
    if (ALLOWED_EXTS.has(ext)) {
      cb(null, true)
    } else {
      cb(new Error(`許可されていないファイル形式です: ${ext}`))
    }
  },
})

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

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, message: '画像ファイルがありません' })
  }
  const filename = `uploads/${req.file.filename}`
  const url = `/assets/uploads/${req.file.filename}`
  res.json({ ok: true, filename, url })
})

app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ ok: false, message: 'ファイルサイズが10MBを超えています' })
  }
  res.status(400).json({ ok: false, message: err.message ?? 'アップロードエラー' })
})

const PORT = 3002
app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`)
})
