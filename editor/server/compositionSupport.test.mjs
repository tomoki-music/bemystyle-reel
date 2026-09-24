import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import fetch from 'node-fetch'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { EventEmitter } from 'events'
import { sanitizeCompositionOverrides, getCompositionEnvOverrides, isCompositionConfiguredByEnv, describeCompositionStatus, prepareJobComposition, createCompositionRouter } from './compositionSupport.mjs'

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'comp-support-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const probe = (spawnedKind = null) => (bin, args) => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  const isImage = String(args[args.length - 1]).endsWith('.png')
  setImmediate(() => {
    child.stdout.emit('data', JSON.stringify(isImage ? { format: {}, streams: [{ codec_type: 'video', width: 554, height: 518 }] } : { format: { duration: '63.9' }, streams: [{ codec_type: 'audio' }] }))
    child.emit('close', 0)
  })
  return child
}
const assets = () => {
  writeFileSync(join(dir, 'bgm.mp3'), 'x')
  writeFileSync(join(dir, 'qr.png'), 'x')
  return { COMPOSITION_BGM_PATH: join(dir, 'bgm.mp3'), COMPOSITION_QR_PATH: join(dir, 'qr.png') }
}
// 合成ジョブ（実際の字幕本文ではない）: 300秒
const job = {
  width: 1920, height: 1080, durationSec: 300,
  captions: Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, startSec: i * 3, endSec: i * 3 + 2.8, text: `テスト字幕${i}${i % 2 === 1 ? '。' : '、'}`, lines: [`テスト字幕${i}`], captionType: 'normal', displayOrder: i })),
  topicSections: [{ id: 't1', title: '最初のテーマ名です', startSec: 0, endSec: 100, source: 'ai' }, { id: 't2', title: '二番目のテーマ名です', startSec: 150, endSec: 250, source: 'manual' }],
}

describe('設定の受け渡し', () => {
  it('UIからの上書きは許可した項目だけ。素材パス・未知のキーは無視する', () => {
    const o = sanitizeCompositionOverrides({ digest: { enabled: false, durationSec: 25, bgm: { path: '/etc/passwd', volume: 0.1 }, evil: 1 }, line: { qrPath: '/etc/passwd' }, lineOutro: { showQr: 'yes' }, __proto__: { x: 1 } })
    expect(o.digest).toEqual({ enabled: false, durationSec: 25, bgm: { volume: 0.1 } })
    expect(JSON.stringify(o)).not.toContain('/etc/passwd')
    expect(o.line).toBeUndefined()
    expect(o.lineOutro).toEqual({})
    expect(sanitizeCompositionOverrides(null)).toEqual({})
  })
  it('表示方式（mode）・開始位置の上書きは許可された値だけ受け取る', () => {
    expect(sanitizeCompositionOverrides({ lineIntro: { mode: 'standalone', startWithMain: true }, lineOutro: { mode: 'x' } }).lineIntro).toEqual({ mode: 'standalone', startWithMain: true })
    expect(sanitizeCompositionOverrides({ lineOutro: { mode: 'x' } }).lineOutro).toEqual({})
  })
  it('素材パスは環境設定から。どちらか指定されていれば「環境設定で構成を適用」（足りない素材は準備時にエラー）', () => {
    expect(getCompositionEnvOverrides({})).toEqual({})
    expect(isCompositionConfiguredByEnv({})).toBe(false)
    expect(isCompositionConfiguredByEnv({ COMPOSITION_BGM_PATH: '/a.mp3' })).toBe(true)
    expect(isCompositionConfiguredByEnv({ COMPOSITION_QR_PATH: '/q.png' })).toBe(true)
    expect(isCompositionConfiguredByEnv({ COMPOSITION_BGM_PATH: '/a.mp3', COMPOSITION_QR_PATH: '/q.png' })).toBe(true)
  })
})

describe('describeCompositionStatus（UI表示用。絶対パスを返さない）', () => {
  it('素材未設定: 各素材は「未設定」。設定の既定はすべてON・プレビューはすべてOFF', async () => {
    const s = await describeCompositionStatus({}, [dir], { env: {} })
    expect(s.assets.bgm).toMatchObject({ ok: false, error: '未設定' })
    expect(s.assets.qr.ok).toBe(false)
    expect(s.config.digest.enabled && s.config.lineIntro.enabled && s.config.lineOutro.enabled).toBe(true)
    expect(s.config.preview).toEqual({ digest: false, lineIntro: false, lineOutro: false })
    expect(s.configuredByEnv).toBe(false)
  })
  it('素材あり: サイズ・長さ・寸法だけを返し、パスは含めない', async () => {
    const env = assets()
    const s = await describeCompositionStatus({ digest: { bgm: { volume: 0.1 } } }, [dir], { env, spawnFn: probe() })
    expect(s.assets.bgm).toMatchObject({ ok: true, durationSec: 63.9 })
    expect(s.assets.qr).toMatchObject({ ok: true, width: 554, height: 518 })
    expect(s.config.digest.bgm.volume).toBe(0.1)
    expect(JSON.stringify(s)).not.toContain(dir)
    expect(s.config.digest.bgm.credit.title).toBe('The maze of aqua')
    expect(s.configuredByEnv).toBe(true)
  })
})

describe('prepareJobComposition（ジョブから構成を準備）', () => {
  it('素材が無い/範囲外のときは、絶対パスを含まない400相当のエラー（レンダーしない）', async () => {
    const err = await prepareJobComposition(job, {}, [dir], { env: { COMPOSITION_BGM_PATH: join(dir, 'missing.mp3'), COMPOSITION_QR_PATH: join(dir, 'missing.png') } }).catch((e) => e)
    expect(err.status).toBe(400)
    expect(err.message).toContain('素材を確認できません')
    expect(err.message).not.toContain(dir)
  })
  it('構成を準備する: 区間順序・本編オフセット・LINE文言・テーマ常時表示（ジョブは変更しない）', async () => {
    const env = assets()
    const before = JSON.stringify(job)
    const p = await prepareJobComposition(job, {}, [dir], { env, spawnFn: probe() })
    expect(p.timeline.sections.map((s) => s.kind)).toEqual(['digest', 'main', 'lineOutro']) // 冒頭LINE案内はoverlay（独立区間なし）
    expect(p.timeline.mainOffsetSec).toBeCloseTo(p.timeline.sections[0].endSec, 3) // 本編開始 = ダイジェスト終了
    expect(p.timeline.overlays[0]).toMatchObject({ kind: 'lineIntro', startSec: p.timeline.mainOffsetSec })
    expect(p.digest.clips.length).toBeGreaterThanOrEqual(3)
    expect(p.assText).toContain('LINEお友だち登録受付中')
    expect(p.assText).toContain('TALK THEME')
    expect(JSON.stringify(job)).toBe(before)
  })
  it('ダイジェストOFF・LINE案内OFFの上書きを反映する。テーマが無いジョブでは根拠のないテーマを作らない', async () => {
    const env = assets()
    const noThemes = { ...job, topicSections: undefined }
    const p = await prepareJobComposition(noThemes, { digest: { enabled: false }, lineIntro: { enabled: false } }, [dir], { env, spawnFn: probe() })
    expect(p.timeline.sections.map((s) => s.kind)).toEqual(['main', 'lineOutro'])
    expect(p.assText).not.toContain('TALK THEME')
  })
  it('QR画像が見つからない場合は、レンダー前に明確なエラー（QRを省略して続行しない）。BGMだけの環境設定でも同じ', async () => {
    const bgmOnly = { COMPOSITION_BGM_PATH: assets().COMPOSITION_BGM_PATH }
    const err = await prepareJobComposition(job, {}, [dir], { env: bgmOnly, spawnFn: probe() }).catch((e) => e)
    expect(err.status).toBe(400)
    expect(err.message).toContain('LINE QR画像が見つかりません。QR画像の設定を確認してください。')
    expect(err.message).not.toContain(dir)
  })
  it('QRの表示は冒頭・末尾を個別にOFFでき、全体スイッチOFFなら素材なしでも準備できる（既定は両方ON）', async () => {
    const env = assets()
    const both = await prepareJobComposition(job, {}, [dir], { env, spawnFn: probe() })
    expect([both.cfg.qr.enabled, both.cfg.lineIntro.showQr, both.cfg.lineOutro.showQr]).toEqual([true, true, true])
    const introOff = await prepareJobComposition(job, { lineIntro: { showQr: false } }, [dir], { env, spawnFn: probe() })
    expect([introOff.cfg.lineIntro.showQr, introOff.cfg.lineOutro.showQr]).toEqual([false, true])
    const bgmOnly = { COMPOSITION_BGM_PATH: env.COMPOSITION_BGM_PATH }
    const off = await prepareJobComposition(job, { qr: { enabled: false } }, [dir], { env: bgmOnly, spawnFn: probe() })
    expect(off.assets.qr).toBeNull()
  })
})

describe('createCompositionRouter', () => {
  it('POST /status は絶対パスを含まないJSON。QR未設定なら /qr-image は404', async () => {
    const app = express()
    app.use('/c', createCompositionRouter({ getRoots: () => [dir] }))
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
    const base = `http://127.0.0.1:${server.address().port}/c`
    try {
      const st = await (await fetch(`${base}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ composition: { digest: { enabled: false } } }) })).json()
      expect(st.ok).toBe(true)
      expect(st.config.digest.enabled).toBe(false)
      expect(JSON.stringify(st)).not.toMatch(/qrPath|"path"/)
      const r = await fetch(`${base}/qr-image`)
      expect(r.status).toBe(404)
    } finally {
      server.close()
    }
  })
})
