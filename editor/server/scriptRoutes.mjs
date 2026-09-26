// 台本作成モード（ScriptMode）用のAPI: 台本生成と台本分割。
//
// editor/server.mjs から `createScriptRouter()` を `/api` にマウントする。
// このファイルだけで完結し、他の既存APIへは影響しない。
//
// 安全方針:
// - APIキーは環境変数 OPENAI_API_KEY からだけ読み、キー未設定なら外部リクエスト前に返す。
// - キー・Authorization・OpenAIのエラー本文（キーの一部を含み得る）はレスポンスにもログにも出さない。
//   エラーは HTTP ステータスから決めた固定メッセージへ変換する。
// - 入力（コンセプト・台本）とAIの出力はログにも保存にも残さない。
// - タイムアウトあり・自動リトライなし（1リクエストにつきOpenAIへ最大1回）。
// - 入力は型・長さを検証し、未知のフィールドは無視する。AI応答も形式を検証してから返す。

import express from 'express'
import nodeFetch from 'node-fetch'

export const SCRIPT_LIMITS = Object.freeze({
  conceptMaxChars: 1000,
  scriptMaxChars: 8000,
  patternCount: 3,
  patternScriptMaxChars: 4000,
  patternTitleMaxChars: 40,
  slidesMax: 14,
  slideTextMaxChars: 200,
})

export const DEFAULT_SCRIPT_MODEL = 'gpt-4o-mini'
export const DEFAULT_TIMEOUT_MS = 60_000
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

const GENERATE_SYSTEM_PROMPT = `あなたはショート動画（TikTok / Instagram Reels）の台本ライターです。
ユーザーが提供する動画コンセプトに基づいて、3種類の台本パターンを作成してください。

各パターンは以下の特徴を持ちます：
1. 教育系：わかりやすく情報を伝え、視聴者が学べる構成
2. 共感系：視聴者の悩みや感情に寄り添い、共感を引き出す構成
3. 煽り系：好奇心や緊迫感を煽り、視聴を継続させる構成

各台本は60〜90秒の読み上げに相当する長さ（400〜600文字程度）にしてください。
口語体で書き、視聴者に語りかける形式にしてください。
フックとなる冒頭文、本編、CTAを含めてください。

必ずJSON形式のみで返してください。説明文は不要です。
Return valid JSON only. Do not include markdown fences.

JSONフォーマット:
{
  "patterns": [
    { "title": "教育系", "script": "..." },
    { "title": "共感系", "script": "..." },
    { "title": "煽り系", "script": "..." }
  ]
}`

const SPLIT_SYSTEM_PROMPT = `以下の台本をショート動画向けに8〜12枚程度のスライドへ分解してください。

ルール:
- 1スライド1メッセージ
- 読みやすい長さに整える（1枚20文字前後）
- 強いフックを先頭に置く
- 最後はまとめ
- 必ずJSON形式のみで返してください。説明文は不要です。

Return valid JSON only.
Do not include markdown fences.
Do not include explanation text.
{
  "slides": [
    { "text": "スライドのテキスト" }
  ]
}`

/** OpenAI のHTTPステータスから、安全な固定メッセージを作る（OpenAI側の本文は使わない）。 */
export function openAiFailure(status) {
  if (status === 401 || status === 403) return { httpStatus: 502, message: 'OpenAI APIの認証に失敗しました。OPENAI_API_KEY の設定を確認してください。' }
  if (status === 429) return { httpStatus: 502, message: 'OpenAI APIの利用制限に達しました。しばらく待つか、利用枠（Billing / Usage / Limits）を確認してください。' }
  if (status >= 500) return { httpStatus: 502, message: 'OpenAI側で一時的なエラーが発生しました。しばらくしてからもう一度お試しください。' }
  return { httpStatus: 502, message: 'OpenAI APIがリクエストを受け付けませんでした。' }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** 文字列フィールドを検証する。OKなら { value }、NGなら { error }。 */
function readText(body, field, label, maxChars) {
  if (!isPlainObject(body)) return { error: `${label}が必要です` }
  const raw = body[field]
  if (typeof raw !== 'string') return { error: `${label}が必要です` }
  const value = raw.trim()
  if (!value) return { error: `${label}が必要です` }
  if ([...value].length > maxChars) return { error: `${label}は${maxChars}文字以内にしてください` }
  return { value }
}

/** AI応答の本文をJSONとして読む。コードフェンスや前後の説明が付いていても最初の {..} を試す。 */
export function parseAiJson(text) {
  if (typeof text !== 'string') return null
  try { return JSON.parse(text) } catch { /* 次へ */ }
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)) } catch { /* 不正 */ } }
  return null
}

export function validatePatterns(parsed) {
  if (!isPlainObject(parsed) || !Array.isArray(parsed.patterns)) return null
  const L = SCRIPT_LIMITS
  const patterns = parsed.patterns
    .filter((p) => isPlainObject(p) && typeof p.title === 'string' && typeof p.script === 'string' && p.title.trim() && p.script.trim())
    .slice(0, L.patternCount)
    .map((p) => ({ title: [...p.title.trim()].slice(0, L.patternTitleMaxChars).join(''), script: [...p.script.trim()].slice(0, L.patternScriptMaxChars).join('') }))
  return patterns.length ? patterns : null
}

export function validateSlides(parsed) {
  if (!isPlainObject(parsed) || !Array.isArray(parsed.slides)) return null
  const L = SCRIPT_LIMITS
  const slides = parsed.slides
    .filter((s) => isPlainObject(s) && typeof s.text === 'string' && s.text.trim())
    .slice(0, L.slidesMax)
    .map((s) => ({ text: [...s.text.trim()].slice(0, L.slideTextMaxChars).join('') }))
  return slides.length ? slides : null
}

const mockPatterns = (concept) => ['教育系', '共感系', '煽り系'].map((title) => ({ title, script: `【Mock: ${title}台本】\n\n「${concept}」についての台本サンプルです。` }))
const mockSlides = () => Array.from({ length: 8 }, (_, i) => ({ text: `Mock スライド ${i + 1}` }))

/**
 * @param {object} [opts]
 * @param {() => string | undefined} [opts.getApiKey] 既定: process.env.OPENAI_API_KEY
 * @param {typeof nodeFetch} [opts.fetchImpl] 既定: node-fetch（テストでは差し替える）
 * @param {boolean} [opts.isMockMode] REEL_AI_MODE=mock のとき true（外部へ出ず固定の応答を返す）
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.model] 既定: 環境変数 SCRIPT_AI_MODEL、なければ gpt-4o-mini
 */
export function createScriptRouter(opts = {}) {
  const getApiKey = opts.getApiKey ?? (() => process.env.OPENAI_API_KEY)
  const fetchImpl = opts.fetchImpl ?? nodeFetch
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const model = opts.model ?? process.env.SCRIPT_AI_MODEL ?? DEFAULT_SCRIPT_MODEL
  const router = express.Router()

  /** OpenAIへ1回だけ問い合わせ、{ ok, content } か { ok:false, httpStatus, message } を返す。 */
  async function askOpenAi({ label, apiKey, system, user, temperature, maxTokens }) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const r = await fetchImpl(OPENAI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' }, temperature, max_tokens: maxTokens }),
        signal: controller.signal,
      })
      if (!r.ok) {
        console.error(`[${label}] OpenAI HTTP ${r.status}`)
        return { ok: false, ...openAiFailure(r.status) }
      }
      let data
      try { data = await r.json() } catch { data = null }
      const content = data?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) return { ok: false, httpStatus: 502, message: 'AI応答が空でした。もう一度お試しください。' }
      return { ok: true, content }
    } catch (e) {
      if (e?.name === 'AbortError') {
        console.error(`[${label}] timeout`)
        return { ok: false, httpStatus: 504, message: 'AIの応答がタイムアウトしました。もう一度お試しください。' }
      }
      console.error(`[${label}] connection error (${e?.name ?? 'Error'})`) // メッセージ本文は出さない
      return { ok: false, httpStatus: 502, message: 'OpenAI APIへ接続できませんでした。ネットワークを確認してください。' }
    } finally {
      clearTimeout(timer)
    }
  }

  async function handle(req, res, { label, field, fieldLabel, maxChars, mock, system, userPrefix, temperature, maxTokens, validate, key, badMessage }) {
    const input = readText(req.body, field, fieldLabel, maxChars)
    if (input.error) return res.status(400).json({ ok: false, message: input.error })
    if (opts.isMockMode) return res.json({ ok: true, [key]: mock(input.value) })
    const apiKey = getApiKey()
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      return res.status(500).json({ ok: false, message: 'OPENAI_API_KEY が設定されていません。editor/.env を確認してください。' })
    }
    const r = await askOpenAi({ label, apiKey: apiKey.trim(), system, user: `${userPrefix}${input.value}`, temperature, maxTokens })
    if (!r.ok) return res.status(r.httpStatus).json({ ok: false, message: r.message })
    const validated = validate(parseAiJson(r.content))
    if (!validated) return res.status(502).json({ ok: false, message: badMessage })
    return res.json({ ok: true, [key]: validated })
  }

  router.post('/generate-script', (req, res) => handle(req, res, {
    label: 'generate-script', field: 'concept', fieldLabel: 'コンセプト', maxChars: SCRIPT_LIMITS.conceptMaxChars,
    mock: mockPatterns, system: GENERATE_SYSTEM_PROMPT, userPrefix: '動画コンセプト: ', temperature: 0.8, maxTokens: 2000,
    validate: validatePatterns, key: 'patterns', badMessage: 'AI応答の形式が不正でした。もう一度お試しください。',
  }))

  router.post('/split-script', (req, res) => handle(req, res, {
    label: 'split-script', field: 'script', fieldLabel: '台本', maxChars: SCRIPT_LIMITS.scriptMaxChars,
    mock: mockSlides, system: SPLIT_SYSTEM_PROMPT, userPrefix: '台本:\n', temperature: 0.5, maxTokens: 1000,
    validate: validateSlides, key: 'slides', badMessage: 'スライド分割の応答が不正でした。もう一度お試しください。',
  }))

  return router
}
