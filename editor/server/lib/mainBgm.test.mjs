import { describe, it, expect } from 'vitest'
import {
  MAIN_BGM_DEFAULTS, MAIN_BGM_LIMITS, MAIN_BGM_DUCK, MAIN_BGM_GAP_TARGET, resolveMainBgmConfig, sanitizeMainBgmOverrides, validateMainBgmConfig, parseMp3Probe,
  planBgmGain, planBgmLoop, buildLoopUnitArgs, buildMainBgmFilters, meanEnergyDb, summarizeVoiceBgmGap, linearToDb,
} from './mainBgm.mjs'
import { resolveCompositionConfig, validateCompositionConfig, planTimeline, buildCompositionArgs, COMPOSITION_DEFAULTS } from './finalComposition.mjs'

const probe = (over = {}) => ({ streams: [{ codec_type: 'audio', codec_name: 'mp3', sample_rate: '44100', channels: 2, duration: '63.9' }], format: { format_name: 'mp3', duration: '63.9', bit_rate: '192000' }, ...over })

describe('本編BGMの設定', () => {
  it('既定: 素材未指定・OFF（従来どおり本編BGMなし）。ダッキングON・ループON・フェード 1.5/2.5秒・音量0.05（確認動画でBGMが小さすぎたため 0.03 から上げた。許可範囲 0.035〜0.05・UI上限 0.06）・適用範囲は本編のみ', () => {
    expect(MAIN_BGM_DEFAULTS).toMatchObject({ enabled: false, sourcePath: null, volume: 0.05, autoGain: true, ducking: true, loop: true, fadeInSec: 1.5, fadeOutSec: 2.5, scope: 'main' })
    expect(COMPOSITION_DEFAULTS.mainBgm.enabled).toBe(false)
    expect(resolveCompositionConfig({}).mainBgm.enabled).toBe(false)
  })
  it('UIの上書きは許可した項目だけ受け付ける（絶対パス・未知のキー・不正な型は捨てる）', () => {
    const o = sanitizeMainBgmOverrides({ enabled: true, sourcePath: '/etc/passwd', volume: 0.05, ducking: false, loop: 'yes', fadeInSec: 2, scope: 'all', extra: 1 })
    expect(o).toEqual({ enabled: true, volume: 0.05, ducking: false, fadeInSec: 2 })
  })
  it('音量・フェードの範囲を検証する（音量の上限 0.06 = 標準の1.2倍）', () => {
    expect(validateMainBgmConfig(resolveMainBgmConfig({ volume: MAIN_BGM_LIMITS.volumeMax })).ok).toBe(true)
    expect(validateMainBgmConfig(resolveMainBgmConfig({ volume: 0.1 })).ok).toBe(false)
    expect(validateMainBgmConfig(resolveMainBgmConfig({ volume: -1 })).ok).toBe(false)
    expect(validateMainBgmConfig(resolveMainBgmConfig({ fadeOutSec: 30 })).ok).toBe(false)
    expect(validateMainBgmConfig(resolveMainBgmConfig({ scope: 'all' })).ok).toBe(false)
  })
  it('構成の検証は、本編BGMがONのときだけ本編BGMの設定を見る', () => {
    expect(validateCompositionConfig(resolveCompositionConfig({ mainBgm: { volume: 9 } })).ok).toBe(true) // OFFなら無視
    expect(validateCompositionConfig(resolveCompositionConfig({ mainBgm: { enabled: true, volume: 9 } })).ok).toBe(false)
  })
})

describe('MP3の実データ検証（ffprobeの結果）', () => {
  it('音声ストリーム・コーデックmp3・durationがあれば有効。duration・sample rate・channelsを返す', () => {
    expect(parseMp3Probe(probe(), 'a.mp3')).toMatchObject({ ok: true, durationSec: 63.9, sampleRate: 44100, channels: 2, codec: 'mp3' })
    expect(parseMp3Probe(probe(), 'A.MP3').ok).toBe(true) // 大文字小文字不問
  })
  it('拡張子が.mp3でない・映像のみ・音声なし・MP3以外の中身・duration不明・壊れた情報は拒否する（拡張子だけを信用しない）', () => {
    expect(parseMp3Probe(probe(), 'a.wav').ok).toBe(false)
    expect(parseMp3Probe({ streams: [{ codec_type: 'video', codec_name: 'h264' }], format: { format_name: 'mov,mp4', duration: '10' } }, 'a.mp3')).toMatchObject({ ok: false, error: expect.stringContaining('映像のみ') })
    expect(parseMp3Probe({ streams: [], format: {} }, 'a.mp3').ok).toBe(false)
    expect(parseMp3Probe(probe({ streams: [{ codec_type: 'audio', codec_name: 'pcm_s16le', sample_rate: '44100', channels: 1 }], format: { format_name: 'wav', duration: '5' } }), 'a.mp3').ok).toBe(false)
    expect(parseMp3Probe(probe({ format: { format_name: 'mp3', duration: 'N/A' } }), 'a.mp3').ok).toBe(false)
    expect(parseMp3Probe(probe({ format: { format_name: 'mp3', duration: '0' } }), 'a.mp3').ok).toBe(false)
    expect(parseMp3Probe(null, 'a.mp3').ok).toBe(false)
  })
})

describe('自動ゲイン（声とBGMの音量差）', () => {
  const base = { voiceSpeechDb: -32, bgmDb: -50, autoGain: true, ducking: true } // 音源が声より小さいときも、大きいときも同じ相対レベルになる（下のテスト）
  it('標準音量では、声とBGM（ダッキング前）の差が目標（ダッキングON 15.6dB / OFF 21.6dB）になるゲインを返す', () => {
    const on = planBgmGain({ ...base, volume: MAIN_BGM_LIMITS.presetVolume })
    expect(-50 + on.gainDb).toBeCloseTo(-32 - MAIN_BGM_GAP_TARGET.ducking, 2) // BGM = 声 − 目標差
    expect(on.preDuckGapDb).toBeCloseTo(MAIN_BGM_GAP_TARGET.ducking, 3)
    const off = planBgmGain({ ...base, ducking: false, volume: MAIN_BGM_LIMITS.presetVolume })
    expect(off.preDuckGapDb).toBeCloseTo(MAIN_BGM_GAP_TARGET.noDucking, 3)
  })
  it('音源の音量が違っても、BGMは同じ相対レベルになる（入力音源のラウドネスを測って決める）', () => {
    for (const bgmDb of [-6, -14, -24, -35]) {
      const p = planBgmGain({ ...base, bgmDb, volume: MAIN_BGM_LIMITS.presetVolume })
      expect(bgmDb + p.gainDb).toBeCloseTo(base.voiceSpeechDb - MAIN_BGM_GAP_TARGET.ducking, 2)
    }
  })
  it('ユーザー音量は標準(0.05)に対する倍率。上げると大きく、下げると小さくなる', () => {
    const a = planBgmGain({ ...base, volume: MAIN_BGM_LIMITS.presetVolume }).gainDb
    expect(planBgmGain({ ...base, bgmDb: -60, volume: 0.06 }).gainDb - planBgmGain({ ...base, bgmDb: -60, volume: 0.05 }).gainDb).toBeCloseTo(linearToDb(1.2), 1)
    expect(planBgmGain({ ...base, volume: 0.025 }).gainDb - a).toBeCloseTo(linearToDb(0.5), 2)
    expect(planBgmGain({ ...base, volume: 0 })).toMatchObject({ muted: true, gainDb: -120 })
  })
  it('安全な上限: 音量を最大にしても、声とBGM（ダッキング前）の差は12dBを下回らない。上限を超える指定は上限へ丸める', () => {
    const p = planBgmGain({ ...base, volume: MAIN_BGM_LIMITS.volumeMax })
    expect(p.preDuckGapDb).toBeGreaterThanOrEqual(MAIN_BGM_LIMITS.minGapDb - 1e-6)
    const q = planBgmGain({ ...base, volume: 5 })
    expect(q.volume).toBe(MAIN_BGM_LIMITS.volumeMax)
    expect(q.preDuckGapDb).toBeGreaterThanOrEqual(MAIN_BGM_LIMITS.minGapDb - 1e-6)
    // 極端に大きい音量でclampされる
    const loud = planBgmGain({ voiceSpeechDb: -32, bgmDb: -14, volume: 0.06, autoGain: false, ducking: false })
    expect(loud.preDuckGapDb).toBeGreaterThanOrEqual(MAIN_BGM_LIMITS.minGapDb - 1e-6)
  })
  it('autoGainなしは、音量を素材への線形ゲインとして使う（上限clampあり）', () => {
    const p = planBgmGain({ voiceSpeechDb: -32, bgmDb: -50, volume: 0.05, autoGain: false, ducking: true })
    expect(p.gainDb).toBeCloseTo(linearToDb(0.05), 2)
  })
  it('meanEnergyDb: 閾値以下のフレーム（無音）は平均に含めない', () => {
    expect(meanEnergyDb([-20, -20, -90, -90], -60)).toBeCloseTo(-20, 3)
    expect(meanEnergyDb([-90, -95], -60)).toBe(-120)
  })
  it('声とBGMの差の集計: 発話中のウィンドウだけを数える。平均・最小・下位5%', () => {
    const voice = [...Array(40).fill(-30), ...Array(40).fill(-70)]
    const bgm = [...Array(40).fill(-50), ...Array(40).fill(-52)]
    const s = summarizeVoiceBgmGap(voice, bgm, -45)
    expect(s.windows).toBe(2)
    expect(s.meanGapDb).toBeCloseTo(20, 1)
    expect(s.minGapDb).toBeCloseTo(20, 1)
  })
})

describe('ループの計画', () => {
  it('MP3が本編より長い: ループせず本編の長さで切る（本編終了で正確に切る）', () => {
    expect(planBgmLoop({ bgmSec: 200, mainSec: 120, loop: true })).toMatchObject({ needsLoop: false, playSec: 120, ok: true })
    expect(planBgmLoop({ bgmSec: 120, mainSec: 120, loop: true })).toMatchObject({ needsLoop: false, playSec: 120 })
  })
  it('MP3が本編より短い: ループ単位（長さ−クロスフェード）を繰り返す。必要な回数は本編を覆う最小の回数', () => {
    const p = planBgmLoop({ bgmSec: 60, mainSec: 916.6, loop: true })
    expect(p).toMatchObject({ needsLoop: true, crossfadeSec: 2, unitSec: 58, ok: true })
    expect(p.loops).toBe(Math.ceil(916.6 / 58))
    expect(p.playSec).toBeCloseTo(916.6, 3)
  })
  it('ループOFFで短いMP3: 1回だけ再生（本編の途中で終わる）', () => {
    expect(planBgmLoop({ bgmSec: 30, mainSec: 100, loop: false })).toMatchObject({ needsLoop: false, loopEnabled: false, playSec: 30 })
  })
  it('クロスフェードは音源が短いと縮む。短すぎる音源はループ不可', () => {
    expect(planBgmLoop({ bgmSec: 4, mainSec: 100, loop: true }).crossfadeSec).toBe(1)
    expect(planBgmLoop({ bgmSec: 0.8, mainSec: 100, loop: true }).ok).toBe(false)
  })
  it('ループ単位の書き出し引数: 末尾x秒→先頭x秒のクロスフェード、サンプル数を厳密に指定、shellを使わないargv', () => {
    const { args } = buildLoopUnitArgs({ bgmPath: '/in.mp3', outPath: '/out.wav', bgmSec: 24, crossfadeSec: 2, sampleRate: 48000 })
    expect(Array.isArray(args)).toBe(true)
    const g = args[args.indexOf('-filter_complex') + 1]
    expect(g).toContain('acrossfade=d=2:c1=qsin:c2=qsin')
    expect(g).toContain(`atrim=end_sample=${22 * 48000}`)
    expect(args.slice(-1)[0]).toBe('/out.wav')
  })
})

describe('本編のミックス（フィルタ）', () => {
  const cfg = resolveMainBgmConfig({ enabled: true })
  const plan = planBgmLoop({ bgmSec: 60, mainSec: 300, loop: true })
  const chain = (over = {}) => buildMainBgmFilters({ bgmInputIndex: 3, mainSec: 300, gainDb: -22.1, plan, cfg: { ...cfg, ...over }, sampleRate: 48000, voiceLabel: '[mainvoice]', outLabel: '[mainaudio]' }).join(';')
  it('BGMは本編の長さで正確に切り、ゲイン・フェードイン・フェードアウト（本編終了で無音）を適用する', () => {
    const g = chain()
    expect(g).toContain('atrim=0:300')
    expect(g).toContain('volume=-22.1dB')
    expect(g).toContain('afade=t=in:st=0:d=1.5')
    expect(g).toContain('afade=t=out:st=297.5:d=2.5')
    expect(g.endsWith('[mainaudio]')).toBe(true)
  })
  it('ダッキング: 声をサイドチェインにして（声の帯域＋強い圧縮）、ゆっくり動かす（attack 60ms・release 1200ms）', () => {
    const g = chain()
    expect(g).toContain('sidechaincompress')
    expect(g).toContain(`threshold=${MAIN_BGM_DUCK.threshold}`)
    expect(g).toContain(`ratio=${MAIN_BGM_DUCK.ratio}`)
    expect(g).toContain('attack=60')
    expect(g).toContain('release=1200')
    expect(g).toContain('highpass=f=120')
    expect(g).toContain('acompressor')
    expect(MAIN_BGM_DUCK.attack).toBeGreaterThanOrEqual(30) // 速すぎない
    expect(MAIN_BGM_DUCK.release).toBeGreaterThanOrEqual(500) // 短すぎない
  })
  it('ダッキングOFFでは sidechaincompress を使わない', () => {
    expect(chain({ ducking: false })).not.toContain('sidechaincompress')
  })
  it('最終ミックスにリミッター（-1dBFS）を通し、クリッピングを防ぐ。本編の長さで切る', () => {
    const g = chain()
    expect(g).toContain('alimiter=limit=0.891')
    expect(g).toContain('level=0') // 自動レベル補正を切る
    expect(g).toContain('latency=1') // 先読み遅延を補正（トーク音声を遅らせない）
    expect(g).toMatch(/alimiter[^;]*atrim=0:300/)
  })
  it('フェード0秒はフェードフィルタを付けない。フェードが本編より長い場合は本編の長さまで', () => {
    const g = chain({ fadeInSec: 0, fadeOutSec: 0 })
    expect(g).not.toContain('afade')
    const p = planBgmLoop({ bgmSec: 60, mainSec: 3, loop: true })
    const short = buildMainBgmFilters({ bgmInputIndex: 1, mainSec: 3, gainDb: -20, plan: p, cfg, sampleRate: 48000, voiceLabel: '[v]', outLabel: '[o]' }).join(';')
    expect(short).toContain('afade=t=in:st=0:d=1.5')
    expect(short).toContain('afade=t=out:st=0.5:d=2.5')
  })
})

describe('レンダーのffmpeg引数への組み込み（後方互換・範囲）', () => {
  const clips = [{ srcStartSec: 100, durationSec: 5, firstIndex: 0, lastIndex: 0 }, { srcStartSec: 200, durationSec: 5, firstIndex: 0, lastIndex: 0 }]
  const items = [{ kind: 'seg', srcStartSec: 62 / 30, srcEndSec: 62 / 30 + 30 }]
  const mk = (over = {}, extra = {}) => {
    const cfg = resolveCompositionConfig({ digest: { bgm: { path: '/d.mp3' } }, line: { qrPath: '/q.png' }, ...over })
    const timeline = planTimeline(cfg, { mainStartSec: 0, mainEndSec: 30, digestClips: clips })
    return { cfg, timeline, ...buildCompositionArgs({ cfg, timeline, width: 1920, height: 1080, sourcePath: '/src.mp4', mainStartSec: 0, mainEndSec: 30, mainItems: items, digestClips: clips, bgmPath: '/d.mp3', qrPath: '/q.png', qrSize: { width: 554, height: 518 }, assPath: '/a.ass', outputPath: '/o.mp4', ...extra }) }
  }
  const mainBgm = { inputPath: '/main.mp3', plan: planBgmLoop({ bgmSec: 200, mainSec: 30, loop: true }), gainDb: -22 }

  it('本編BGM未指定（OFF）: 従来どおり。本編BGMの入力・フィルタは一切追加されない', () => {
    const off = mk()
    expect(off.args.filter((a) => a === '/main.mp3')).toHaveLength(0)
    expect(off.filterComplex).not.toMatch(/mainvoice|mainaudio|mbgm|alimiter/)
    // 本編BGMの設定キーが無い（旧設定）でも同じ引数になる
    const cfgOld = resolveCompositionConfig({ digest: { bgm: { path: '/d.mp3' } }, line: { qrPath: '/q.png' } })
    delete cfgOld.mainBgm
    const timeline = planTimeline(cfgOld, { mainStartSec: 0, mainEndSec: 30, digestClips: clips })
    const old = buildCompositionArgs({ cfg: cfgOld, timeline, width: 1920, height: 1080, sourcePath: '/src.mp4', mainStartSec: 0, mainEndSec: 30, mainItems: items, digestClips: clips, bgmPath: '/d.mp3', qrPath: '/q.png', qrSize: { width: 554, height: 518 }, assPath: '/a.ass', outputPath: '/o.mp4' })
    expect(old.args).toEqual(off.args)
    expect(old.filterComplex).toBe(off.filterComplex)
  })
  it('本編BGMをONにして素材が無い場合は、レンダー前にエラーで止まる（黙ってBGMなしにしない）', () => {
    expect(() => mk({ mainBgm: { enabled: true } })).toThrow(/本編BGMのMP3が見つかりません/)
  })
  it('本編BGM指定: 本編の音声（[mainvoice]）だけにBGMを重ね、[mainaudio]を全体の連結へ渡す。ダイジェスト・末尾LINE案内のチェーンには入らない', () => {
    const on = mk({ mainBgm: { enabled: true } }, { mainBgm })
    const chains = on.filterComplex.split(';')
    expect(on.filterComplex).toContain('[dvid][dA][mainvid][mainaudio][lov][loa]concat=n=3')
    const bgmChains = chains.filter((c) => /\[mbgm|\[mmix\]|\[mainaudio\]|\[mainvoice\]/.test(c) && !c.includes('concat=n=3'))
    expect(bgmChains.length).toBeGreaterThan(0)
    for (const c of bgmChains) expect(c).not.toMatch(/\[dvid\]|\[dvoice\]|\[dA\]|\[bgm\]|\[bgmd\]|\[lov\]|\[loa\]|\[dv\d|\[da\d/)
    // 入力: 本編BGMはトーク（区間）の後・QRの前に1回だけ。ダイジェストBGMは別の入力
    expect(on.args.filter((a) => a === '/main.mp3')).toHaveLength(1)
    expect(on.args.filter((a) => a === '/d.mp3')).toHaveLength(1)
    // ダイジェストBGMのチェーンは従来と同じ（ダイジェストの長さで切る）
    expect(on.filterComplex).toContain(`atrim=0:${on.timeline.digestSec}`)
  })
  it('ダイジェストBGMと本編BGMは同時に鳴らない: 別々のチェーンで、時間軸（連結）が直列', () => {
    const on = mk({ mainBgm: { enabled: true } }, { mainBgm })
    expect(on.filterComplex.indexOf('[dA]')).toBeLessThan(on.filterComplex.indexOf('[mainaudio]'))
    expect(on.filterComplex).toMatch(/concat=n=3:v=1:a=1\[cv\]\[ca\]/)
  })
  it('末尾LINE案内は無音のパネル（anullsrc）のまま。本編BGMの範囲は本編の長さだけ', () => {
    const on = mk({ mainBgm: { enabled: true } }, { mainBgm })
    expect(on.filterComplex).toMatch(/anullsrc[^;]*\[loa\]/)
    expect(on.filterComplex).toContain('atrim=0:30') // 本編の長さ（30秒）で切る
  })
  it('ループが必要なときは -stream_loop -1 でループ単位（WAV）を入力し、不要なときは元MP3をそのまま入力する', () => {
    const loopPlan = planBgmLoop({ bgmSec: 12, mainSec: 30, loop: true })
    const looped = mk({ mainBgm: { enabled: true } }, { mainBgm: { inputPath: '/unit.wav', plan: loopPlan, gainDb: -22 } })
    const i = looped.args.indexOf('/unit.wav')
    expect(looped.args.slice(i - 3, i + 1)).toEqual(['-stream_loop', '-1', '-i', '/unit.wav'])
    const plain = mk({ mainBgm: { enabled: true } }, { mainBgm })
    expect(plain.args).not.toContain('-stream_loop')
  })
  it('ffmpegへはargv配列で渡し、パスをshell展開しない（args は文字列の配列）', () => {
    const on = mk({ mainBgm: { enabled: true } }, { mainBgm: { ...mainBgm, inputPath: '/tmp/a b;$(rm -rf x).mp3' } })
    expect(on.args.every((a) => typeof a === 'string')).toBe(true)
    expect(on.args).toContain('/tmp/a b;$(rm -rf x).mp3')
    expect(on.filterComplex).not.toContain('rm -rf')
  })
})

describe('本編BGM: 音量・ダッキングの採用値（確認動画でBGMが小さすぎたため調整）', () => {
  it('音量は 0.035〜0.05（目安）の範囲。UI上限 0.06 は維持。標準音量でも声との差の下限（12dB）を割らない', () => {
    expect(MAIN_BGM_DEFAULTS.volume).toBeGreaterThanOrEqual(0.035)
    expect(MAIN_BGM_DEFAULTS.volume).toBeLessThanOrEqual(0.05)
    expect(MAIN_BGM_DEFAULTS.volume).toBeGreaterThan(0.028) // 前回（0.028）より大きい
    expect(MAIN_BGM_LIMITS.volumeMax).toBe(0.06)
    const g = planBgmGain({ voiceSpeechDb: -31.7, bgmDb: -10.3, volume: MAIN_BGM_DEFAULTS.volume, autoGain: true, ducking: true })
    expect(g.preDuckGapDb).toBeGreaterThanOrEqual(MAIN_BGM_LIMITS.minGapDb)
    // 前回設定（volume 0.028・ゲイン -41.088dB）に対して、同じ声・同じ曲でBGMは約4dB大きい
    expect(g.gainDb - -41.088).toBeGreaterThan(3.5)
  })
  it('ダッキングの各値は許可範囲内（threshold 0.015〜0.02 / ratio 4〜6 / attack 40〜80ms / release 700〜1200ms）。knee 6・makeup 1・声の帯域 120〜5000Hz', () => {
    expect(MAIN_BGM_DUCK.threshold).toBeGreaterThanOrEqual(0.015)
    expect(MAIN_BGM_DUCK.threshold).toBeLessThanOrEqual(0.02)
    expect(MAIN_BGM_DUCK.ratio).toBeGreaterThanOrEqual(4)
    expect(MAIN_BGM_DUCK.ratio).toBeLessThanOrEqual(6)
    expect(MAIN_BGM_DUCK.attack).toBeGreaterThanOrEqual(40)
    expect(MAIN_BGM_DUCK.attack).toBeLessThanOrEqual(80)
    expect(MAIN_BGM_DUCK.release).toBeGreaterThanOrEqual(700)
    expect(MAIN_BGM_DUCK.release).toBeLessThanOrEqual(1200)
    expect(MAIN_BGM_DUCK).toMatchObject({ knee: 6, makeup: 1, sidechainHighpassHz: 120, sidechainLowpassHz: 5000 })
  })
  it('ダッキング: 発話開始でBGMがすぐ下がる（attackは短い）が、語尾では戻らない（releaseは長い）。BGMは主役にならない（声との差の下限を維持）', () => {
    expect(MAIN_BGM_DUCK.attack).toBeLessThanOrEqual(80)
    expect(MAIN_BGM_DUCK.release).toBeGreaterThan(MAIN_BGM_DUCK.attack * 10)
    expect(MAIN_BGM_GAP_TARGET.ducking).toBeGreaterThanOrEqual(MAIN_BGM_LIMITS.minGapDb)
  })
})

describe('本編BGM: ループ開始点（1周目は曲の0秒から・2周目以降は開始点から）', () => {
  it('計画: 1周目 = 0〜開始点（introSec）、その後は 開始点〜曲末 の単位を繰り返す。単位の長さ = 曲長 − 開始点', () => {
    const p = planBgmLoop({ bgmSec: 160.056, mainSec: 916.6, loop: true, loopStartSec: 35.41 })
    expect(p).toMatchObject({ ok: true, needsLoop: true, loopStartSec: 35.41, introSec: 35.41, crossfadeSec: 2, unitSec: 124.646, playSec: 916.6 })
    expect(p.loops).toBe(1 + Math.ceil((916.6 - 35.41) / 124.646))
  })
  it('開始点なしは従来どおり（曲頭へ戻る単位。introSec 0）', () => {
    expect(planBgmLoop({ bgmSec: 60, mainSec: 300, loop: true })).toMatchObject({ loopStartSec: 0, introSec: 0, unitSec: 58, crossfadeSec: 2 })
  })
  it('曲が本編より長い・ループOFFなら開始点は使わない。開始点が範囲外なら計画不可', () => {
    expect(planBgmLoop({ bgmSec: 200, mainSec: 120, loop: true, loopStartSec: 35 })).toMatchObject({ needsLoop: false, loopStartSec: 0, introSec: 0 })
    expect(planBgmLoop({ bgmSec: 60, mainSec: 300, loop: true, loopStartSec: 1 }).ok).toBe(false) // 直前にクロスフェード分（2秒）が無い
    expect(planBgmLoop({ bgmSec: 60, mainSec: 300, loop: true, loopStartSec: 58 }).ok).toBe(false) // 単位が短すぎる
  })
  it('ループ単位の書き出し: 単位 = [開始点, 曲末−2秒] + crossfade(曲末2秒 → 開始点直前2秒)。長さは 曲長 − 開始点（サンプル数で厳密）', () => {
    const { args } = buildLoopUnitArgs({ bgmPath: '/in.mp3', outPath: '/out.wav', bgmSec: 160.056, crossfadeSec: 2, sampleRate: 48000, loopStartSec: 35.41 })
    const g = args[args.indexOf('-filter_complex') + 1]
    expect(g).toContain('[h0]atrim=33.41:35.41') // 開始点の直前（クロスフェードの相手）
    expect(g).toContain('[m0]atrim=35.41:158.056')
    expect(g).toContain('[t0]atrim=158.056:160.056')
    expect(g).toContain('acrossfade=d=2:c1=qsin:c2=qsin')
    expect(g).toContain(`atrim=end_sample=${Math.round((160.056 - 35.41) * 48000)}`)
  })
  it('フィルタ: 1周目（曲の0〜開始点）→ ループ単位 を連結し、本編の長さで切り、本編終了でフェードアウト（2.5秒）。2つのBGM入力を使う', () => {
    const plan = planBgmLoop({ bgmSec: 160.056, mainSec: 916.6, loop: true, loopStartSec: 35.41 })
    const cfg = resolveMainBgmConfig({ enabled: true })
    const g = buildMainBgmFilters({ bgmInputIndex: 4, bgmIntroInputIndex: 3, mainSec: 916.6, gainDb: -37, plan, cfg, sampleRate: 48000, voiceLabel: '[mainvoice]', outLabel: '[mainaudio]' }).join(';')
    expect(g).toContain(`[3:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=end_sample=${Math.round(35.41 * 48000)}`)
    expect(g).toContain('[4:a]aresample=48000')
    expect(g).toContain('[mbi][mbu]concat=n=2:v=0:a=1,atrim=0:916.6')
    expect(g).toContain('afade=t=out:st=914.1:d=2.5') // 本編終了で無音
    expect(g.endsWith('[mainaudio]')).toBe(true)
  })
  it('開始点なし（従来）のフィルタは1入力のまま', () => {
    const plan = planBgmLoop({ bgmSec: 60, mainSec: 300, loop: true })
    const g = buildMainBgmFilters({ bgmInputIndex: 3, mainSec: 300, gainDb: -22, plan, cfg: resolveMainBgmConfig({ enabled: true }), sampleRate: 48000, voiceLabel: '[mainvoice]', outLabel: '[mainaudio]' }).join(';')
    expect(g).not.toContain('[mbi]')
    expect(g).toContain('[3:a]aresample=48000')
  })
})
