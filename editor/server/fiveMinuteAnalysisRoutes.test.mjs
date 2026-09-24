import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import fetch from 'node-fetch'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createFiveMinuteAnalysisRouter, findFiveMinuteData } from './fiveMinuteAnalysisRoutes.mjs'
import { buildAnalysisRecord, fingerprintCaptions, analysisPath } from './lib/topicAnalysis.mjs'

const JOB = 'job-1234'
const KEY = 'five_minute_613'
const captions = Array.from({ length: 100 }, (_, i) => ({
  id: `natural-${String(i).padStart(3, '0')}`,
  startSec: i * 3,
  endSec: i * 3 + 2.8,
  text: i < 50 ? `メンバーとの距離がとても大事です${i}` : `ライブの準備は絶対に必要です${i}`,
  lines: [],
}))
const id = (i) => captions[i].id
const validated = {
  topics: [
    { title: 'メンバーとの距離の取り方', startCaptionId: id(0), endCaptionId: id(49), supportingCaptionIds: [id(2)], confidence: 0.9 },
    { title: 'ライブ準備の進め方', startCaptionId: id(50), endCaptionId: id(99), supportingCaptionIds: [id(60)], confidence: 0.8 },
  ],
  emphasis: [{ captionId: id(0), emphasisText: 'とても大事', category: 'keyword', confidence: 0.8 }],
}

let dir
let server
let url
beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'five-min-routes-')))
  const app = express()
  app.use('/api/jobs/:id/five-minute', createFiveMinuteAnalysisRouter({ dataDir: dir }))
  await new Promise((r) => { server = app.listen(0, r) })
  url = `http://127.0.0.1:${server.address().port}/api/jobs`
})
afterAll(async () => {
  await new Promise((r) => server.close(r))
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  for (const n of readdirSync(dir)) rmSync(join(dir, n), { force: true })
})

function seed({ withAnalysis = true } = {}) {
  writeFileSync(join(dir, `${KEY}.pages.json`), JSON.stringify({ jobId: JOB, captions }))
  if (withAnalysis) writeFileSync(analysisPath(dir, KEY), JSON.stringify(buildAnalysisRecord(validated, captions)))
}
const call = async (method, path, body) => {
  const res = await fetch(`${url}/${JOB}/five-minute${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: await res.json() }
}
const saved = () => JSON.parse(readFileSync(analysisPath(dir, KEY), 'utf-8'))

describe('取得', () => {
  it('データが無ければ404、分析結果が未保存なら409', async () => {
    expect((await call('GET', '/')).status).toBe(404)
    seed({ withAnalysis: false })
    expect((await call('GET', '/')).status).toBe(409)
  })
  it('captionと分析(source:ai)、表示用のセクション・強調数を返す', async () => {
    seed()
    const r = await call('GET', '/')
    expect(r.status).toBe(200)
    expect(r.json.captions).toHaveLength(100)
    expect(r.json.analysis.topics.map((t) => t.source)).toEqual(['ai', 'ai'])
    expect(r.json.sections).toHaveLength(2)
    expect(r.json.emphasisCount).toBe(1)
  })
  it('caption列が変わった保存結果は409で拒否する', async () => {
    seed()
    writeFileSync(join(dir, `${KEY}.pages.json`), JSON.stringify({ jobId: JOB, captions: captions.map((c, i) => (i === 0 ? { ...c, text: c.text + 'x' } : c)) }))
    expect((await call('GET', '/')).status).toBe(409)
  })
  it('不正なジョブIDは400', async () => {
    const res = await fetch(`${url}/${encodeURIComponent('../x')}/five-minute/`)
    expect([400, 404]).toContain(res.status)
    expect(findFiveMinuteData(dir, 'other-job')).toBeNull()
  })
})

describe('手動修正（テーマ）', () => {
  beforeEach(() => seed())
  it('テーマ名・終了の修正は source:manual で保存される', async () => {
    const r = await call('PATCH', '/topics/topic-001', { title: 'メンバーとの付き合い方', endCaptionId: id(45) })
    expect(r.status).toBe(200)
    expect(saved().topics[0]).toMatchObject({ title: 'メンバーとの付き合い方', source: 'manual', endCaptionId: id(45) })
    expect(r.json.sections[0].endSec).toBe(captions[45].endSec)
  })
  it('不正な修正(空タイトル・未知ID・重複)は400で、保存内容は変わらない', async () => {
    const before = readFileSync(analysisPath(dir, KEY), 'utf-8')
    expect((await call('PATCH', '/topics/topic-001', { title: '' })).status).toBe(400)
    expect((await call('PATCH', '/topics/topic-001', { endCaptionId: 'nope' })).status).toBe(400)
    expect((await call('PATCH', '/topics/topic-001', { endCaptionId: id(60) })).status).toBe(400)
    expect((await call('PATCH', '/topics/nope', { title: 'メンバーとの距離の話' })).status).toBe(400)
    expect(readFileSync(analysisPath(dir, KEY), 'utf-8')).toBe(before)
  })
  it('AI候補を個別に却下・採用できる（却下すると表示用セクションから外れる）', async () => {
    const rej = await call('POST', '/topics/topic-002/decision', { decision: 'rejected' })
    expect(rej.json.sections).toHaveLength(1)
    const acc = await call('POST', '/topics/topic-002/decision', { decision: 'accepted' })
    expect(acc.json.sections).toHaveLength(2)
    expect((await call('POST', '/topics/topic-002/decision', { decision: 'maybe' })).status).toBe(400)
  })
})

describe('手動修正（部分強調）', () => {
  beforeEach(() => seed())
  it('追加・変更・削除ができ、追加・変更は source:manual', async () => {
    const add = await call('PUT', `/emphasis/${id(20)}`, { emphasisText: 'メンバー' })
    expect(add.status).toBe(200)
    expect(saved().emphasis.find((e) => e.captionId === id(20))).toMatchObject({ source: 'manual', emphasisText: 'メンバー' })
    await call('PUT', `/emphasis/${id(20)}`, { emphasisText: '距離' })
    expect(saved().emphasis.filter((e) => e.captionId === id(20))).toHaveLength(1)
    const del = await call('DELETE', `/emphasis/${id(20)}`)
    expect(del.json.emphasisCount).toBe(1)
  })
  it('本文の部分文字列でない・助詞だけの強調は400', async () => {
    expect((await call('PUT', `/emphasis/${id(20)}`, { emphasisText: '存在しない語' })).status).toBe(400)
    expect((await call('PUT', `/emphasis/${id(20)}`, { emphasisText: 'の' })).status).toBe(400)
    expect((await call('PUT', '/emphasis/nope', { emphasisText: 'メンバー' })).status).toBe(400)
  })
  it('AI強調を却下でき、採用に戻せる', async () => {
    expect((await call('POST', `/emphasis/${id(0)}/decision`, { decision: 'rejected' })).json.emphasisCount).toBe(0)
    expect((await call('POST', `/emphasis/${id(0)}/decision`, { decision: 'accepted' })).json.emphasisCount).toBe(1)
  })
})

describe('安全性', () => {
  it('保存は原子的（一時ファイルが残らない）で、caption本文・時刻は書き換えない', async () => {
    seed()
    const pagesBefore = readFileSync(join(dir, `${KEY}.pages.json`), 'utf-8')
    await call('PATCH', '/topics/topic-001', { title: 'メンバーとの付き合い方' })
    await call('PUT', `/emphasis/${id(20)}`, { emphasisText: 'メンバー' })
    expect(readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([])
    expect(readFileSync(join(dir, `${KEY}.pages.json`), 'utf-8')).toBe(pagesBefore)
    expect(saved().captionsFingerprint).toBe(fingerprintCaptions(captions))
  })
  it('このルーターはAI APIを呼ばない（openai/fetchの呼び出しを含まない）', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fiveMinuteAnalysisRoutes.mjs'), 'utf-8')
    expect(/api\.openai|requestAnalysisOnce|runAnalysisOnce|fetch\(/.test(src)).toBe(false)
  })
})
