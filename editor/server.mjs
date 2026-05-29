import express from 'express'
import { writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, statSync } from 'fs'
import { resolve, dirname, extname, basename } from 'path'
import { fileURLToPath } from 'url'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SLIDES_PATH = resolve(__dirname, '../public/data/slides.json')
const UPLOADS_DIR = resolve(__dirname, '../public/assets/uploads')
const OUT_DIR = resolve(__dirname, '../out')
const REELS_DIR = resolve(OUT_DIR, 'reels')
const LATEST_FILE = resolve(OUT_DIR, 'reel.mp4')
const ROOT_DIR = resolve(__dirname, '..')

function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

let renderState = {
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  error: null,
  outputFile: null,
  downloadUrl: null,
}

mkdirSync(UPLOADS_DIR, { recursive: true })
mkdirSync(REELS_DIR, { recursive: true })

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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, message: 'editor api server is running' })
})

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

app.post('/api/render', (req, res) => {
  if (renderState.status === 'running') {
    return res.status(409).json({ ok: false, message: '現在動画生成中です' })
  }

  mkdirSync(OUT_DIR, { recursive: true })
  mkdirSync(REELS_DIR, { recursive: true })

  const timestamp = formatTimestamp(new Date())
  const filename = `reel-${timestamp}.mp4`
  const outputPath = resolve(REELS_DIR, filename)
  const outputRelPath = `out/reels/${filename}`

  renderState = { status: 'running', startedAt: new Date().toISOString(), finishedAt: null, error: null, outputFile: null, downloadUrl: null }
  res.json({ ok: true, message: '動画生成を開始しました' })

  const child = spawn(
    'npx',
    ['remotion', 'render', 'src/index.ts', 'BeMyStyleReel', outputRelPath, '--codec', 'h264', '--jpeg-quality', '95'],
    { cwd: ROOT_DIR, shell: false }
  )

  child.on('close', (code) => {
    if (code === 0) {
      try { copyFileSync(outputPath, LATEST_FILE) } catch (_) {}
      renderState = {
        status: 'completed',
        startedAt: renderState.startedAt,
        finishedAt: new Date().toISOString(),
        error: null,
        outputFile: filename,
        downloadUrl: `/api/render/download/${filename}`,
      }
    } else {
      renderState = { status: 'failed', startedAt: renderState.startedAt, finishedAt: new Date().toISOString(), error: `renderプロセスが終了コード ${code} で失敗しました`, outputFile: null, downloadUrl: null }
    }
  })

  child.on('error', (err) => {
    renderState = { status: 'failed', startedAt: renderState.startedAt, finishedAt: new Date().toISOString(), error: err.message, outputFile: null, downloadUrl: null }
  })
})

app.get('/api/render/status', (_req, res) => {
  res.json({ ok: true, ...renderState })
})

app.get('/api/render/download', (_req, res) => {
  if (!existsSync(LATEST_FILE)) {
    return res.status(404).json({ ok: false, message: '動画ファイルが見つかりません。先に動画生成を実行してください。' })
  }
  res.download(LATEST_FILE, 'reel.mp4')
})

app.get('/api/render/download/:filename', (req, res) => {
  const safe = basename(req.params.filename)
  if (!safe.endsWith('.mp4') || safe !== req.params.filename) {
    return res.status(400).json({ ok: false, message: '不正なファイル名です' })
  }
  const filePath = resolve(REELS_DIR, safe)
  if (!existsSync(filePath)) {
    return res.status(404).json({ ok: false, message: 'ファイルが見つかりません' })
  }
  res.download(filePath, safe)
})

app.get('/api/render/view', (_req, res) => {
  if (!existsSync(LATEST_FILE)) {
    return res.status(404).json({ ok: false, message: '動画ファイルが見つかりません' })
  }
  res.setHeader('Content-Type', 'video/mp4')
  res.sendFile(LATEST_FILE)
})

app.get('/api/render/view/:filename', (req, res) => {
  const safe = basename(req.params.filename)
  if (!safe.endsWith('.mp4') || safe !== req.params.filename) {
    return res.status(400).json({ ok: false, message: '不正なファイル名です' })
  }
  const filePath = resolve(REELS_DIR, safe)
  if (!existsSync(filePath)) {
    return res.status(404).json({ ok: false, message: 'ファイルが見つかりません' })
  }
  res.setHeader('Content-Type', 'video/mp4')
  res.sendFile(filePath)
})

app.get('/api/render/history', (_req, res) => {
  try {
    const files = readdirSync(REELS_DIR)
      .filter((f) => f.startsWith('reel-') && f.endsWith('.mp4'))
      .map((f) => {
        const st = statSync(resolve(REELS_DIR, f))
        return { filename: f, size: st.size, createdAt: st.birthtime.toISOString() }
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 20)
      .map((item) => ({ ...item, downloadUrl: `/api/render/download/${item.filename}` }))
    res.json({ ok: true, items: files })
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message })
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
