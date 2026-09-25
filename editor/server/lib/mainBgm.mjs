// ローカルAIテロップ動画: 本編BGM（ユーザー指定のMP3を、本編だけに小さく重ねる）。純粋関数と、ffmpeg引数の組み立て。
//
// 適用範囲: 本編の開始〜終了だけ（冒頭LINEオーバーレイの間も流れる）。ダイジェスト・末尾LINE案内には使わない（別のフィルタチェーンに閉じ込める）。
// 音量: 入力音源のラウドネス（RMS）と本編トークの発話中のラウドネスを測り、声とBGMの差が目標になる初期ゲインを決める（autoGain）。
//       ユーザーの音量は「標準(0.03)に対する倍率」として効かせ、声とBGMの差が下限（12dB）を割らないよう上限を設ける。
// ダッキング: 本編のトーク音声をサイドチェインにして、発話中だけBGMを下げる。急に動かさない（attack 60ms / release 800ms）。
// ループ: MP3が本編より短いときは、末尾と先頭を短くクロスフェードした「継ぎ目のないループ単位」を一時WAVへ書き、それを繰り返す。
// 安全: ffmpeg は argv 配列（shell展開なし）。元MP3・元動画は読み取りのみ。絶対パスは戻り値・ログへ出さない。

import { extname } from 'path'

export const MAIN_BGM_DEFAULTS = Object.freeze({
  enabled: false,
  sourcePath: null,
  volume: 0.05, // 標準。autoGain のとき、声より（ダッキング前で）約15.6dB（ダッキングOFFは約21.6dB）小さいゲインに相当（MAIN_BGM_GAP_TARGET）。0.03→0.05: 確認動画でBGMが小さすぎたため（実測 平均差 23.8dB → 21.5dB、発話がない間は約5dB大きい）
  autoGain: true,
  ducking: true,
  loop: true,
  fadeInSec: 1.5,
  fadeOutSec: 2.5,
  scope: 'main',
})

export const MAIN_BGM_LIMITS = Object.freeze({
  volumeMax: 0.06, // 標準の1.2倍（+1.6dB）まで。声との差の下限（12dB）に対して余裕を残すため、これ以上は指定できない（ダッキングON・標準の目標差15.6dBのとき最大 +3.6dB まで上げられる）
  fadeMaxSec: 10,
  minGapDb: 12, // 発話中の声−BGM(ダッキング前)の最小差。ユーザー音量を上げてもこれを割らない
  presetVolume: 0.05, // ユーザー音量の基準（この音量のとき、声−BGMが MAIN_BGM_GAP_TARGET になる）
})

/**
 * 声−BGM（発話中）の、ダッキング前の目標差（dB）。「発話中の平均RMSどうし」で決める（標準音量 presetVolume のとき）。
 * 実測（パステルハウス.mp3・本編全編の声 916秒・400msウィンドウ・発話とみなす窓の下限 -45dBFS）:
 *   旧設定（音量0.028・ratio4・thr0.02・release900）: 平均差 23.2dB・最小 11.8dB・下位5%点 16.3dB → BGMが小さすぎた。
 *   採用設定（音量0.05・ratio6・thr0.015・attack60・release1200）: 平均差 21.5dB・最小 10.8dB・下位5%点 14.7dB（窓の下限 -42dBFS で数えると 平均22.0・最小12.7）。
 * 最小差は「声が最も小さい語尾の窓」で決まる（BGMは発話中ほぼ一定にダッキングされ、声の窓ごとの音量差がそのまま差に出る）ため、平均差と最小差の開きは約11dBで変えられない。
 * 最小差12dB以上と平均差18〜20dBは同時に満たせず（最小12dB以上にすると平均は約23.5dB）、BGMの聞こえやすさを優先して平均約21.5dBを採用した。
 */
export const MAIN_BGM_GAP_TARGET = Object.freeze({ ducking: 15.6, noDucking: 21.6 })

/**
 * ダッキング（sidechaincompress）の設定。声をサイドチェインに、発話中だけBGMを下げる。
 * サイドチェインは声の帯域(120〜5000Hz)に絞り、acompressor(thr -48dBFS・ratio 20・makeup 18倍)で強く圧縮して、
 * 強い語頭でも弱い語尾・子音でも検出レベルをそろえる（弱い部分でダッキングが浅くなり、声がBGMへ埋もれるのを防ぐ）。
 * その上で sidechaincompress（threshold 0.015・ratio 6）が発話中のBGMを約6dB下げる（音量0.05の実測）。
 * attack 60ms: 発話開始ですぐ下がるが、語頭の子音を待たずに沈むほど速くない。release 1200ms: 語尾・0.4〜0.6秒の短い間では大きく戻らず（戻りは約2dB）、1.5秒以上の間で十分戻る。
 */
export const MAIN_BGM_DUCK = Object.freeze({
  threshold: 0.015,
  ratio: 6,
  attack: 60, // ms
  release: 1200, // ms
  knee: 6,
  makeup: 1,
  link: 'average',
  detection: 'rms',
  sidechainHighpassHz: 120,
  sidechainLowpassHz: 5000,
  sidechainNormalize: Object.freeze({ threshold: 0.004, ratio: 20, attack: 5, release: 250, makeup: 18, knee: 2 }),
})

export const MAIN_BGM_LOOP = Object.freeze({ crossfadeSec: 2, minCrossfadeSec: 0.25, minStartSec: 4 }) // minStartSec: 2周目以降の開始点の候補下限（曲頭の静かな部分を避ける）
export const MAIN_BGM_LIMITER = Object.freeze({ limit: 0.891, attack: 5, release: 60 }) // 0.891 = -1dBFS。true peakに約1dBの余裕

const clone = (o) => JSON.parse(JSON.stringify(o))
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const r3 = (v) => Math.round(v * 1000) / 1000
export const linearToDb = (v) => (v > 0 ? 20 * Math.log10(v) : -120)
export const dbToLinear = (db) => 10 ** (db / 20)

/** 設定を解決する（未指定は既定）。素材未指定（enabled:false / sourcePath:null）は「本編BGMなし」＝従来どおり。 */
export function resolveMainBgmConfig(overrides) {
  const cfg = clone(MAIN_BGM_DEFAULTS)
  if (isObj(overrides)) for (const [k, v] of Object.entries(overrides)) if (k in cfg && v !== undefined) cfg[k] = v
  return cfg
}

/** UIからの上書きのうち許可する項目だけを取り出す（素材のパス・IDはここでは扱わない。sourceId は別に検証する）。 */
export function sanitizeMainBgmOverrides(body) {
  if (!isObj(body)) return {}
  const num = (v) => (Number.isFinite(v) ? v : undefined)
  const bool = (v) => (typeof v === 'boolean' ? v : undefined)
  const out = { enabled: bool(body.enabled), volume: num(body.volume), autoGain: bool(body.autoGain), ducking: bool(body.ducking), loop: bool(body.loop), fadeInSec: num(body.fadeInSec), fadeOutSec: num(body.fadeOutSec) }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined))
}

/** @returns {{ ok: boolean, errors: string[] }} */
export function validateMainBgmConfig(cfg) {
  const errors = []
  const num = (v, lo, hi, name) => {
    if (!Number.isFinite(v) || v < lo || v > hi) errors.push(`${name}は${lo}〜${hi}の範囲で指定してください`)
  }
  num(cfg.volume, 0, MAIN_BGM_LIMITS.volumeMax, '本編BGMの音量')
  num(cfg.fadeInSec, 0, MAIN_BGM_LIMITS.fadeMaxSec, '本編BGMのフェードイン')
  num(cfg.fadeOutSec, 0, MAIN_BGM_LIMITS.fadeMaxSec, '本編BGMのフェードアウト')
  if (cfg.scope !== 'main') errors.push('本編BGMの適用範囲は main のみ対応しています')
  return { ok: errors.length === 0, errors }
}

// ────────────────────────────────────────────────────────────────
// 音源の検証（ffprobe の出力JSONから。拡張子・Content-Typeは信用しない）
// ────────────────────────────────────────────────────────────────

export const MAIN_BGM_MISSING_MESSAGE = '本編BGMのMP3が見つかりません。ファイルの選択を確認してください。'

/**
 * ffprobe -print_format json -show_format -show_streams の結果から、MP3として使えるか判定する。
 * 音声ストリームがあること・duration が取れること・映像だけのファイルでないこと・実際のコーデックが mp3 であること。
 * @returns {{ ok: boolean, error?: string, durationSec?: number, sampleRate?: number, channels?: number, codec?: string, bitRate?: number | null }}
 */
export function parseMp3Probe(probe, inputName = '') {
  if (extname(String(inputName)).toLowerCase() !== '.mp3') return { ok: false, error: '拡張子が .mp3 ではありません' }
  const streams = Array.isArray(probe?.streams) ? probe.streams : []
  const audio = streams.find((s) => s.codec_type === 'audio')
  if (!audio) return { ok: false, error: streams.some((s) => s.codec_type === 'video') ? '音声ストリームがありません（映像のみのファイルです）' : '音声ストリームがありません' }
  const formatNames = String(probe?.format?.format_name ?? '')
  if (String(audio.codec_name) !== 'mp3' || !/mp3/.test(formatNames)) return { ok: false, error: '中身がMP3ではありません' }
  const durationSec = Number(probe?.format?.duration ?? audio.duration)
  if (!Number.isFinite(durationSec) || durationSec <= 0) return { ok: false, error: '再生時間を取得できません（壊れている可能性があります）' }
  const sampleRate = Number(audio.sample_rate)
  const channels = Number(audio.channels)
  if (!(sampleRate > 0) || !(channels > 0)) return { ok: false, error: 'サンプルレートまたはチャンネル数を取得できません' }
  return { ok: true, durationSec: r3(durationSec), sampleRate, channels, codec: 'mp3', bitRate: Number(probe?.format?.bit_rate) || null }
}

// ────────────────────────────────────────────────────────────────
// 音量（自動ゲイン）
// ────────────────────────────────────────────────────────────────

/**
 * 初期ゲイン(dB)を決める。
 * - autoGain: 声（発話中の平均RMS）と音源（平均RMS）から、声−BGMが目標差になるゲインを求め、ユーザー音量を標準(0.03)に対する倍率として加える。
 *   ダッキング前の声−BGMは常に minGapDb 以上（ユーザー音量を上げても割らない）。
 * - autoGainなし: ユーザー音量を素材への線形ゲインとしてそのまま使う（上限は minGapDb で同様に制限）。
 * @param {{ voiceSpeechDb: number, bgmDb: number, volume: number, autoGain: boolean, ducking: boolean }} p 音量はすべて同じ測り方のdB（RMS）
 * @returns {{ gainDb: number, preDuckGapDb: number, targetGapDb: number, clamped: boolean, muted: boolean, volume: number }}
 */
export function planBgmGain(p) {
  const volume = Math.min(Math.max(Number(p.volume) || 0, 0), MAIN_BGM_LIMITS.volumeMax)
  const targetGapDb = p.ducking ? MAIN_BGM_GAP_TARGET.ducking : MAIN_BGM_GAP_TARGET.noDucking
  if (volume <= 0) return { gainDb: -120, preDuckGapDb: Infinity, targetGapDb, clamped: false, muted: true, volume }
  const levelDiff = p.voiceSpeechDb - p.bgmDb // 素材にゲイン0dBをかけたときの 声−BGM の逆（=声がBGMよりどれだけ大きいか）
  let gainDb = p.autoGain ? levelDiff - targetGapDb + linearToDb(volume / MAIN_BGM_LIMITS.presetVolume) : linearToDb(volume)
  const maxGainDb = levelDiff - MAIN_BGM_LIMITS.minGapDb // これ以上上げると声との差が下限を割る
  const clamped = gainDb > maxGainDb
  if (clamped) gainDb = maxGainDb
  return { gainDb: r3(gainDb), preDuckGapDb: r3(levelDiff - gainDb), targetGapDb, clamped, muted: false, volume }
}

/** dBFS(RMS)の平均。frames の db から、閾値より大きいフレーム（発話・演奏中）のエネルギー平均を取る。 */
export function meanEnergyDb(db, minDb = -Infinity) {
  let sum = 0
  let n = 0
  for (const v of db) {
    if (v <= minDb) continue
    sum += 10 ** (v / 10)
    n++
  }
  return n > 0 ? r3(10 * Math.log10(sum / n)) : -120
}

// ────────────────────────────────────────────────────────────────
// ループ
// ────────────────────────────────────────────────────────────────

/**
 * ループの計画。音源が本編以上ならループしない（本編長で切る）。短いときはクロスフェード付きの単位を繰り返す。
 * loopStartSec（2周目以降の開始点。1周目は必ず曲の0秒から）が無いとき: 単位 = 曲の先頭x秒〜曲末（長さ 音源長−x）。従来どおり。
 * loopStartSec があるとき: 1周目 = 曲の 0〜開始点（introSec）、その後は単位 [開始点, 曲末) を繰り返す（単位の長さ = 音源長−開始点。曲末x秒は開始点直前のx秒へクロスフェード）。
 * クロスフェードは音源の短さに応じて縮める（最小 0.25秒。音源がそれ以下なら計画不可）。
 * @returns {{ needsLoop: boolean, loopEnabled: boolean, unitSec: number, crossfadeSec: number, loops: number, playSec: number, ok: boolean, loopStartSec: number, introSec: number, error?: string }}
 */
export function planBgmLoop({ bgmSec, mainSec, loop, loopStartSec = 0 }) {
  if (!(bgmSec > 0) || !(mainSec > 0)) return { needsLoop: false, loopEnabled: false, unitSec: 0, crossfadeSec: 0, loops: 0, playSec: 0, ok: false, loopStartSec: 0, introSec: 0, error: '音源または本編の長さが不正です' }
  if (bgmSec >= mainSec - 1e-6) return { needsLoop: false, loopEnabled: false, unitSec: bgmSec, crossfadeSec: 0, loops: 1, playSec: r3(mainSec), ok: true, loopStartSec: 0, introSec: 0 }
  if (!loop) return { needsLoop: false, loopEnabled: false, unitSec: bgmSec, crossfadeSec: 0, loops: 1, playSec: r3(bgmSec), ok: true, loopStartSec: 0, introSec: 0 }
  const xf = Math.min(MAIN_BGM_LOOP.crossfadeSec, r3(bgmSec / 4))
  if (xf < MAIN_BGM_LOOP.minCrossfadeSec) return { needsLoop: true, loopEnabled: true, unitSec: 0, crossfadeSec: 0, loops: 0, playSec: 0, ok: false, loopStartSec: 0, introSec: 0, error: '音源が短すぎてループできません' }
  const a = Number(loopStartSec) || 0
  if (a > 0) {
    // 開始点は、直前にクロスフェード分の音があり、単位が短くなりすぎない範囲
    if (a < xf || bgmSec - a < xf * 2 + 1) return { needsLoop: true, loopEnabled: true, unitSec: 0, crossfadeSec: 0, loops: 0, playSec: 0, ok: false, loopStartSec: a, introSec: a, error: 'ループ開始点が音源の範囲に合いません' }
    const unitSec = r3(bgmSec - a)
    return { needsLoop: true, loopEnabled: true, unitSec, crossfadeSec: xf, loops: 1 + Math.ceil(Math.max(0, mainSec - a) / unitSec), playSec: r3(mainSec), ok: true, loopStartSec: a, introSec: a }
  }
  const unitSec = r3(bgmSec - xf)
  return { needsLoop: true, loopEnabled: true, unitSec, crossfadeSec: xf, loops: Math.ceil(mainSec / unitSec), playSec: r3(mainSec), ok: true, loopStartSec: 0, introSec: 0 }
}

/**
 * ループ単位（継ぎ目のないWAV）を書き出すffmpeg引数。
 * loopStartSec なし: 単位 = [x, L−x] + crossfade(末尾x秒 → 先頭x秒)。
 * loopStartSec=a あり: 単位 = [a, L−x] + crossfade(末尾x秒 → [a−x, a])。どちらも単位の終端は元の音源の「単位の先頭の直前」と連続するので、
 * 繰り返しても継ぎ目でクリックせず、音量も変わらない（loopStartSec なしは a = x の特別な場合）。
 * サンプル数は atrim=end_sample で厳密に決める（MP3のデコード長のずれに依存しない）。
 * @param {{ bgmPath: string, outPath: string, bgmSec: number, crossfadeSec: number, sampleRate: number, loopStartSec?: number }} p
 */
export function buildLoopUnitArgs(p) {
  const SR = p.sampleRate
  const x = p.crossfadeSec
  const L = p.bgmSec
  const a = p.loopStartSec > 0 ? p.loopStartSec : x
  const f = `aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${r3(L)},asetpts=PTS-STARTPTS`
  const chain = [
    `[0:a]${f},asplit=3[h0][m0][t0]`,
    `[h0]atrim=${r3(a - x)}:${r3(a)},asetpts=PTS-STARTPTS[h]`,
    `[m0]atrim=${r3(a)}:${r3(L - x)},asetpts=PTS-STARTPTS[m]`,
    `[t0]atrim=${r3(L - x)}:${r3(L)},asetpts=PTS-STARTPTS[t]`,
    `[t][h]acrossfade=d=${x}:c1=qsin:c2=qsin[xf]`,
    `[m][xf]concat=n=2:v=0:a=1,atrim=end_sample=${Math.round((L - a) * SR)},asetpts=PTS-STARTPTS[u]`,
  ]
  return { args: ['-y', '-hide_banner', '-nostats', '-i', p.bgmPath, '-filter_complex', chain.join(';'), '-map', '[u]', '-c:a', 'pcm_f32le', '-ar', String(SR), '-ac', '2', p.outPath] }
}

// ────────────────────────────────────────────────────────────────
// 本編の音声ミックス（フィルタ）
// ────────────────────────────────────────────────────────────────

/**
 * 本編の音声（トーク）へBGMを重ねるフィルタ。入力ラベル [mainVoiceIn]（本編のトーク）と BGM入力のインデックスから、[mainAudioOut] を作る。
 * BGMは本編の長さで正確に切り、末尾でフェードアウト（本編終了の時刻に無音）。amix は本編トークの長さに合わせる。
 * tapBgmLabel: 指定すると、ミックス直前のBGM（ダッキング後）を、その名前のラベルへも分岐する（検証用ステム）。
 * @param {{ bgmInputIndex: number, mainSec: number, gainDb: number, plan: ReturnType<typeof planBgmLoop>, cfg: ReturnType<typeof resolveMainBgmConfig>, sampleRate: number, voiceLabel: string, outLabel: string, tapBgmLabel?: string, duck?: typeof MAIN_BGM_DUCK }} p
 * @returns {string[]} filter_complex の要素
 */
export function buildMainBgmFilters(p) {
  const { cfg, plan } = p
  const SR = p.sampleRate
  const play = plan.playSec
  const fi = Math.min(cfg.fadeInSec, play)
  const fo = Math.min(cfg.fadeOutSec, play)
  const d = p.duck ?? MAIN_BGM_DUCK
  const chain = []
  const fmt = `aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo`
  let src
  if (plan.needsLoop && plan.introSec > 0) {
    // 1周目は曲の0秒から（introSec まで）→ 2周目以降はループ単位（開始点から）。つなぎ目は元の音源上で連続している
    chain.push(`[${p.bgmIntroInputIndex}:a]${fmt},atrim=end_sample=${Math.round(plan.introSec * SR)},asetpts=PTS-STARTPTS[mbi]`)
    chain.push(`[${p.bgmInputIndex}:a]${fmt},asetpts=PTS-STARTPTS[mbu]`)
    src = `[mbi][mbu]concat=n=2:v=0:a=1,atrim=0:${r3(play)},asetpts=PTS-STARTPTS`
  } else {
    src = `[${p.bgmInputIndex}:a]${fmt},atrim=0:${r3(play)},asetpts=PTS-STARTPTS`
  }
  const gain = `volume=${p.gainDb}dB:precision=float`
  const fades = `${fi > 0 ? `afade=t=in:st=0:d=${r3(fi)}` : 'anull'},${fo > 0 ? `afade=t=out:st=${r3(Math.max(0, play - fo))}:d=${r3(fo)}` : 'anull'}`
  chain.push(`${src},${gain},${fades}[mbgm]`)
  if (cfg.ducking) {
    chain.push(`${p.voiceLabel}asplit=2[mvoice][msc0]`)
    // サイドチェイン: 声の帯域だけにし、強く圧縮して発話中の検出レベルをそろえる（弱い語尾・子音でもダッキングが効く／強い語頭で下がりすぎない）
    const sc = d.sidechainNormalize
    chain.push(`[msc0]highpass=f=${d.sidechainHighpassHz},lowpass=f=${d.sidechainLowpassHz}${sc ? `,acompressor=threshold=${sc.threshold}:ratio=${sc.ratio}:attack=${sc.attack}:release=${sc.release}:makeup=${sc.makeup}:knee=${sc.knee}` : ''}[msc]`)
    chain.push(`[mbgm][msc]sidechaincompress=threshold=${d.threshold}:ratio=${d.ratio}:attack=${d.attack}:release=${d.release}:knee=${d.knee}:makeup=${d.makeup}:link=${d.link}:detection=${d.detection}[mbgmd]`)
    if (p.tapBgmLabel) chain.push(`[mbgmd]asplit=2[mbgmf]${p.tapBgmLabel}`)
    chain.push(`[mvoice]${p.tapBgmLabel ? '[mbgmf]' : '[mbgmd]'}amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mmix]`)
  } else {
    if (p.tapBgmLabel) chain.push(`[mbgm]asplit=2[mbgmf]${p.tapBgmLabel}`)
    chain.push(`${p.voiceLabel}${p.tapBgmLabel ? '[mbgmf]' : '[mbgm]'}amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mmix]`)
  }
  const lim = MAIN_BGM_LIMITER
  // level=0: 自動レベル補正を切る（入れると制限後に元の音量へ戻されてしまう）。latency=1: 先読みバッファの遅延（attack分）を補正し、トーク音声を映像に対して遅らせない
  chain.push(`[mmix]alimiter=limit=${lim.limit}:attack=${lim.attack}:release=${lim.release}:level=0:latency=1,atrim=0:${r3(p.mainSec)},asetpts=PTS-STARTPTS${p.outLabel}`)
  return chain
}

/**
 * 声・BGM・ミックスのステム(WAV)を書き出す検証用の引数（本番と同じフィルタ）。映像は処理しない。
 * voice は本編トークのWAV（元動画時刻ではなく編集後の本編の音声。呼び出し側で用意）。
 * @param {{ voicePath: string, bgmPath: string, loopUnitPath?: string | null, mainSec: number, gainDb: number, plan: ReturnType<typeof planBgmLoop>, cfg: ReturnType<typeof resolveMainBgmConfig>, sampleRate: number, outVoice: string, outBgm: string, outMix: string }} p
 */
export function buildMainBgmStemArgs(p) {
  const SR = p.sampleRate
  const args = ['-y', '-hide_banner', '-nostats', '-i', p.voicePath]
  const intro = p.plan.needsLoop && p.plan.introSec > 0
  if (intro) args.push('-i', p.bgmPath) // 1周目（曲の0秒から）
  if (p.plan.needsLoop) args.push('-stream_loop', '-1', '-i', p.loopUnitPath)
  else args.push('-i', p.bgmPath)
  const chain = [`[0:a]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${r3(p.mainSec)},asetpts=PTS-STARTPTS,asplit=2[vin][vstem]`]
  chain.push(...buildMainBgmFilters({ bgmInputIndex: intro ? 2 : 1, bgmIntroInputIndex: 1, mainSec: p.mainSec, gainDb: p.gainDb, plan: p.plan, cfg: p.cfg, sampleRate: SR, voiceLabel: '[vin]', outLabel: '[mix]', tapBgmLabel: '[bstem]', duck: p.duck }))
  args.push('-filter_complex', chain.join(';'), '-map', '[vstem]', '-ac', '1', '-ar', '16000', p.outVoice, '-map', '[bstem]', '-ac', '1', '-ar', '16000', p.outBgm, '-map', '[mix]', '-ac', '1', '-ar', '16000', p.outMix)
  return { args }
}

// ────────────────────────────────────────────────────────────────
// 検証（測定値から）
// ────────────────────────────────────────────────────────────────

/**
 * 声とBGM（ダッキング後）のフレームごとの音量から、発話中の差を集計する。
 * 音節ごとの音量の揺れ（子音・語尾の弱い部分）で最小値が極端にならないよう、windowFrames（既定20フレーム=約400ms）のエネルギー平均で比べる。
 * 声のウィンドウ平均が voiceGateDb を超えたウィンドウ（発話中）だけを数える。
 * @param {number[]} voiceDb 声のフレーム音量(dBFS) @param {number[]} bgmDb 同じフレーム数のBGM(ダッキング後) @param {number} voiceGateDb 発話とみなす声の下限
 * @returns {{ windows: number, meanGapDb: number, minGapDb: number, p5GapDb: number }}
 */
export function summarizeVoiceBgmGap(voiceDb, bgmDb, voiceGateDb, windowFrames = 20) {
  const gaps = []
  const n = Math.min(voiceDb.length, bgmDb.length)
  const avgDb = (arr, i) => {
    let sum = 0
    for (let k = i; k < i + windowFrames; k++) sum += 10 ** (arr[k] / 10)
    return 10 * Math.log10(sum / windowFrames)
  }
  for (let i = 0; i + windowFrames <= n; i += windowFrames) {
    const v = avgDb(voiceDb, i)
    if (v > voiceGateDb) gaps.push(v - avgDb(bgmDb, i))
  }
  if (gaps.length === 0) return { windows: 0, meanGapDb: 0, minGapDb: 0, p5GapDb: 0 }
  const sorted = [...gaps].sort((a, b) => a - b)
  return { windows: gaps.length, meanGapDb: r3(gaps.reduce((a, b) => a + b, 0) / gaps.length), minGapDb: r3(sorted[0]), p5GapDb: r3(sorted[Math.floor(0.05 * (sorted.length - 1))]) }
}
