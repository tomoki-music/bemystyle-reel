// ループ開始点の選定・準備（実際のffmpegで合成のMP3を処理して測る）。ffmpegが無い環境ではスキップする。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { createHash } from 'crypto'
import dotenv from 'dotenv'
import { selectLoopStart, prepareMainBgm, LOOP_BOUNDARY_LIMITS } from './mainBgmAssets.mjs'
import { resolveCompositionConfig } from './finalComposition.mjs'
import { MAIN_BGM_LIMITS } from './mainBgm.mjs'

dotenv.config({ path: resolve(process.cwd(), '.env'), quiet: true })
const FF = process.env.FFMPEG_BIN
const canRun = Boolean(FF && process.env.FFPROBE_BIN)
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const ff = (args) => execFileSync(FF, ['-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 })

let root
let tmp
const P = (n) => join(root, n)
// 合成の曲: 2Hzの拍（トレモロ）＋和音。先頭6秒は小さい音から立ち上がる（曲頭の静かな部分）。長さ 90秒
const songMp3 = (out) => ff(['-f', 'lavfi', '-i', 'sine=f=220:d=90', '-f', 'lavfi', '-i', 'sine=f=277.18:d=90', '-f', 'lavfi', '-i', 'anoisesrc=d=90:c=pink:a=0.03', '-filter_complex', '[0][1][2]amix=inputs=3:normalize=0,tremolo=f=2:d=0.8,afade=t=in:st=0:d=6,aformat=channel_layouts=stereo,volume=0.6', '-c:a', 'libmp3lame', '-b:a', '192k', out])

describe.skipIf(!canRun)('本編BGM: ループ開始点の選定（実MP3）', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'lcv-loop-test-'))
    tmp = join(root, 'work')
    mkdirSync(tmp)
    songMp3(P('song.mp3'))
    ff(['-f', 'lavfi', '-i', 'sine=f=400:d=60:r=48000', '-af', "volume='0.3*if(lt(mod(t,1),0.6),1,0)':eval=frame,aformat=channel_layouts=stereo", '-c:a', 'pcm_f32le', P('voice.wav')])
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('4秒以降の候補を比べて選ぶ。曲頭の静かな部分（0〜6秒）にかかる開始点は選ばず、境界の音量差1.5dB以内・クリックなし。ループ単位は一時フォルダへ、元MP3は不変', async () => {
    const before = sha(P('song.mp3'))
    const mtime = statSync(P('song.mp3')).mtimeMs
    const r = await selectLoopStart({ bgmPath: P('song.mp3'), durationSec: 90, tmpDir: tmp, crossfadeSec: 2 })
    expect(r).toBeTruthy()
    expect(r.startSec).toBeGreaterThanOrEqual(4)
    expect(r.startSec).toBeGreaterThanOrEqual(7) // [開始点−2秒, 開始点] が曲頭の小さい音にかからない
    expect(r.candidates.length).toBeGreaterThanOrEqual(2) // 複数候補を比べた
    expect(r.searched).toBeGreaterThan(1000)
    expect(r.allMeetCriteria).toBe(true)
    const chosen = r.candidates.find((c) => c.startSec === r.startSec)
    expect(chosen.levelDiffDb).toBeLessThanOrEqual(LOOP_BOUNDARY_LIMITS.levelDiffDb)
    expect(chosen.level500msDiffDb).toBeLessThanOrEqual(LOOP_BOUNDARY_LIMITS.levelDiffDb)
    expect(chosen.dipDb).toBeGreaterThanOrEqual(-LOOP_BOUNDARY_LIMITS.dipDb)
    expect(chosen.maxStepRatio).toBeLessThanOrEqual(LOOP_BOUNDARY_LIMITS.maxStepRatio)
    // 基準を満たす候補のうち、スコアが最も高い
    expect(Math.max(...r.candidates.filter((c) => c.meets).map((c) => c.score))).toBe(chosen.score)
    expect(existsSync(r.unitPath)).toBe(true)
    expect(r.unitPath.startsWith(tmp)).toBe(true)
    expect(sha(P('song.mp3'))).toBe(before)
    expect(statSync(P('song.mp3')).mtimeMs).toBe(mtime)
  })
  it('準備: 最終版（本編916秒）の長さでループを計画し、確認動画の長さ（45秒）では流さない。ゲインはループ部分のラウドネスで決め、一時ファイルは一時フォルダごと消える', async () => {
    const cfg = resolveCompositionConfig({ mainBgm: { enabled: true, sourcePath: P('song.mp3') } })
    const work = mkdtempSync(join(tmp, 'prep-'))
    const r = await prepareMainBgm({ cfg, roots: [root], sourcePath: P('voice.wav'), mainItems: [{ kind: 'seg', srcStartSec: 0, srcEndSec: 30 }], levelItems: [{ kind: 'seg', srcStartSec: 0, srcEndSec: 60 }], mainSec: 30, planMainSec: 916.6, tmpDir: work })
    expect(r.ok).toBe(true)
    expect(r.prep.sourcePlan).toMatchObject({ needsLoop: true, loopStartSec: r.prep.loopSelection.startSec, introSec: r.prep.loopSelection.startSec })
    expect(r.prep.sourcePlan.unitSec).toBeCloseTo(r.prep.info.durationSec - r.prep.loopSelection.startSec, 2)
    expect(r.prep.plan.needsLoop).toBe(false) // 実際に流す長さ（30秒）は曲より短い
    expect(r.prep.gain.preDuckGapDb).toBeGreaterThanOrEqual(MAIN_BGM_LIMITS.minGapDb)
    expect(existsSync(r.prep.loopUnitPath)).toBe(true)
    expect(readdirSync(work).some((n) => n.startsWith('loop-cand-'))).toBe(true) // 候補のループ単位は渡された一時フォルダの中に作られる
    rmSync(work, { recursive: true, force: true })
    expect(existsSync(work)).toBe(false)
  })
  it('曲が短くて4秒以降の候補が取れないときは、従来のループ（曲頭へ戻る）に戻る', async () => {
    ff(['-f', 'lavfi', '-i', 'sine=f=220:d=12', '-c:a', 'libmp3lame', P('tiny.mp3')])
    const cfg = resolveCompositionConfig({ mainBgm: { enabled: true, sourcePath: P('tiny.mp3') } })
    const work = mkdtempSync(join(tmp, 'prep2-'))
    const r = await prepareMainBgm({ cfg, roots: [root], sourcePath: P('voice.wav'), mainItems: [{ kind: 'seg', srcStartSec: 0, srcEndSec: 30 }], mainSec: 30, tmpDir: work })
    expect(r.ok).toBe(true)
    expect(r.prep.plan).toMatchObject({ needsLoop: true, loopStartSec: 0, introSec: 0 })
    expect(r.prep.loopSelection).toBeNull()
    expect(existsSync(r.prep.loopUnitPath)).toBe(true)
  })
})
