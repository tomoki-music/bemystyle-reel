// 本編BGMの実ファイル検証・音声処理（実際のffmpegで合成の音声を処理して測る）。ffmpegが無い環境ではスキップする。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, mkdirSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { createHash } from 'crypto'
import dotenv from 'dotenv'
import { inspectMainBgm, scanMp3Files, listMainBgmCandidates, resolveMainBgmId, prepareMainBgm, measureMainBgmLevels } from './mainBgmAssets.mjs'
import { renderCompositionToFile, resolveCompositionAssets } from './compositionRender.mjs'
import { resolveCompositionConfig, planTimeline } from './finalComposition.mjs'
import { readWavPcm16Mono, computeFrameDb } from './silenceDetector.mjs'
import { buildMainBgmFilters, buildMainBgmStemArgs, buildLoopUnitArgs, planBgmLoop, planBgmGain, resolveMainBgmConfig, summarizeVoiceBgmGap, meanEnergyDb, MAIN_BGM_LIMITER, MAIN_BGM_GAP_TARGET } from './mainBgm.mjs'

dotenv.config({ path: resolve(process.cwd(), '.env'), quiet: true }) // vitest の cwd は editor/
const FF = process.env.FFMPEG_BIN
const canRun = Boolean(FF && process.env.FFPROBE_BIN)
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const ff = (args) => execFileSync(FF, ['-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 })
const SR = 48000

let root
let tmp
const P = (n) => join(root, n)
const pcmF32 = (file, ss = null, dur = null) => {
  const b = execFileSync(FF, ['-v', 'error', ...(ss !== null ? ['-ss', String(ss), '-t', String(dur)] : []), '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 29 })
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}
// ピークはステレオのまま（各チャンネル）で測る。モノラルへのダウンミックスは同相の信号を +3dB にしてしまう
const peakStereo = (file) => {
  const b = execFileSync(FF, ['-v', 'error', '-i', file, '-vn', '-ac', '2', '-ar', String(SR), '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 29 })
  return peak(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)))
}
const peak = (x) => { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); return p }
const rmsDb = (x) => { let s = 0; for (const v of x) s += v * v; const r = Math.sqrt(s / Math.max(1, x.length)); return r > 0 ? 20 * Math.log10(r) : -120 }

// 合成の「音楽」: 和音+ゆっくりしたトレモロ+ピンクノイズ。合成の「声」: 1秒周期で0.6秒だけ鳴るトーン（1.5秒の間を1回含む）
const music = (out, secs) => ff(['-f', 'lavfi', '-i', `sine=f=220:d=${secs}`, '-f', 'lavfi', '-i', `sine=f=277.18:d=${secs}`, '-f', 'lavfi', '-i', `anoisesrc=d=${secs}:c=pink:a=0.05`, '-filter_complex', '[0][1][2]amix=inputs=3:normalize=0,tremolo=f=1.5:d=0.4,aformat=channel_layouts=stereo,volume=0.6', '-c:a', 'libmp3lame', '-b:a', '192k', out])
const voice = (out, secs, amp = 0.35) => ff(['-f', 'lavfi', '-i', `sine=f=400:d=${secs}:r=48000`, '-af', `volume='${amp}*if(lt(mod(t,1),0.6),1,0)*if(between(t,10,11.5),0,1)':eval=frame,aformat=channel_layouts=stereo`, '-c:a', 'pcm_f32le', out])

describe.skipIf(!canRun)('本編BGM: 実ファイルの検証・音声処理', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'lcv-main-bgm-test-'))
    tmp = join(root, 'work')
    mkdirSync(tmp)
    music(P('short.mp3'), 20)
    music(P('UPPER.MP3'), 20)
    music(P('long.mp3'), 90)
    voice(P('voice.wav'), 40)
    writeFileSync(P('notmp3.mp3'), 'not an mp3')
    ff(['-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=10:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', P('video.mp4')])
    writeFileSync(P('videoonly.mp3'), readFileSync(P('video.mp4')))
    writeFileSync(P('truncated.mp3'), readFileSync(P('short.mp3')).subarray(0, 200))
    ff(['-f', 'lavfi', '-i', 'sine=d=1', P('a.wav')])
    writeFileSync(P('wavas.mp3'), readFileSync(P('a.wav')))
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  describe('MP3の検証', () => {
    it('実MP3（大文字拡張子を含む）: 音声ストリーム・duration・sample rate・channelsを取得する。絶対パスは返さない', async () => {
      const a = await inspectMainBgm(P('short.mp3'), [root])
      expect(a).toMatchObject({ ok: true, fileName: 'short.mp3', channels: 2, sampleRate: 48000 })
      expect(a.durationSec).toBeCloseTo(20, 0)
      const b = await inspectMainBgm(P('UPPER.MP3'), [root])
      expect(b.ok).toBe(true)
    })
    it('壊れたファイル・MP3ではない中身・映像のみ・切り詰め・存在しない・許可ルート外を拒否する。エラーに絶対パスを含めない', async () => {
      for (const n of ['notmp3.mp3', 'videoonly.mp3', 'truncated.mp3', 'wavas.mp3', 'missing.mp3']) {
        const r = await inspectMainBgm(P(n), [root])
        expect(r.ok, n).toBe(false)
        expect(r.error).not.toContain(root)
      }
      const outside = await inspectMainBgm(P('short.mp3'), [tmpdir() + '/definitely-not-root'])
      expect(outside.ok).toBe(false)
      expect((await inspectMainBgm(null, [root])).ok).toBe(false)
    })
  })

  describe('許可ルート内のMP3の選択（コピー・アップロードしない）', () => {
    it('一覧はファイル名・サイズ・不透明なIDだけ（絶対パスなし）。IDから実パスを解決でき、ルート外へのシンボリックリンクは除外する', () => {
      const outsideDir = mkdtempSync(join(tmpdir(), 'lcv-outside-'))
      try {
        music(join(outsideDir, 'outside.mp3'), 3)
        symlinkSync(join(outsideDir, 'outside.mp3'), P('link-outside.mp3'))
        const list = listMainBgmCandidates([root])
        expect(list.map((f) => f.fileName)).toEqual(expect.arrayContaining(['short.mp3', 'UPPER.MP3', 'long.mp3']))
        expect(list.map((f) => f.fileName)).not.toContain('link-outside.mp3')
        expect(JSON.stringify(list)).not.toContain(root)
        expect(list.every((f) => /^[0-9a-f]{16}$/.test(f.id))).toBe(true)
        const id = list.find((f) => f.fileName === 'short.mp3').id
        expect(resolveMainBgmId(id, [root])).toBe(scanMp3Files([root]).find((f) => f.id === id).realPath)
        expect(resolveMainBgmId('0000000000000000', [root])).toBeNull()
        expect(resolveMainBgmId('../../etc/passwd', [root])).toBeNull()
      } finally {
        rmSync(join(root, 'link-outside.mp3'), { force: true })
        rmSync(outsideDir, { recursive: true, force: true })
      }
    })
  })

  describe('ラウドネス測定・ゲイン・ループ単位（一時ファイルの削除・元MP3不変）', () => {
    it('短いMP3はループ単位のWAVを一時フォルダへ作る。元MP3は変更しない。長いMP3はループしない', async () => {
      const before = sha(P('short.mp3'))
      const mtime = statSync(P('short.mp3')).mtimeMs
      const cfg = resolveCompositionConfig({ mainBgm: { enabled: true, sourcePath: P('short.mp3') } })
      const items = [{ kind: 'seg', srcStartSec: 0, srcEndSec: 40 }]
      const work = mkdtempSync(join(tmp, 'prep-'))
      const r = await prepareMainBgm({ cfg, roots: [root], sourcePath: P('voice.wav'), mainItems: items, mainSec: 40, tmpDir: work })
      expect(r.ok).toBe(true)
      expect(r.prep.plan).toMatchObject({ needsLoop: true, loops: 3, crossfadeSec: 2 })
      expect(existsSync(r.prep.loopUnitPath)).toBe(true)
      expect(r.prep.info.fileName).toBe('short.mp3')
      expect(JSON.stringify(r.prep.info)).not.toContain(root)
      // 声（合成トーン −30dB・発話中）とBGMの実測から、ダッキング前の差が目標になるゲイン
      expect(r.prep.gain.preDuckGapDb).toBeCloseTo(MAIN_BGM_GAP_TARGET.ducking, 1)
      expect(sha(P('short.mp3'))).toBe(before)
      expect(statSync(P('short.mp3')).mtimeMs).toBe(mtime)
      const cfg2 = resolveCompositionConfig({ mainBgm: { enabled: true, sourcePath: P('long.mp3') } })
      const r2 = await prepareMainBgm({ cfg: cfg2, roots: [root], sourcePath: P('voice.wav'), mainItems: items, mainSec: 40, tmpDir: work })
      rmSync(work, { recursive: true, force: true })
      expect(existsSync(work)).toBe(false) // 一時フォルダごと消える
      expect(r2.prep.plan.needsLoop).toBe(false)
      expect(r2.prep.loopUnitPath).toBeNull()
      expect(r2.prep.inputPath).toBe(scanMp3Files([root]).find((f) => f.fileName === 'long.mp3').realPath)
    })
    it('不正なMP3なら準備の時点でエラー（ファイル名だけを含み、絶対パスは含めない）', async () => {
      const cfg = resolveCompositionConfig({ mainBgm: { enabled: true, sourcePath: P('notmp3.mp3') } })
      const r = await prepareMainBgm({ cfg, roots: [root], sourcePath: P('voice.wav'), mainItems: [], mainSec: 40, tmpDir: tmp })
      expect(r.ok).toBe(false)
      expect(readdirSync(tmp).filter((n) => n.startsWith('main-bgm-'))).toEqual([]) // 失敗時にも一時ファイルを作らない
      expect(r.error).not.toContain(root)
    })
  })

  describe('ミックスの音声特性（合成の声・合成のBGM）', () => {
    const L = 40
    const cfgOn = (over = {}) => resolveMainBgmConfig({ enabled: true, ...over })
    let levels
    let unit
    const stems = async (over) => {
      const cfg = cfgOn(over)
      const gain = planBgmGain({ voiceSpeechDb: levels.voiceSpeechDb, bgmDb: levels.bgmDb, volume: cfg.volume, autoGain: true, ducking: cfg.ducking })
      const plan = planBgmLoop({ bgmSec: 20, mainSec: L, loop: true })
      const tag = `${cfg.ducking ? 'd' : 'n'}${cfg.volume}`
      const args = buildMainBgmStemArgs({ voicePath: P('voice.wav'), bgmPath: P('short.mp3'), loopUnitPath: unit, mainSec: L, gainDb: gain.gainDb, plan, cfg, sampleRate: SR, outVoice: P(`v-${tag}.wav`), outBgm: P(`b-${tag}.wav`), outMix: P(`m-${tag}.wav`) }).args
      ff(args)
      const dbs = (f) => computeFrameDb(readWavPcm16Mono(readFileSync(P(f))).samples, 16000, 0.02).db
      return { gain, plan, vdb: dbs(`v-${tag}.wav`), bdb: dbs(`b-${tag}.wav`), mix: pcmF32(P(`m-${tag}.wav`)), mixPath: P(`m-${tag}.wav`) }
    }
    beforeAll(async () => {
      levels = await measureMainBgmLevels({ sourcePath: P('voice.wav'), mainItems: [{ kind: 'seg', srcStartSec: 0, srcEndSec: L }], bgmPath: P('short.mp3') })
      ff(buildLoopUnitArgs({ bgmPath: P('short.mp3'), outPath: P('unit.wav'), bgmSec: 20, crossfadeSec: 2, sampleRate: SR }).args)
      unit = P('unit.wav')
    })

    it('声とBGMの差: ダッキングONで、発話中の平均が18dB以上・最小でも8dB以上、下位5%点は12dB以上（400msウィンドウ）。実際の声での値（平均21.5・最小10.8）は machinery/verify の実測で確認する', async () => {
      const s = await stems({ ducking: true })
      const gap = summarizeVoiceBgmGap(s.vdb, s.bdb, -45)
      expect(gap.windows).toBeGreaterThan(20)
      expect(gap.meanGapDb).toBeGreaterThanOrEqual(18)
      expect(gap.meanGapDb).toBeLessThanOrEqual(30) // 合成の声（一定音量のトーン）はダッキングが深く効く。実際の声での値は machinery の実測で確認する
      expect(gap.minGapDb).toBeGreaterThanOrEqual(8) // 一定音量の合成の声でも、BGM（音楽）自身の拍の揺れで最小は下がる。最小12dB以上と平均18〜20dBは同時に満たせない（MAIN_BGM_GAP_TARGET の説明）
      expect(gap.p5GapDb).toBeGreaterThanOrEqual(12)
    })
    it('ダッキング: 発話中はBGMが下がり、1.5秒の間ではBGMが戻る（戻りは声の有無に連動。ダッキングOFFでは変化しない）', async () => {
      const on = await stems({ ducking: true })
      const off = await stems({ ducking: false })
      const at = (db, a, b) => meanEnergyDb(db.slice(Math.round(a / 0.02), Math.round(b / 0.02)))
      // 声が鳴っている 4.2〜4.8秒 と、1.5秒の間の終わり付近 11.2〜11.5秒
      const speech = at(on.bdb, 4.2, 4.8)
      const pause = at(on.bdb, 11.2, 11.5)
      expect(pause - speech).toBeGreaterThan(2) // 間ではBGMが戻る
      const offDiff = at(off.bdb, 11.2, 11.5) - at(off.bdb, 4.2, 4.8)
      expect(Math.abs(offDiff)).toBeLessThan(1.5) // ダッキングOFFは（音楽自身の揺れ以外）変化しない
      // ポンピングしない: 0.4秒の短い間（鳴っていない）ではBGMの上下が小さい（release 900ms）
      const shortPause = at(on.bdb, 5.7, 5.95) - at(on.bdb, 5.2, 5.5)
      expect(Math.abs(shortPause)).toBeLessThan(3)
    })
    it('クリッピング防止: 大きな声と大きなBGMでも、最終ミックスのピークは -1dBFS（0.891）付近以下', async () => {
      ff(['-f', 'lavfi', '-i', 'sine=f=300:d=10:r=48000', '-af', 'volume=10,aformat=channel_layouts=stereo', '-c:a', 'pcm_f32le', P('loudvoice.wav')])
      const plan = planBgmLoop({ bgmSec: 20, mainSec: 10, loop: true })
      const g = buildMainBgmFilters({ bgmInputIndex: 1, mainSec: 10, gainDb: 0, plan, cfg: cfgOn({ ducking: false }), sampleRate: SR, voiceLabel: '[vin]', outLabel: '[o]' })
      ff(['-i', P('loudvoice.wav'), '-i', P('short.mp3'), '-filter_complex', ['[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:10,asetpts=PTS-STARTPTS[vin]', ...g].join(';'), '-map', '[o]', '-c:a', 'pcm_f32le', P('loudmix.wav')])
      expect(peakStereo(P('loudmix.wav'))).toBeLessThanOrEqual(MAIN_BGM_LIMITER.limit + 0.02)
      // 制限しなければ超える入力であること（テストの前提）
      ff(['-i', P('loudvoice.wav'), '-i', P('short.mp3'), '-filter_complex', '[0:a]aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:10[v];[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:10[b];[v][b]amix=inputs=2:duration=first:normalize=0[o]', '-map', '[o]', '-c:a', 'pcm_f32le', P('unlimited.wav')])
      expect(peakStereo(P('unlimited.wav'))).toBeGreaterThan(0.75)
      // 通常のミックス（標準音量）はピークに十分な余裕がある
      const normal = await stems({ ducking: true })
      expect(peakStereo(normal.mixPath)).toBeLessThan(0.891)
    })
    it('ループ境界: クリックが出ない（境界前後の最大サンプル差が通常範囲）・ループごとに音量が変わらない・元の長さは本編の長さ', async () => {
      const gain = -30
      const plan = planBgmLoop({ bgmSec: 20, mainSec: 58, loop: true })
      const g = buildMainBgmFilters({ bgmInputIndex: 1, mainSec: 58, gainDb: gain, plan, cfg: cfgOn({ ducking: false }), sampleRate: SR, voiceLabel: '[vin]', outLabel: '[o]' })
      ff(['-f', 'lavfi', '-i', `anullsrc=r=${SR}:cl=stereo`, '-stream_loop', '-1', '-i', unit, '-filter_complex', ['[0:a]atrim=0:58,asetpts=PTS-STARTPTS[vin]', ...g].join(';'), '-map', '[o]', '-c:a', 'pcm_f32le', P('loop.wav')])
      const x = pcmF32(P('loop.wav'))
      expect(x.length / SR).toBeCloseTo(58, 2) // 本編の長さで正確に切る
      const unitSec = plan.unitSec // 18秒
      let maxElsewhere = 0
      for (let i = SR * 5; i < SR * 17; i++) maxElsewhere = Math.max(maxElsewhere, Math.abs(x[i] - x[i - 1]))
      for (let k = 1; k * unitSec < 55; k++) {
        const at = Math.round(k * unitSec * SR)
        let m = 0
        for (let i = at - 240; i < at + 240; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]))
        expect(m).toBeLessThanOrEqual(maxElsewhere * 1.5 + 1e-4)
        expect(Math.abs(rmsDb(x.subarray(at - 4800, at)) - rmsDb(x.subarray(at, at + 4800)))).toBeLessThan(1.5)
      }
      const l1 = rmsDb(x.subarray(3 * SR, 13 * SR))
      const l2 = rmsDb(x.subarray(Math.round((unitSec + 3) * SR), Math.round((unitSec + 13) * SR)))
      expect(Math.abs(l1 - l2)).toBeLessThan(1)
    })
    it('フェード: 冒頭は無音から立ち上がり、本編終了で無音になる。長いMP3は本編の長さで切って自然にフェードアウト', async () => {
      const plan = planBgmLoop({ bgmSec: 90, mainSec: 30, loop: true })
      expect(plan.needsLoop).toBe(false)
      const g = buildMainBgmFilters({ bgmInputIndex: 1, mainSec: 30, gainDb: -30, plan, cfg: cfgOn({ ducking: false }), sampleRate: SR, voiceLabel: '[vin]', outLabel: '[o]' })
      ff(['-f', 'lavfi', '-i', `anullsrc=r=${SR}:cl=stereo`, '-i', P('long.mp3'), '-filter_complex', ['[0:a]atrim=0:30,asetpts=PTS-STARTPTS[vin]', ...g].join(';'), '-map', '[o]', '-c:a', 'pcm_f32le', P('fade.wav')])
      const x = pcmF32(P('fade.wav'))
      expect(x.length / SR).toBeCloseTo(30, 2)
      expect(peak(x.subarray(0, 24))).toBeLessThan(1e-4) // 冒頭は無音から
      expect(rmsDb(x.subarray(0, Math.round(0.1 * SR)))).toBeLessThan(rmsDb(x.subarray(Math.round(1.4 * SR), Math.round(1.6 * SR))) - 15) // フェードイン
      const beforeFade = rmsDb(x.subarray(Math.round(26.9 * SR), Math.round(27.1 * SR)))
      expect(rmsDb(x.subarray(Math.round(29.8 * SR)))).toBeLessThan(beforeFade - 20) // フェードアウト
      expect(peak(x.subarray(x.length - 48))).toBeLessThan(1e-3) // 本編終了で切れる
    })
  })

  describe('3区間の合成（ダイジェスト → 本編 → 末尾LINE案内）', () => {
    const W = 320
    const H = 180
    const ASS = '[Script Info]\nScriptType: v4.00+\nPlayResX: 320\nPlayResY: 180\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: N,Arial,10,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
    let cfgFor
    let tlFor
    const clips = [{ srcStartSec: 1, durationSec: 2, firstIndex: 0, lastIndex: 0 }, { srcStartSec: 5, durationSec: 2, firstIndex: 0, lastIndex: 0 }]
    beforeAll(() => {
      // 合成の元動画: 映像 + 合成の声（-30dB）30秒
      ff(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30000/1001:duration=30', '-i', P('voice.wav'), '-t', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', P('src.mp4')])
      music(P('digest.mp3'), 8)
      cfgFor = (mainBgm) => resolveCompositionConfig({ digest: { bgm: { path: P('digest.mp3') } }, qr: { enabled: false }, lineIntro: { enabled: false }, lineOutro: { durationSec: 4, showQr: false }, ...(mainBgm ? { mainBgm } : {}) })
      tlFor = (cfg) => planTimeline(cfg, { mainStartSec: 0, mainEndSec: 12, digestClips: clips })
    })
    const render = async (name, mainBgm) => {
      const cfg = cfgFor(mainBgm)
      const timeline = tlFor(cfg)
      const assets = await resolveCompositionAssets(cfg, [root])
      expect(assets.ok, assets.errors.join()).toBe(true)
      const finalPath = P(name)
      const r = await renderCompositionToFile({ cfg, timeline, width: W, height: H, sourcePath: P('src.mp4'), mainStartSec: 0, mainEndSec: 12, mainItems: [{ kind: 'seg', srcStartSec: 62 / 30, srcEndSec: 62 / 30 + 12 }], digestClips: clips, bgmPath: assets.bgm.realPath, assText: ASS, tmpDir: tmp, finalPath, mainBgmRequest: { roots: [root] } })
      return { cfg, timeline, finalPath, r }
    }
    it('BGM未指定: 従来どおりレンダーできる（本編BGMなし・追加処理なし）', async () => {
      const a = await render('nobgm.mp4', null)
      expect(existsSync(a.finalPath)).toBe(true)
      expect(a.r.mainBgm).toBeNull()
    })
    it('BGM指定: 本編にだけBGMが入る。ダイジェストは変わらず、末尾LINE案内は無音。本編の長さと全体の長さが計画どおり', async () => {
      const a = await render('withbgm.mp4', { enabled: true, sourcePath: P('short.mp3') })
      const b = P('nobgm.mp4')
      const T = a.timeline
      const main = T.sections.find((s) => s.kind === 'main')
      const outro = T.sections.find((s) => s.kind === 'lineOutro')
      const xa = pcmF32(a.finalPath)
      const xb = pcmF32(b)
      expect(xa.length / SR).toBeCloseTo(T.totalSec, 1)
      // ダイジェスト区間は、本編BGMなしと同じ（ダイジェストBGMは従来どおり。本編BGMと重ならない）。境界の手前0.5秒はAACの符号化フレームが本編側とまたがるため比べない
      let dDiff = 0
      for (let i = Math.round(0.15 * SR); i < Math.round((T.digestSec - 0.5) * SR); i++) dDiff = Math.max(dDiff, Math.abs(xa[i] - xb[i]))
      expect(dDiff).toBeLessThan(2e-3)
      // 本編区間はBGMのぶん違う
      let mDiff = 0
      for (let i = Math.round((main.startSec + 2) * SR); i < Math.round((main.endSec - 2) * SR); i++) mDiff += Math.abs(xa[i] - xb[i])
      expect(mDiff / (SR * 8)).toBeGreaterThan(1e-5)
      // 末尾LINE案内へ漏れない（無音）
      expect(peak(xa.subarray(Math.round((outro.startSec + 0.1) * SR)))).toBeLessThan(1e-4)
      // 本編終了直前は、BGMがフェードアウトして無音に近い（ブツ切れにならない）
      const tail = xa.subarray(Math.round((main.endSec - 0.3) * SR), Math.round(main.endSec * SR))
      const tailB = xb.subarray(Math.round((main.endSec - 0.3) * SR), Math.round(main.endSec * SR))
      let tDiff = 0
      for (let i = 0; i < tail.length; i++) tDiff = Math.max(tDiff, Math.abs(tail[i] - tailB[i]))
      expect(tDiff).toBeLessThan(5e-3)
      expect(a.r.mainBgm.plan.needsLoop).toBe(false) // 20秒のMP3は本編（12秒）より長いので、ループせず本編の長さで切る
    })
    it('一時ファイル（ループ単位のWAV・レンダー中の隠しファイル）は成功後に残らない', async () => {
      const leftovers = [...readdirSync(tmp), ...readdirSync(root)].filter((n) => n.startsWith('main-bgm-') || n.startsWith('.rendering-'))
      expect(leftovers).toEqual([])
    })
    it('短いMP3のループも本編で使われ（ループ単位は一時フォルダ）、失敗時も一時フォルダを残さない。既存の動画は上書きしない', async () => {
      ff(['-f', 'lavfi', '-i', 'sine=f=330:d=5', '-c:a', 'libmp3lame', P('tiny.mp3')])
      const a = await render('looped.mp4', { enabled: true, sourcePath: P('tiny.mp3') })
      expect(a.r.mainBgm.plan).toMatchObject({ needsLoop: true })
      expect(a.r.mainBgm.plan.loops).toBeGreaterThanOrEqual(3)
      expect(readdirSync(tmp).filter((n) => n.startsWith('main-bgm-'))).toEqual([])
      const before = sha(P('withbgm.mp4'))
      await expect(render('withbgm.mp4', { enabled: true, sourcePath: P('short.mp3') })).rejects.toThrow(/既に/)
      expect(sha(P('withbgm.mp4'))).toBe(before) // 既存動画は上書きされない
      await expect(render('bad.mp4', { enabled: true, sourcePath: P('notmp3.mp3') })).rejects.toThrow()
      expect(existsSync(P('bad.mp4'))).toBe(false)
      expect(readdirSync(tmp).filter((n) => n.startsWith('main-bgm-'))).toEqual([])
      // ONで素材が見つからないときは、レンダー開始前に明確なエラー
      const cfg = cfgFor({ enabled: true, sourcePath: P('missing.mp3') })
      const assets = await resolveCompositionAssets(cfg, [root])
      expect(assets.ok).toBe(false)
      expect(assets.errors.join()).toContain('本編BGMのMP3が見つかりません')
      expect(assets.errors.join()).not.toContain(root)
    })
  })
})
