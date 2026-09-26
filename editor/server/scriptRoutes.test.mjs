import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import fetch from 'node-fetch'
import { createScriptRouter, SCRIPT_LIMITS, openAiFailure, parseAiJson, validatePatterns, validateSlides } from './scriptRoutes.mjs'

// 実OpenAIへは一切接続しない。fetchImpl（OpenAI呼び出し）はすべてモック。テスト自体のHTTPは 127.0.0.1 のローカルサーバーだけ。
const KEY = 'sk-test-SECRET-KEY-1234567890'
const aiOk = (content) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }) })
const aiHttp = (status, message = 'x') => ({ ok: false, status, json: async () => ({ error: { message } }) })
const PATTERNS = { patterns: [{ title: '教育系', script: 'ひとつめ' }, { title: '共感系', script: 'ふたつめ' }, { title: '煽り系', script: 'みっつめ' }] }
const SLIDES = { slides: [{ text: '冒頭フック' }, { text: '本題' }, { text: 'まとめ' }] }

let server, base, fetchImpl, logs
const start = async (opts = {}) => {
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.use('/api', createScriptRouter({ getApiKey: () => KEY, fetchImpl, timeoutMs: 2000, ...opts }))
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
  base = `http://127.0.0.1:${server.address().port}`
}
const post = async (path, body, raw) => {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify(body) })
  const text = await r.text()
  return { status: r.status, text, json: (() => { try { return JSON.parse(text) } catch { return null } })() }
}

beforeEach(() => {
  fetchImpl = vi.fn()
  logs = []
  for (const m of ['log', 'error', 'warn', 'info']) vi.spyOn(console, m).mockImplementation((...a) => { logs.push(a.map(String).join(' ')) })
})
afterEach(async () => {
  vi.restoreAllMocks()
  if (server) await new Promise((r) => server.close(r))
  server = null
})

describe('POST /api/generate-script', () => {
  it('正常: 3パターンを返し、OpenAIへ1回だけ、キーはAuthorizationヘッダーのみで送る', async () => {
    fetchImpl.mockResolvedValue(aiOk(PATTERNS))
    await start()
    const r = await post('/api/generate-script', { concept: '歌が上手くなる方法', extra: 'ignored' })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ ok: true, patterns: PATTERNS.patterns })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`)
    const sent = JSON.parse(init.body)
    expect(sent.messages[1].content).toContain('歌が上手くなる方法')
    expect(init.body).not.toContain('ignored') // 想定外フィールドは送らない
    expect(sent.model).toBe('gpt-4o-mini')
  })
  it('日本語の入力・出力をそのまま扱う', async () => {
    fetchImpl.mockResolvedValue(aiOk({ patterns: [{ title: '共感系', script: '悩んでいませんか？😊' }] }))
    await start()
    const r = await post('/api/generate-script', { concept: '  ボイトレ初心者向け3つのコツ  ' })
    expect(r.json.patterns[0].script).toBe('悩んでいませんか？😊')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).messages[1].content).toBe('動画コンセプト: ボイトレ初心者向け3つのコツ')
  })
  it('空・空白・非文字列・欠落・配列・長すぎる入力は400で、OpenAIを呼ばない', async () => {
    await start()
    const bad = [{}, { concept: '' }, { concept: '   ' }, { concept: 123 }, { concept: ['a'] }, { concept: null }, { concept: 'あ'.repeat(SCRIPT_LIMITS.conceptMaxChars + 1) }]
    for (const b of bad) expect((await post('/api/generate-script', b)).status).toBe(400)
    expect((await post('/api/generate-script', null, '[]')).status).toBe(400)
    expect((await post('/api/generate-script', null, '"x"')).status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('上限ちょうどの文字数は受け付ける（文字数はコードポイントで数える）', async () => {
    fetchImpl.mockResolvedValue(aiOk(PATTERNS))
    await start()
    expect((await post('/api/generate-script', { concept: '😀'.repeat(SCRIPT_LIMITS.conceptMaxChars) })).status).toBe(200)
  })
  it('APIキー未設定なら、外部リクエスト前に分かりやすいエラー', async () => {
    for (const key of [undefined, '', '   ']) {
      await start({ getApiKey: () => key })
      const r = await post('/api/generate-script', { concept: 'a' })
      expect(r.status).toBe(500)
      expect(r.json.message).toContain('OPENAI_API_KEY')
      await new Promise((res) => server.close(res)); server = null
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('OpenAIのHTTPエラーは固定メッセージへ変換し、キーを含むOpenAI本文はレスポンスにもログにも出さない', async () => {
    await start()
    for (const status of [401, 429, 500, 400]) {
      fetchImpl.mockResolvedValue(aiHttp(status, `Incorrect API key provided: ${KEY}`))
      const r = await post('/api/generate-script', { concept: 'a' })
      expect(r.status).toBe(502)
      expect(r.text).not.toContain(KEY)
      expect(r.text).not.toContain('sk-')
      expect(r.json.message).toBe(openAiFailure(status).message)
    }
    expect(logs.join('\n')).not.toContain(KEY)
    expect(logs.join('\n')).not.toContain('Bearer')
  })
  it('自動リトライしない（失敗・タイムアウトでもOpenAIへは1回だけ）', async () => {
    fetchImpl.mockResolvedValue(aiHttp(500))
    await start()
    await post('/api/generate-script', { concept: 'a' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    fetchImpl.mockClear()
    fetchImpl.mockRejectedValue(new Error('socket hang up'))
    await post('/api/generate-script', { concept: 'a' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('タイムアウトは504で、待ち続けない（abort signal を渡す）', async () => {
    fetchImpl.mockImplementation((_u, init) => new Promise((_res, rej) => { init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e) }) }))
    await start({ timeoutMs: 30 })
    const t0 = Date.now()
    const r = await post('/api/generate-script', { concept: 'a' })
    expect(r.status).toBe(504)
    expect(r.json.message).toContain('タイムアウト')
    expect(Date.now() - t0).toBeLessThan(1500)
  })
  it('接続エラーは固定メッセージ（例外本文＝キーを含み得る文字列を出さない）', async () => {
    fetchImpl.mockRejectedValue(new Error(`connect failed with ${KEY}`))
    await start()
    const r = await post('/api/generate-script', { concept: 'a' })
    expect(r.status).toBe(502)
    expect(r.text).not.toContain(KEY)
    expect(logs.join('\n')).not.toContain(KEY)
  })
  it('不正なAI応答（空・非JSON・形式違い）は502で、AIの本文や入力をログへ出さない', async () => {
    await start()
    for (const content of ['', '   ', 'JSONではありません', '{"patterns":"x"}', '{"patterns":[]}', '{"patterns":[{"title":1,"script":2}]}', '[]']) {
      fetchImpl.mockResolvedValue(aiOk(content))
      const r = await post('/api/generate-script', { concept: '秘密のコンセプト' })
      expect(r.status).toBe(502)
      expect(r.json.ok).toBe(false)
    }
    fetchImpl.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json') } })
    expect((await post('/api/generate-script', { concept: 'a' })).status).toBe(502)
    expect(logs.join('\n')).not.toContain('秘密のコンセプト')
  })
  it('コードフェンスや前置きが付いたJSONも読み取り、4件以上は3件に絞る', async () => {
    const four = { patterns: [...PATTERNS.patterns, { title: '4', script: 'x' }] }
    fetchImpl.mockResolvedValue(aiOk('```json\n' + JSON.stringify(four) + '\n```'))
    await start()
    const r = await post('/api/generate-script', { concept: 'a' })
    expect(r.json.patterns).toHaveLength(3)
  })
  it('モックモードでは外部へ出ず固定の応答を返す（キーも不要）', async () => {
    await start({ isMockMode: true, getApiKey: () => undefined })
    const r = await post('/api/generate-script', { concept: 'a' })
    expect(r.json.patterns).toHaveLength(3)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('POST /api/split-script', () => {
  it('正常: スライドへ分割して返す', async () => {
    fetchImpl.mockResolvedValue(aiOk(SLIDES))
    await start()
    const r = await post('/api/split-script', { script: '  台本の本文です。  ' })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ ok: true, slides: SLIDES.slides })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).messages[1].content).toBe('台本:\n台本の本文です。')
  })
  it('空・不正・長すぎる入力は400', async () => {
    await start()
    for (const b of [{}, { script: '' }, { script: ' \n ' }, { script: 5 }, { concept: 'x' }, { script: 'あ'.repeat(SCRIPT_LIMITS.scriptMaxChars + 1) }]) {
      expect((await post('/api/split-script', b)).status).toBe(400)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('APIキー未設定 / OpenAIエラー / タイムアウト / 不正応答', async () => {
    await start({ getApiKey: () => undefined })
    expect((await post('/api/split-script', { script: 'a' })).status).toBe(500)
    expect(fetchImpl).not.toHaveBeenCalled()
    await new Promise((res) => server.close(res)); server = null

    await start()
    fetchImpl.mockResolvedValue(aiHttp(429, `quota ${KEY}`))
    const e = await post('/api/split-script', { script: 'a' })
    expect(e.status).toBe(502)
    expect(e.text).not.toContain(KEY)
    fetchImpl.mockResolvedValue(aiOk({ slides: [] }))
    expect((await post('/api/split-script', { script: 'a' })).status).toBe(502)
    fetchImpl.mockResolvedValue(aiOk('not json'))
    expect((await post('/api/split-script', { script: 'a' })).status).toBe(502)
    await new Promise((res) => server.close(res)); server = null

    fetchImpl.mockImplementation((_u, init) => new Promise((_r, rej) => { init.signal.addEventListener('abort', () => { const x = new Error('a'); x.name = 'AbortError'; rej(x) }) }))
    await start({ timeoutMs: 30 })
    expect((await post('/api/split-script', { script: 'a' })).status).toBe(504)
  })
  it('スライドは最大14件・空テキストは除外', async () => {
    fetchImpl.mockResolvedValue(aiOk({ slides: [{ text: '' }, ...Array.from({ length: 20 }, (_, i) => ({ text: `s${i}` })), { text: 3 }] }))
    await start()
    const r = await post('/api/split-script', { script: 'a' })
    expect(r.json.slides).toHaveLength(14)
    expect(r.json.slides[0].text).toBe('s0')
  })
})

describe('ヘルパー', () => {
  it('parseAiJson / validatePatterns / validateSlides', () => {
    expect(parseAiJson('前置き {"a":1} 後ろ')).toEqual({ a: 1 })
    expect(parseAiJson('壊れた')).toBeNull()
    expect(parseAiJson(undefined)).toBeNull()
    expect(validatePatterns({ patterns: [{ title: 'a', script: 'b' }] })).toEqual([{ title: 'a', script: 'b' }])
    expect(validatePatterns(null)).toBeNull()
    expect(validateSlides({ slides: [{ text: ' x ' }] })).toEqual([{ text: 'x' }])
  })
  it('既存のAPIを上書きしない（このルーターは generate-script / split-script のみ）', () => {
    const paths = createScriptRouter().stack.map((l) => l.route.path).sort()
    expect(paths).toEqual(['/generate-script', '/split-script'])
  })
})
