import 'dotenv/config'
import express from 'express'
import { writeFileSync, readFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, statSync, unlinkSync } from 'fs'
import { resolve, dirname, extname, basename } from 'path'
import { fileURLToPath } from 'url'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SLIDES_PATH = resolve(__dirname, '../public/data/slides.json')
const TEMPLATES_DIR = resolve(__dirname, '../public/templates')
const UPLOADS_DIR = resolve(__dirname, '../public/assets/uploads')
const GENERATED_DIR = resolve(__dirname, '../public/assets/generated')
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
mkdirSync(GENERATED_DIR, { recursive: true })
mkdirSync(REELS_DIR, { recursive: true })
mkdirSync(TEMPLATES_DIR, { recursive: true })

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

app.get('/api/templates', (_req, res) => {
  try {
    const files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json'))
    const templates = files.map((f) => {
      try {
        const data = JSON.parse(readFileSync(resolve(TEMPLATES_DIR, f), 'utf-8'))
        return {
          id: data.id ?? basename(f, '.json'),
          name: data.name ?? basename(f, '.json'),
          hints: data.hints ?? null,
          favorite: data.favorite ?? false,
          category: data.category ?? 'other',
          description: data.description ?? '',
          variables: Array.isArray(data.variables) ? data.variables : [],
          thumbnail: typeof data.thumbnail === 'string' ? data.thumbnail : '',
        }
      } catch (_) {
        return null
      }
    }).filter(Boolean)
    res.json({ ok: true, templates })
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message })
  }
})

app.get('/api/templates/:id', (req, res) => {
  const safe = basename(req.params.id)
  if (!safe || safe.includes('/') || safe.includes('..')) {
    return res.status(400).json({ ok: false, message: '不正なIDです' })
  }
  const filePath = resolve(TEMPLATES_DIR, `${safe}.json`)
  if (!existsSync(filePath)) {
    return res.status(404).json({ ok: false, message: 'テンプレートが見つかりません' })
  }
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    res.json({ ok: true, template: data })
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message })
  }
})

app.post('/api/templates', (req, res) => {
  const body = req.body
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, message: 'リクエストボディが不正です' })
  }
  if (!body.name || typeof body.name !== 'string') {
    return res.status(400).json({ ok: false, message: 'テンプレート名が必要です' })
  }
  if (!Array.isArray(body.slides) || body.slides.length === 0) {
    return res.status(400).json({ ok: false, message: 'slides が空です' })
  }
  const id = `custom-${randomUUID().slice(0, 8)}`
  const template = {
    id,
    name: body.name,
    title: body.title ?? body.name,
    slides: body.slides,
    cta: body.cta ?? {},
    hints: body.hints ?? null,
    favorite: false,
    category: typeof body.category === 'string' ? body.category : 'other',
    description: typeof body.description === 'string' ? body.description : '',
    variables: Array.isArray(body.variables) ? body.variables : [],
    thumbnail: typeof body.thumbnail === 'string' ? body.thumbnail : (body.slides[0]?.image ?? ''),
  }
  const filePath = resolve(TEMPLATES_DIR, `${id}.json`)
  try {
    writeFileSync(filePath, JSON.stringify(template, null, 2), 'utf-8')
    res.json({ ok: true, id, message: 'テンプレートとして保存しました' })
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message })
  }
})

app.post('/api/templates/duplicate', (req, res) => {
  const { id } = req.body ?? {}
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ ok: false, message: 'IDが必要です' })
  }
  const safe = basename(id)
  if (!safe || safe.includes('/') || safe.includes('..')) {
    return res.status(400).json({ ok: false, message: '不正なIDです' })
  }
  const srcPath = resolve(TEMPLATES_DIR, `${safe}.json`)
  if (!existsSync(srcPath)) {
    return res.status(404).json({ ok: false, message: 'テンプレートが見つかりません' })
  }
  try {
    const data = JSON.parse(readFileSync(srcPath, 'utf-8'))
    const newId = `custom-copy-${randomUUID().slice(0, 8)}`
    const newTemplate = { ...data, id: newId, name: `${data.name} のコピー`, favorite: false }
    writeFileSync(resolve(TEMPLATES_DIR, `${newId}.json`), JSON.stringify(newTemplate, null, 2), 'utf-8')
    res.json({ ok: true, id: newId, name: newTemplate.name })
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message })
  }
})

app.patch('/api/templates/:id', (req, res) => {
  const safe = basename(req.params.id)
  if (!safe || safe.includes('/') || safe.includes('..')) {
    return res.status(400).json({ ok: false, message: '不正なIDです' })
  }
  const filePath = resolve(TEMPLATES_DIR, `${safe}.json`)
  if (!existsSync(filePath)) {
    return res.status(404).json({ ok: false, message: 'テンプレートが見つかりません' })
  }
  const body = req.body ?? {}
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return res.status(400).json({ ok: false, message: 'テンプレート名が不正です' })
      }
      data.name = body.name.trim()
    }
    if (body.favorite !== undefined) {
      data.favorite = Boolean(body.favorite)
    }
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    res.json({ ok: true, message: '更新しました' })
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message })
  }
})

app.delete('/api/templates/:id', (req, res) => {
  const safe = basename(req.params.id)
  if (!safe || safe.includes('/') || safe.includes('..')) {
    return res.status(400).json({ ok: false, message: '不正なIDです' })
  }
  if (!safe.startsWith('custom-')) {
    return res.status(403).json({ ok: false, message: '標準テンプレートは削除できません' })
  }
  const filePath = resolve(TEMPLATES_DIR, `${safe}.json`)
  if (!existsSync(filePath)) {
    return res.status(404).json({ ok: false, message: 'テンプレートが見つかりません' })
  }
  try {
    unlinkSync(filePath)
    res.json({ ok: true, message: '削除しました' })
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message })
  }
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

const STORY_PRESETS = {
  default: {
    tone: 'motivational, inspiring, concise',
    targetAudience: 'general audience interested in self-growth and music',
    cta: 'encourage the viewer to visit the profile or check the link',
    platform: 'short vertical video',
    imageStyle: 'elegant anime style, cinematic lighting, vertical 9:16 composition, no text',
    ctaJa: '続きはプロフィールへ',
  },
  note: {
    tone: 'friendly, sincere, thoughtful, essay-like',
    targetAudience: 'people who want personal growth through life, hobbies, work, and music',
    cta: 'encourage the viewer to read the full post or visit the profile',
    platform: 'Note article teaser and short video',
    imageStyle: 'elegant anime style, musician or artist, thoughtful atmosphere, cinematic lighting, vertical 9:16 composition, no text',
    ctaJa: '続きはプロフィールへ',
  },
  singing_pr: {
    tone: 'encouraging, warm, trustworthy, beginner-friendly',
    targetAudience: 'people who love singing and want to improve their voice',
    cta: 'encourage the viewer to try a free singing diagnosis',
    platform: 'short promotional video',
    imageStyle: 'elegant anime style singer, music studio, warm lighting, professional yet friendly, vertical 9:16 composition, no text',
    ctaJa: '無料診断はこちら',
  },
  session: {
    tone: 'welcoming, lively, warm, community-oriented',
    targetAudience: 'beginners and experienced musicians looking for a place to play music together',
    cta: 'encourage the viewer to join the session or check event details',
    platform: 'music event announcement short video',
    imageStyle: 'elegant anime style band session, cozy studio, friendly musicians, dynamic performance, vertical 9:16 composition, no text',
    ctaJa: '詳細はイベントページへ',
  },
  youtube_shorts: {
    tone: 'hook-driven, punchy, emotional, easy to understand',
    targetAudience: 'YouTube Shorts viewers who decide within the first second',
    cta: 'encourage the viewer to watch more or check the profile',
    platform: 'YouTube Shorts',
    imageStyle: 'dynamic anime style, bold composition, cinematic lighting, high-impact vertical frame, vertical 9:16 composition, no text',
    ctaJa: '続きはプロフィールへ',
  },
  instagram_reels: {
    tone: 'stylish, emotional, relatable, atmospheric',
    targetAudience: 'Instagram users who like aesthetic, relatable, save-worthy content',
    cta: 'encourage the viewer to save, share, or check the profile',
    platform: 'Instagram Reels',
    imageStyle: 'elegant anime style, stylish artist, dreamy lighting, refined color palette, vertical 9:16 composition, no text',
    ctaJa: '保存して見返そう',
  },
}

app.post('/api/custom-preset-insights', async (req, res) => {
  const { presets } = req.body ?? {}
  if (!Array.isArray(presets) || presets.length === 0) {
    return res.status(400).json({ ok: false, message: 'presets が空です' })
  }
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ ok: false, message: 'OPENAI_API_KEY が設定されていません' })
  }

  const presetSummary = presets.map((p, i) =>
    `[${i + 1}] name="${p.name}" tone="${p.tone}" audience="${p.targetAudience}" platform="${p.platform}" imageStyle="${p.imageStyle}" cta="${p.ctaText}" useCount=${p.useCount} isFavorite=${p.isFavorite} usedAtCount=${p.usedAtCount} lastUsedAt="${p.lastUsedAt}"`
  ).join('\n')

  const systemPrompt = `あなたはショート動画マーケティングのエキスパートです。
以下のカスタムプリセット利用データを分析し、改善提案をJSON形式で返してください。
必ずJSON形式のみで返してください。説明文は不要です。

{
  "summary": "全体の利用傾向の総評（2〜3文）",
  "strongestPresets": ["最もよく使われている・効果的なプリセット名を1〜3件"],
  "improvementIdeas": ["使用頻度が低いまたは改善余地があるプリセットへの具体的な改善案を1〜3件"],
  "recommendedCombinations": [
    {
      "name": "プリセット名（日本語・20文字以内）",
      "tone": "トーン指定（英語または日本語）",
      "targetAudience": "ターゲットオーディエンス",
      "platform": "プラットフォーム名",
      "imageStyle": "画像スタイル指定（英語推奨）",
      "ctaText": "CTAテキスト（日本語）",
      "reason": "このプリセットを勧める理由（1文）"
    }
  ]
}
recommendedCombinations は1〜2件。既存プリセットの勝ちパターンを組み合わせた、すぐ使える実用的なプリセットを提案すること。`

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `プリセットデータ:\n${presetSummary}` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 800,
      }),
    })

    if (!openaiRes.ok) {
      const errData = await openaiRes.json().catch(() => ({}))
      return res.status(502).json({ ok: false, message: `OpenAI APIエラー: ${errData.error?.message ?? openaiRes.status}` })
    }

    const openaiData = await openaiRes.json()
    const content = openaiData.choices?.[0]?.message?.content
    if (!content) return res.status(502).json({ ok: false, message: 'OpenAIからの応答が空です' })

    let insight
    try { insight = JSON.parse(content) } catch {
      return res.status(502).json({ ok: false, message: 'OpenAIの応答をパースできませんでした' })
    }

    if (typeof insight.summary !== 'string' || !Array.isArray(insight.strongestPresets) ||
        !Array.isArray(insight.improvementIdeas) || !Array.isArray(insight.recommendedCombinations)) {
      return res.status(502).json({ ok: false, message: 'OpenAI応答の形式が不正です' })
    }

    res.json({ ok: true, insight })
  } catch (err) {
    res.status(502).json({ ok: false, message: `OpenAI接続エラー: ${err.message}` })
  }
})

app.post('/api/generate-story', async (req, res) => {
  const { theme, presetKey, customPreset } = req.body ?? {}
  if (!theme || typeof theme !== 'string' || !theme.trim()) {
    return res.status(400).json({ ok: false, message: 'テーマが必要です' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ ok: false, message: 'OPENAI_API_KEY が設定されていません。環境変数を確認してください。' })
  }

  const preset = (presetKey && STORY_PRESETS[presetKey]) ? STORY_PRESETS[presetKey] : STORY_PRESETS.default

  const effectivePreset = {
    ...preset,
    tone: customPreset?.tone || preset.tone,
    targetAudience: customPreset?.targetAudience || preset.targetAudience,
    platform: customPreset?.platform || preset.platform,
    imageStyle: customPreset?.imageStyle || preset.imageStyle,
    ctaJa: customPreset?.ctaText || preset.ctaJa,
  }

  const presetSection = `
Preset instructions (apply strongly to all slides):
- Tone: ${effectivePreset.tone}
- Target audience: ${effectivePreset.targetAudience}
- CTA direction: ${effectivePreset.cta}
- Platform: ${effectivePreset.platform}
- Image style: ${effectivePreset.imageStyle}
`

  const systemPrompt = `あなたはショート動画（Instagram Reels / TikTok）のストーリーライター兼ビジュアルディレクターです。
日本語でスライドコンテンツを生成してください。
${presetSection}
必ずJSON形式のみで返してください。説明文は不要です。
{
  "slides": [
    {
      "headline": "スライドのメインテキスト",
      "subline": "補足テキスト（任意）",
      "emphasis": "強調する単語（任意）",
      "imagePrompt": "Elegant anime-style musician on a softly lit stage, cinematic lighting, vertical 9:16 composition, no text"
    }
  ],
  "variables": {
    "title": "メインタイトル",
    "subtitle": "キャッチコピー",
    "cta": "${effectivePreset.ctaJa}"
  }
}

ルール：
- slides は必ず14枚（過不足なく）
- 各 headline は10〜20文字程度、短く力強く
- subline は10〜20文字程度の補足（省略可）
- emphasis は headline 中の強調する単語1つ（省略可）
- 最初は問いかけか共感、最後はまとめ・結論・行動促進
- subtitle は15〜25文字のキャッチコピー
- cta は必ず「${effectivePreset.ctaJa}」を使用する
- imagePrompt は各スライドの内容に合った英語の画像生成プロンプト（必須・空文字NG）
- imagePrompt には必ず以下のimage styleを反映すること: ${effectivePreset.imageStyle}
- imagePrompt はスライドの感情・場面を具体的に表現する（例: solitary figure gazing at distant horizon, warm sunset tones）
- Preset の tone・target audience・platform を全スライドの文章に強く反映すること`

  const userPrompt = `テーマ: ${theme.trim()}`

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.8,
        max_tokens: 2000,
      }),
    })

    if (!openaiRes.ok) {
      const errData = await openaiRes.json().catch(() => ({}))
      return res.status(502).json({ ok: false, message: `OpenAI APIエラー: ${errData.error?.message ?? openaiRes.status}` })
    }

    const openaiData = await openaiRes.json()
    const content = openaiData.choices?.[0]?.message?.content
    if (!content) {
      return res.status(502).json({ ok: false, message: 'OpenAIからの応答が空です' })
    }

    let story
    try {
      story = JSON.parse(content)
    } catch {
      return res.status(502).json({ ok: false, message: 'OpenAIの応答をパースできませんでした' })
    }

    if (!Array.isArray(story.slides)) {
      return res.status(502).json({ ok: false, message: 'OpenAI応答: slides が配列ではありません' })
    }
    if (story.slides.length !== 14) {
      if (story.slides.length > 14) {
        story.slides = story.slides.slice(0, 14)
      } else {
        return res.status(502).json({ ok: false, message: `OpenAI応答: slides は14枚必要です（実際: ${story.slides.length}枚）` })
      }
    }
    for (let i = 0; i < story.slides.length; i++) {
      if (typeof story.slides[i].headline !== 'string') {
        return res.status(502).json({ ok: false, message: `OpenAI応答: slides[${i}].headline が文字列ではありません` })
      }
      if (typeof story.slides[i].imagePrompt !== 'string' || !story.slides[i].imagePrompt.trim()) {
        return res.status(502).json({ ok: false, message: `OpenAI応答: slides[${i}].imagePrompt が不正です（空文字またはstring以外）` })
      }
    }
    if (
      !story.variables ||
      typeof story.variables.title !== 'string' ||
      typeof story.variables.subtitle !== 'string' ||
      typeof story.variables.cta !== 'string'
    ) {
      return res.status(502).json({ ok: false, message: 'OpenAI応答: variables.title/subtitle/cta が不正です' })
    }

    res.json({ ok: true, story })
  } catch (err) {
    res.status(502).json({ ok: false, message: `OpenAI接続エラー: ${err.message}` })
  }
})

app.post('/api/generate-image', async (req, res) => {
  const { prompt } = req.body ?? {}
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ ok: false, message: 'prompt が必要です' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ ok: false, message: 'OPENAI_API_KEY が設定されていません' })
  }

  try {
    const imageRequest = {
      model: 'gpt-image-1',
      prompt: prompt.trim(),
      n: 1,
      size: '1024x1792',
    }
    console.log('[IMAGE_GENERATION_DEBUG] request keys:', Object.keys(imageRequest))
    console.log('[IMAGE_GENERATION_DEBUG] request body:', JSON.stringify(imageRequest, null, 2))

    const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(imageRequest),
    })

    if (!openaiRes.ok) {
      const errData = await openaiRes.json().catch(() => ({}))
      console.error('[IMAGE_GENERATION_DEBUG] OpenAI error response:', JSON.stringify(errData, null, 2))
      return res.status(502).json({ ok: false, message: `OpenAI APIエラー: ${errData.error?.message ?? openaiRes.status}` })
    }

    const openaiData = await openaiRes.json()
    const b64 = openaiData.data?.[0]?.b64_json
    if (!b64) {
      console.error('[IMAGE_GENERATION_DEBUG] Response data keys:', Object.keys(openaiData.data?.[0] ?? {}))
      return res.status(502).json({ ok: false, message: '画像データが取得できませんでした' })
    }

    const now = new Date()
    const timestamp = formatTimestamp(now)
    const randomSuffix = randomUUID().slice(0, 8)
    const filename = `ai-${timestamp}-${randomSuffix}.png`
    const filePath = resolve(GENERATED_DIR, filename)
    const buffer = Buffer.from(b64, 'base64')
    writeFileSync(filePath, buffer)

    res.json({
      ok: true,
      image: `generated/${filename}`,
      imageUrl: `/assets/generated/${filename}`,
      path: `generated/${filename}`,
    })
  } catch (err) {
    res.status(502).json({ ok: false, message: `画像生成エラー: ${err.message}` })
  }
})

app.get('/api/assets/generated', (_req, res) => {
  try {
    const files = readdirSync(GENERATED_DIR)
      .filter((f) => f.endsWith('.png'))
      .map((f) => {
        const st = statSync(resolve(GENERATED_DIR, f))
        return {
          filename: f,
          path: `generated/${f}`,
          size: st.size,
          createdAt: st.birthtime.toISOString(),
        }
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    const totalSize = files.reduce((acc, f) => acc + f.size, 0)
    res.json({ ok: true, assets: files, totalSize })
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message })
  }
})

app.delete('/api/assets/generated/:filename', (req, res) => {
  const safeFilename = basename(req.params.filename)
  if (!safeFilename.endsWith('.png')) {
    return res.status(400).json({ ok: false, message: '.png ファイルのみ削除できます' })
  }
  if (safeFilename !== req.params.filename) {
    return res.status(400).json({ ok: false, message: '不正なファイル名です' })
  }
  const filePath = resolve(GENERATED_DIR, safeFilename)
  if (!existsSync(filePath)) {
    return res.status(404).json({ ok: false, message: 'ファイルが見つかりません' })
  }
  try {
    unlinkSync(filePath)
    res.json({ ok: true, message: '削除しました' })
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message })
  }
})

// Phase18-H: テンプレート別SNS投稿文プロンプト
const SNS_TEMPLATE_PROMPTS = {
  'free-diagnosis-campaign': '無料診断キャンペーン向け。限定感、安心感、申し込みやすさを重視した投稿文を生成すること。',
  'music-community': '音楽コミュニティ紹介向け。初心者歓迎、仲間感、参加しやすさを重視した投稿文を生成すること。',
  'event-announcement': 'イベント告知向け。日時・場所・参加メリット・楽しさを明確にした投稿文を生成すること。',
  'note-article': 'Note記事紹介向け。記事を読みたくなる気づき、余白、共感を重視した投稿文を生成すること。',
  'youtube-video': 'YouTube動画紹介向け。見どころ、学べるポイント、視聴誘導を重視した投稿文を生成すること。',
  'singing-diagnosis': '歌唱診断紹介向け。体験価値、成長感、診断後の変化を重視した投稿文を生成すること。',
}

const SNS_CAPTION_REGENERATE_PROMPTS = {
  youtubeTitle: 'youtubeTitleだけを生成する。短く強いタイトル。日本語・60文字以内・#を使わない。',
  youtubeDescription: 'youtubeDescriptionだけを生成する。詳細説明・CTA入り・検索されやすい言葉を含める。日本語・3〜5行。',
  instagramCaption: 'instagramCaptionだけを生成する。共感・雰囲気・読みやすい改行を重視。日本語・3〜5行。',
  tiktokCaption: 'tiktokCaptionだけを生成する。冒頭インパクト・短くテンポよく・少しカジュアル。',
  xCaption: 'xCaptionだけを生成する。120文字前後・余白と一言感・拡散されやすい短文。',
  hashtags: 'hashtagsだけを生成する。SNS横断で使いやすいタグを10〜15個。#なしの文字列配列。',
}

const normalizeSnsCaption = (caption) => {
  if (!caption || typeof caption !== 'object') return null
  if (typeof caption.youtubeTitle !== 'string' || typeof caption.youtubeDescription !== 'string' ||
      typeof caption.instagramCaption !== 'string' || !Array.isArray(caption.hashtags)) {
    return null
  }

  return {
    youtubeTitle: caption.youtubeTitle,
    youtubeDescription: caption.youtubeDescription,
    instagramCaption: caption.instagramCaption,
    tiktokCaption: typeof caption.tiktokCaption === 'string' && caption.tiktokCaption.trim()
      ? caption.tiktokCaption
      : caption.instagramCaption,
    xCaption: typeof caption.xCaption === 'string' && caption.xCaption.trim()
      ? caption.xCaption
      : caption.instagramCaption,
    hashtags: caption.hashtags
      .filter((tag) => typeof tag === 'string')
      .map((tag) => tag.trim().replace(/^#+/, ''))
      .filter(Boolean),
  }
}

app.post('/api/sns-caption', async (req, res) => {
  const { slides, title, selectedPresetKey, selectedCustomPreset, templateId, regenerateTarget, currentCaption } = req.body ?? {}
  if (!Array.isArray(slides) || slides.length === 0) {
    return res.status(400).json({ ok: false, message: 'slides が空です' })
  }
  const isPartRegeneration = typeof regenerateTarget === 'string' && regenerateTarget.length > 0
  if (isPartRegeneration && !SNS_CAPTION_REGENERATE_PROMPTS[regenerateTarget]) {
    return res.status(400).json({ ok: false, message: 'regenerateTarget が不正です' })
  }
  const normalizedCurrentCaption = isPartRegeneration ? normalizeSnsCaption(currentCaption) : null
  if (isPartRegeneration && !normalizedCurrentCaption) {
    return res.status(400).json({ ok: false, message: 'currentCaption の形式が不正です' })
  }
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ ok: false, message: 'OPENAI_API_KEY が設定されていません' })
  }

  const slideSummary = slides
    .filter((s) => s.visible !== false)
    .slice(0, 8)
    .map((s, i) => {
      const parts = []
      if (s.headline) parts.push(`headline: "${s.headline}"`)
      if (s.subline) parts.push(`subline: "${s.subline}"`)
      if (s.emphasis) parts.push(`emphasis: "${s.emphasis}"`)
      if (s.ctaLabel) parts.push(`cta: "${s.ctaLabel}"`)
      return `[${i + 1}] ${parts.join(' / ')}`
    })
    .join('\n')

  const presetInfo = selectedCustomPreset
    ? `カスタムプリセット: name="${selectedCustomPreset.name}" tone="${selectedCustomPreset.tone}" audience="${selectedCustomPreset.targetAudience}" platform="${selectedCustomPreset.platform}" cta="${selectedCustomPreset.ctaText}"`
    : selectedPresetKey
    ? `プリセット: ${selectedPresetKey}`
    : 'プリセットなし'

  const templatePrompt = SNS_TEMPLATE_PROMPTS[templateId] ?? ''

  const systemPrompt = isPartRegeneration
    ? `あなたはSNSマーケティングの専門家です。
ショート動画のスライド内容と現在の投稿文を元に、指定された1項目だけを再生成してください。
必ずJSON形式のみで返してください。
${templatePrompt ? `\n【投稿スタイル指示】${templatePrompt}` : ''}
再生成対象: ${regenerateTarget}
生成方針: ${SNS_CAPTION_REGENERATE_PROMPTS[regenerateTarget]}
返すJSONは次の1項目のみです。
{
  "${regenerateTarget}": ${regenerateTarget === 'hashtags' ? '["タグ1", "タグ2", "...（#なしで10〜15個）"]' : '"再生成した本文"'}
}
hashtagsの値には#を含めないこと。`
    : `あなたはSNSマーケティングの専門家です。
ショート動画のスライド内容を元に、YouTube / Instagram / TikTok / X それぞれに最適化した投稿文をJSON形式で生成してください。
必ずJSON形式のみで返してください。
${templatePrompt ? `\n【投稿スタイル指示】${templatePrompt}` : ''}
{
  "youtubeTitle": "YouTube Shortsのタイトル（日本語・60文字以内・短く強め・検索されやすい言葉を含める・#を使わない）",
  "youtubeDescription": "YouTube説明文（日本語・3〜5行・動画の内容を少し詳しく・CTAを入れる・検索されやすい言葉を含める）",
  "instagramCaption": "Instagram投稿文（日本語・共感と雰囲気重視・読みやすく改行・3〜5行）",
  "tiktokCaption": "TikTok投稿文（日本語・冒頭インパクト重視・短くテンポよく・少しカジュアル・見た人が反応しやすい文）",
  "xCaption": "X投稿文（日本語・120文字前後・余白と一言感・拡散されやすい短文・ハッシュタグを本文に入れすぎない）",
  "hashtags": ["タグ1", "タグ2", "...（#なしで10〜15個）"]
}
hashtagsの値には#を含めないこと。`

  const userMessage = `動画タイトル: ${title || '（なし）'}
${presetInfo}
${templateId ? `テンプレート: ${templateId}` : ''}
${isPartRegeneration ? `\n現在の投稿文:\n${JSON.stringify(normalizedCurrentCaption, null, 2)}` : ''}

スライド内容:
${slideSummary}`

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.8,
        max_tokens: 1400,
      }),
    })

    if (!openaiRes.ok) {
      const errData = await openaiRes.json().catch(() => ({}))
      return res.status(502).json({ ok: false, message: `OpenAI APIエラー: ${errData.error?.message ?? openaiRes.status}` })
    }

    const openaiData = await openaiRes.json()
    const content = openaiData.choices?.[0]?.message?.content
    if (!content) return res.status(502).json({ ok: false, message: 'OpenAIからの応答が空です' })

    let caption
    try { caption = JSON.parse(content) } catch {
      return res.status(502).json({ ok: false, message: 'OpenAIの応答をパースできませんでした' })
    }

    if (isPartRegeneration) {
      if (regenerateTarget === 'hashtags') {
        if (!Array.isArray(caption.hashtags)) {
          return res.status(502).json({ ok: false, message: 'OpenAI応答の形式が不正です' })
        }
        const nextCaption = {
          ...normalizedCurrentCaption,
          hashtags: caption.hashtags
            .filter((tag) => typeof tag === 'string')
            .map((tag) => tag.trim().replace(/^#+/, ''))
            .filter(Boolean),
        }
        return res.json({ ok: true, caption: nextCaption })
      }

      if (typeof caption[regenerateTarget] !== 'string') {
        return res.status(502).json({ ok: false, message: 'OpenAI応答の形式が不正です' })
      }
      return res.json({
        ok: true,
        caption: {
          ...normalizedCurrentCaption,
          [regenerateTarget]: caption[regenerateTarget],
        },
      })
    }

    const normalizedCaption = normalizeSnsCaption(caption)
    if (!normalizedCaption) {
      return res.status(502).json({ ok: false, message: 'OpenAI応答の形式が不正です' })
    }

    res.json({ ok: true, caption: normalizedCaption })
  } catch (err) {
    res.status(502).json({ ok: false, message: `OpenAI接続エラー: ${err.message}` })
  }
})

app.post('/api/variant-generator', async (req, res) => {
  const { theme } = req.body ?? {}
  if (!theme || typeof theme !== 'string' || !theme.trim()) {
    return res.status(400).json({ ok: false, message: 'theme が空です' })
  }
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ ok: false, message: 'OPENAI_API_KEY が設定されていません' })
  }

  const systemPrompt = `あなたはSNSショート動画マーケターです。
テーマを元に、異なる切り口・異なる感情導線・異なる訴求方法を持つ7種類の動画企画を作成してください。
出力形式はJSONのみ。コードブロックや説明文は一切含めず、以下の形式のJSONを返してください：
{"variants":[{"name":"...","description":"...","angle":"..."},...]}`

  const userPrompt = `テーマ: ${theme.trim()}

7種類の動画バリアントをJSONで生成してください。
- name: バリアント名（日本語、10文字以内）
- description: このバリアントの訴求方針（日本語、30文字以内）
- angle: 訴求タイプ（英語スネークケース例: emotion, problem, story, education, action, youtube, instagram）`

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 800,
      }),
    })
    if (!openaiRes.ok) {
      const errData = await openaiRes.json().catch(() => ({}))
      return res.status(502).json({ ok: false, message: `OpenAI APIエラー: ${errData.error?.message ?? openaiRes.status}` })
    }
    const openaiData = await openaiRes.json()
    const content = openaiData.choices?.[0]?.message?.content
    if (!content) return res.status(502).json({ ok: false, message: 'OpenAIからの応答が空です' })

    let parsed
    try {
      parsed = JSON.parse(content.trim())
    } catch {
      return res.status(502).json({ ok: false, message: 'OpenAIの応答をパースできませんでした' })
    }
    if (!Array.isArray(parsed?.variants)) {
      return res.status(502).json({ ok: false, message: 'OpenAI応答の形式が不正です' })
    }

    res.json({ ok: true, variants: parsed.variants })
  } catch (err) {
    res.status(502).json({ ok: false, message: `OpenAI接続エラー: ${err.message}` })
  }
})

app.post('/api/rewrite-story', async (req, res) => {
  const { angle, slides } = req.body ?? {}
  if (!angle || typeof angle !== 'string') {
    return res.status(400).json({ ok: false, message: 'angle が必要です' })
  }
  if (!Array.isArray(slides) || slides.length === 0) {
    return res.status(400).json({ ok: false, message: 'slides が空です' })
  }
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ ok: false, message: 'OPENAI_API_KEY が設定されていません' })
  }

  const angleGuide = {
    emotion:   '感情共感型：忙しい人の日常感情に寄り添い、共感を引き出す文体',
    education: '教育型：実践的な知識・データ・行動習慣を学べる文体',
    problem:   '問題提起型：読者が感じている課題や危機感を強調する文体',
    story:     'ストーリー型：主人公の体験談を物語として語る文体',
    cta:       '行動促進型：今すぐ行動したくなるような強いCTA文体',
    authority: '専門性型：信頼感・権威性・データを前面に出した文体',
  }
  const guide = angleGuide[angle] ?? `${angle}型の訴求`

  const systemPrompt = `あなたはSNSショート動画のプロ脚本家です。
指定された訴求タイプに合わせて動画スライドをリライトしてください。

重要：
・スライド枚数は変更禁止
・JSONのみ出力（コードブロック禁止）
・headlineは短く強く（20文字以内推奨）
・スマホ視認性を重視
・元テーマは維持
・改行は\\nを使用可

訴求タイプ：${guide}

出力形式：{"slides":[{"headline":"...","subline":"...","emphasis":"..."},...]}
`

  const slideSummary = slides
    .filter((s) => s.visible !== false)
    .map((s, i) => {
      const parts = []
      if (s.headline) parts.push(`headline: "${s.headline}"`)
      if (s.subline) parts.push(`subline: "${s.subline}"`)
      if (s.emphasis) parts.push(`emphasis: "${s.emphasis}"`)
      return `[${i + 1}] ${parts.join(' / ')}`
    })
    .join('\n')

  const userPrompt = `以下の${slides.length}枚のスライドを「${guide}」でリライトしてください。\n\n${slideSummary}\n\n必ず${slides.length}枚分のslides配列をJSONで返してください。`

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 1500,
      }),
    })
    if (!openaiRes.ok) {
      const errData = await openaiRes.json().catch(() => ({}))
      return res.status(502).json({ ok: false, message: `OpenAI APIエラー: ${errData.error?.message ?? openaiRes.status}` })
    }
    const openaiData = await openaiRes.json()
    const content = openaiData.choices?.[0]?.message?.content
    if (!content) return res.status(502).json({ ok: false, message: 'OpenAIからの応答が空です' })

    let parsed
    try {
      parsed = JSON.parse(content.trim())
    } catch {
      return res.status(502).json({ ok: false, message: 'OpenAIの応答をパースできませんでした' })
    }
    if (!Array.isArray(parsed?.slides)) {
      return res.status(502).json({ ok: false, message: 'OpenAI応答の形式が不正です' })
    }
    if (parsed.slides.length !== slides.length) {
      return res.status(502).json({ ok: false, message: `スライド枚数が一致しません（期待: ${slides.length}, 実際: ${parsed.slides.length}）` })
    }

    res.json({ ok: true, slides: parsed.slides })
  } catch (err) {
    res.status(502).json({ ok: false, message: `OpenAI接続エラー: ${err.message}` })
  }
})

app.post('/api/score-variants', async (req, res) => {
  const { theme, variants, learningEvents } = req.body ?? {}
  if (!theme || typeof theme !== 'string') {
    return res.status(400).json({ ok: false, message: 'theme が必要です' })
  }
  if (!Array.isArray(variants) || variants.length === 0) {
    return res.status(400).json({ ok: false, message: 'variants が空です' })
  }
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ ok: false, message: 'OPENAI_API_KEY が設定されていません' })
  }

  const events = Array.isArray(learningEvents) ? learningEvents.slice(0, 50) : []
  const angleCounts = {}
  for (const e of events) {
    if (e.angle && e.angle !== 'unknown') angleCounts[e.angle] = (angleCounts[e.angle] ?? 0) + 1
  }
  const learningSummary = Object.entries(angleCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([angle, count]) => `${angle}: ${count}回`)
    .join(', ') || 'なし'

  const variantList = variants
    .map((v, i) => `${i + 1}. name="${v.name}" angle="${v.angle}" description="${v.description}"`)
    .join('\n')

  const systemPrompt = `あなたはSNSショート動画のマーケティングアナリストです。
現在のテーマ、候補Variant、過去の学習データを元に、各Variantの伸びやすさを1〜5で評価してください。

重要：
・出力はJSONのみ（コードブロック禁止）
・variantsと同数のscores配列を返す
・各スコアは1〜5の整数
・reasonは日本語で30文字以内

出力形式：{"scores":[{"variantName":"...","angle":"...","recommendation":5,"predictedViews":4,"savePotential":3,"ctaStrength":2,"reason":"..."},...]}
`
  const userPrompt = `テーマ: ${theme}

Variants:
${variantList}

過去の学習データ（angle別選択回数）:
${learningSummary}

${variants.length}件分のscores配列をJSONで返してください。`

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    })
    if (!openaiRes.ok) {
      const errData = await openaiRes.json().catch(() => ({}))
      return res.status(502).json({ ok: false, message: `OpenAI APIエラー: ${errData.error?.message ?? openaiRes.status}` })
    }
    const openaiData = await openaiRes.json()
    const content = openaiData.choices?.[0]?.message?.content
    if (!content) return res.status(502).json({ ok: false, message: 'OpenAIからの応答が空です' })

    let parsed
    try {
      parsed = JSON.parse(content.trim())
    } catch {
      return res.status(502).json({ ok: false, message: 'OpenAIの応答をパースできませんでした' })
    }
    if (!Array.isArray(parsed?.scores)) {
      return res.status(502).json({ ok: false, message: 'OpenAI応答の形式が不正です' })
    }
    if (parsed.scores.length !== variants.length) {
      return res.status(502).json({ ok: false, message: `スコア件数が一致しません（期待: ${variants.length}, 実際: ${parsed.scores.length}）` })
    }

    const clamp = (n) => Math.min(5, Math.max(1, Math.round(Number(n) || 3)))
    const scores = parsed.scores.map((s, i) => ({
      variantName: typeof s.variantName === 'string' ? s.variantName : (variants[i]?.name ?? ''),
      angle: typeof s.angle === 'string' ? s.angle : (variants[i]?.angle ?? ''),
      recommendation: clamp(s.recommendation),
      predictedViews: clamp(s.predictedViews),
      savePotential: clamp(s.savePotential),
      ctaStrength: clamp(s.ctaStrength),
      reason: typeof s.reason === 'string' && s.reason.trim() ? s.reason.trim() : '評価に基づく推定',
    }))

    res.json({ ok: true, scores })
  } catch (err) {
    res.status(502).json({ ok: false, message: `OpenAI接続エラー: ${err.message}` })
  }
})

app.post('/api/analyze-best-variant', async (req, res) => {
  const { theme, bestVariant, score, learningSummary } = req.body ?? {}
  if (!theme || typeof theme !== 'string') {
    return res.status(400).json({ ok: false, message: 'theme が必要です' })
  }
  if (!bestVariant || typeof bestVariant.name !== 'string') {
    return res.status(400).json({ ok: false, message: 'bestVariant が必要です' })
  }
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ ok: false, message: 'OPENAI_API_KEY が設定されていません' })
  }

  const topAnglesText = Array.isArray(learningSummary?.topAngles) && learningSummary.topAngles.length > 0
    ? learningSummary.topAngles.map((a) => `${a.angle}: ${a.count}回`).join(', ')
    : 'なし'

  const scoreText = score
    ? `recommendation=${score.recommendation}/5, predictedViews=${score.predictedViews}/5, savePotential=${score.savePotential}/5, ctaStrength=${score.ctaStrength}/5`
    : 'なし'

  const systemPrompt = `あなたはSNSショート動画の戦略アナリストです。
選ばれたVariantとテーマ、過去の学習データから
・なぜ選ばれたか（strengths）
・どんなテーマに向くか（bestFor）
・改善点（weaknesses）
・次回どう活かすか（nextActions）
・総評（summary）
を分析してください。

重要：
・出力はJSONのみ（コードブロック禁止）
・各配列は1〜4項目の日本語文字列
・summaryは1〜2文の日本語

出力形式：{"strengths":["..."],"weaknesses":["..."],"bestFor":["..."],"nextActions":["..."],"summary":"..."}`

  const userPrompt = `テーマ: ${theme}
選ばれたVariant: name="${bestVariant.name}" angle="${bestVariant.angle ?? '不明'}"
AIスコア: ${scoreText}
過去の学習データ（angle別選択回数）: ${topAnglesText}

上記を分析してJSONで返してください。`

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 600,
      }),
    })
    if (!openaiRes.ok) {
      const errData = await openaiRes.json().catch(() => ({}))
      return res.status(502).json({ ok: false, message: `OpenAI APIエラー: ${errData.error?.message ?? openaiRes.status}` })
    }
    const openaiData = await openaiRes.json()
    const content = openaiData.choices?.[0]?.message?.content
    if (!content) return res.status(502).json({ ok: false, message: 'OpenAIからの応答が空です' })

    let parsed
    try {
      parsed = JSON.parse(content.trim())
    } catch {
      return res.status(502).json({ ok: false, message: 'OpenAIの応答をパースできませんでした' })
    }
    const toArr = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [])
    const analysis = {
      strengths: toArr(parsed.strengths),
      weaknesses: toArr(parsed.weaknesses),
      bestFor: toArr(parsed.bestFor),
      nextActions: toArr(parsed.nextActions),
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    }
    res.json({ ok: true, analysis })
  } catch (err) {
    res.status(502).json({ ok: false, message: `OpenAI接続エラー: ${err.message}` })
  }
})

app.post('/api/explain-rewrite', async (req, res) => {
  const { beforeSlides, afterSlides, variantName, score } = req.body ?? {}
  if (!Array.isArray(beforeSlides) || !Array.isArray(afterSlides)) {
    return res.status(400).json({ ok: false, message: 'beforeSlides / afterSlides が必要です' })
  }
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ ok: false, message: 'OPENAI_API_KEY が設定されていません' })
  }

  const fmtSlides = (slides) =>
    slides.map((s, i) => {
      const parts = []
      if (s.headline) parts.push(`headline="${s.headline}"`)
      if (s.subline) parts.push(`subline="${s.subline}"`)
      if (s.emphasis) parts.push(`emphasis="${s.emphasis}"`)
      return `Slide ${i + 1}: ${parts.join(', ')}`
    }).join('\n')

  const scoreText = score
    ? `recommendation=${score.recommendation ?? '?'}/5, predictedViews=${score.predictedViews ?? '?'}/5, savePotential=${score.savePotential ?? '?'}/5, ctaStrength=${score.ctaStrength ?? '?'}/5`
    : 'なし'

  const systemPrompt = `あなたはSNSショート動画のコンテンツコーチです。
RewriteのBefore/Afterスライドを比較し、以下の観点で分析してください：
冒頭の引きの強さ / 共感性 / 保存されやすさ / CTAの自然さ / ストーリー性 / 視聴維持率 / 言葉の具体性 / 感情の動き

重要：
・出力はJSONのみ（コードブロック禁止）
・各配列は1〜4項目の日本語文字列
・summaryは1〜2文の日本語

出力形式：{"summary":"...","reasons":["..."],"improvedPoints":["..."],"risks":["..."],"nextSuggestions":["..."]}`

  const userPrompt = `Variant名: ${variantName ?? '不明'}
AIスコア: ${scoreText}

【Before】
${fmtSlides(beforeSlides)}

【After】
${fmtSlides(afterSlides)}

上記のRewriteを分析してJSONで返してください。`

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 600,
      }),
    })
    if (!openaiRes.ok) {
      const errData = await openaiRes.json().catch(() => ({}))
      return res.status(502).json({ ok: false, message: `OpenAI APIエラー: ${errData.error?.message ?? openaiRes.status}` })
    }
    const openaiData = await openaiRes.json()
    const content = openaiData.choices?.[0]?.message?.content
    if (!content) return res.status(502).json({ ok: false, message: 'OpenAIからの応答が空です' })

    let parsed
    try {
      parsed = JSON.parse(content.trim())
    } catch {
      return res.status(502).json({ ok: false, message: 'OpenAIの応答をパースできませんでした' })
    }
    const toArr = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [])
    const result = {
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
      reasons: toArr(parsed.reasons),
      improvedPoints: toArr(parsed.improvedPoints),
      risks: toArr(parsed.risks),
      nextSuggestions: toArr(parsed.nextSuggestions),
    }
    res.json({ ok: true, result })
  } catch (err) {
    res.status(502).json({ ok: false, message: `OpenAI接続エラー: ${err.message}` })
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
