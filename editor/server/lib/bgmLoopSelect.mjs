// ローカルAIテロップ動画: 本編BGMのループ開始点の選定（純粋関数。ffmpegは使わず、デコード済みのモノラルPCMだけを扱う）。
//
// ループ = 1周目は曲の0秒から。曲末は「ループ開始点の直前の音」へクロスフェードでつなぎ、2周目以降は開始点から再生する。
//   ループ単位 U = [a, L−x) + クロスフェード([L−x, L) → [a−x, a))。U の終端は元曲の a の直前と連続するので、U を繰り返す境界は曲の途中と同じ連続した音になる。
// 開始点 a の良し悪しは、曲末の最後の x 秒と、開始点直前の x 秒が「同じ拍・同じ音量・似た音色」かで決まる（重ねて混ぜるため）。
// 候補（既定 4秒以降・10ms刻み）を機械測定で比べ、もっとも自然なものを選ぶ。聴感は確認できない（機械測定のみ）。

const r3 = (v) => Math.round(v * 1000) / 1000

/** 基数2のFFT（in-place）。re/im は同じ長さ（2の冪）のFloat64Array。 */
export function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr; im[b] = im[a] - ti
        re[a] += tr; im[a] += ti
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

/**
 * 10ms刻み（sr は 100 の倍数にする。例 24000Hz）の解析: バンド別対数エネルギー（音色）と、正のスペクトルフラックス（拍・打点）。
 * @returns {{ frameSec: number, bands: Float32Array[], flux: Float32Array, rmsDb: Float32Array }}
 */
export function analyzeBgm(x, sr, { bandCount = 20 } = {}) {
  const hop = Math.round(sr * 0.01)
  const size = 512 // 約23ms（拍の立ち上がりを鋭く捉える。10ms刻み）
  const win = new Float64Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)))
  const frames = Math.max(0, Math.floor((x.length - size) / hop))
  // 対数間隔のバンド（100Hz〜sr/2の手前）
  const fLo = 100
  const fHi = Math.min(8000, sr / 2 - 1)
  const edges = Array.from({ length: bandCount + 1 }, (_, i) => Math.round(((fLo * (fHi / fLo) ** (i / bandCount)) / sr) * size))
  const bands = []
  const flux = new Float32Array(frames)
  const rmsDb = new Float32Array(frames)
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  let prev = null
  for (let f = 0; f < frames; f++) {
    let e = 0
    for (let i = 0; i < size; i++) { const v = x[f * hop + i]; re[i] = v * win[i]; im[i] = 0; e += v * v }
    rmsDb[f] = 10 * Math.log10(e / size + 1e-12)
    fft(re, im)
    const b = new Float32Array(bandCount)
    for (let k = 0; k < bandCount; k++) {
      let s = 0
      for (let i = edges[k]; i < Math.max(edges[k] + 1, edges[k + 1]); i++) s += re[i] * re[i] + im[i] * im[i]
      b[k] = Math.log10(s + 1e-9)
    }
    let fl = 0
    if (prev) for (let k = 0; k < bandCount; k++) fl += Math.max(0, b[k] - prev[k])
    flux[f] = fl
    bands.push(b)
    prev = b
  }
  // 末尾の数フレーム（窓が曲末にかかって作れない分）は最後の値で埋める。曲末の時刻（L）を正確に基準にするため
  const padN = Math.ceil(size / hop) + 1
  const outFlux = new Float32Array(frames + padN)
  const outRms = new Float32Array(frames + padN)
  outFlux.set(flux)
  outRms.set(rmsDb)
  for (let k = 0; k < padN && frames > 0; k++) { bands.push(bands[frames - 1]); outRms[frames + k] = rmsDb[frames - 1] }
  return { frameSec: hop / sr, bands, flux: outFlux, rmsDb: outRms } // 10ms刻み（sr が 100 の倍数のとき正確に 10ms。24000Hz なら hop=240）
}

const meanOf = (arr, a, b) => { let s = 0; for (let i = a; i < b; i++) s += arr[i]; return s / Math.max(1, b - a) }
/** dB平均ではなくエネルギー平均のdB。 */
const energyDb = (rmsDb, a, b) => { let s = 0; for (let i = a; i < b; i++) s += 10 ** (rmsDb[i] / 10); return 10 * Math.log10(s / Math.max(1, b - a) + 1e-12) }

function ncc(arr, a0, b0, len) {
  // 平均を引いた正規化相互相関（ラグ0）
  const ma = meanOf(arr, a0, a0 + len)
  const mb = meanOf(arr, b0, b0 + len)
  let num = 0; let da = 0; let db = 0
  for (let i = 0; i < len; i++) { const p = arr[a0 + i] - ma; const q = arr[b0 + i] - mb; num += p * q; da += p * p; db += q * q }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
}

/**
 * ループ開始点の候補を測定して並べる。
 * @param {ReturnType<typeof analyzeBgm>} an
 * @param {{ lengthSec: number, crossfadeSec?: number, fromSec?: number, toSec?: number, stepSec?: number, beatWindowSec?: number }} p
 * @returns {Array<{ startSec: number, beatCorr: number, levelDiffDb: number, sustainDiffDb: number, continuityDb: number, spectralDist: number, score: number }>} score の高い順
 */
export function scoreLoopStarts(an, p) {
  const fs = an.frameSec
  const x = p.crossfadeSec ?? 2
  const L = Math.min(p.lengthSec, (an.flux.length - 1) * fs)
  const W = Math.round((p.beatWindowSec ?? 6) / fs)
  const xf = Math.round(x / fs)
  const Lf = Math.round(L / fs) // 曲末（時刻L）に対応する終端のフレーム（排他）
  const out = []
  const step = Math.max(1, Math.round((p.stepSec ?? 0.01) / fs))
  const tailBand = (() => { const m = new Float64Array(an.bands[0].length); for (let i = Lf - xf; i < Lf; i++) for (let k = 0; k < m.length; k++) m[k] += an.bands[i][k] / xf; return m })()
  const tailLevel = energyDb(an.rmsDb, Lf - xf, Lf)
  const tailSustain = energyDb(an.rmsDb, Lf - Math.round(4 / fs), Lf)
  const hi = Math.min(Math.round((p.toSec ?? 40) / fs), Lf - Math.round(20 / fs)) // 単位が短くなりすぎない
  for (let a = Math.round((p.fromSec ?? 4) / fs); a <= hi; a += step) {
    const Wa = Math.min(W, a) // 曲頭に近い開始点（4〜6秒）は、開始点までの長さで拍を比べる（最低4秒）
    if (Wa < xf) continue
    const beatCorr = ncc(an.flux, Lf - Wa, a - Wa, Wa)
    const headLevel = energyDb(an.rmsDb, a - xf, a)
    const levelDiffDb = Math.abs(tailLevel - headLevel)
    const sustainDiffDb = Math.abs(tailSustain - energyDb(an.rmsDb, a, a + Math.round(4 / fs)))
    const continuityDb = Math.abs(energyDb(an.rmsDb, a - 25, a) - energyDb(an.rmsDb, a, a + 25))
    const m = new Float64Array(tailBand.length)
    for (let i = a - xf; i < a; i++) for (let k = 0; k < m.length; k++) m[k] += an.bands[i][k] / xf
    let dd = 0
    for (let k = 0; k < m.length; k++) dd += (m[k] - tailBand[k]) ** 2
    const spectralDist = Math.sqrt(dd / m.length)
    // 高いほど良い: 拍が合う（最重要）・音量差が小さい・音色が近い
    const score = beatCorr - levelDiffDb * 0.15 - sustainDiffDb * 0.08 - continuityDb * 0.1 - spectralDist * 0.5
    out.push({ startSec: r3(a * fs), beatCorr: r3(beatCorr), levelDiffDb: r3(levelDiffDb), sustainDiffDb: r3(sustainDiffDb), continuityDb: r3(continuityDb), spectralDist: r3(spectralDist), score: r3(score) })
  }
  return out.sort((p1, p2) => p2.score - p1.score)
}

/** 上位から、互いに0.5秒以上離れた候補を n 件選ぶ（同じ山の隣り合う候補を除く）。 */
export function topDistinct(cands, n = 8, minGapSec = 0.5) {
  const picked = []
  for (const c of cands) {
    if (picked.every((p) => Math.abs(p.startSec - c.startSec) >= minGapSec)) picked.push(c)
    if (picked.length >= n) break
  }
  return picked
}

const rmsDbOf = (x, a, b) => { let s = 0; const n = Math.max(1, b - a); for (let i = a; i < b; i++) s += x[i] * x[i]; return 10 * Math.log10(s / n + 1e-12) }

/**
 * 生成したループ単位（モノラル化したPCM）の境界を測る。単位を2回つなげたときの、境界（単位の終端 = 次の周の先頭）前後の
 * - levelDiffDb: 境界直前1.0秒と直後1.0秒の音量差（拍の周期をならすため1秒窓）。level500msDiffDb は0.5秒窓の参考値
 * - dipDb: クロスフェード区間（境界の直前 x 秒）の100ms窓の最小音量 − 同じ長さの別の2区間（境界の後・前の離れた所）の100ms窓の最小音量の平均。
 *          音楽は拍で自然に100ms窓の音量が落ちるので、絶対値ではなく他の区間と比べる（負ならクロスフェードで余計に落ち込んでいる）
 * - xfadeLevelDb: クロスフェード区間の平均音量 − 境界の前後の平均音量（クロスフェードで音量が膨らむ/凹む量）
 * - maxStepRatio: 境界±5msの最大サンプル間差 ÷ 周囲の最大サンプル間差（1.5以下ならクリックなし）
 * @param {Float32Array} unit @param {number} sr @param {number} crossfadeSec
 */
export function measureLoopBoundary(unit, sr, crossfadeSec) {
  const B = unit.length
  const both = new Float32Array(B * 2)
  both.set(unit, 0)
  both.set(unit, B)
  const w = (sec) => Math.round(sec * sr)
  const rms = (a, b) => rmsDbOf(both, B + w(a), B + w(b))
  const x = crossfadeSec
  const winMin = (a, b) => { let m = Infinity; for (let t = a; t + 0.1 <= b + 1e-9; t += 0.05) m = Math.min(m, rms(t, t + 0.1)); return m }
  const xfMin = winMin(-x, 0)
  const refMin = (winMin(0.5, 0.5 + x) + winMin(-x - 3 - x, -x - 3)) / 2
  const surround = 10 * Math.log10((10 ** (rms(-x - 4, -x) / 10) + 10 ** (rms(0.2, 4.2) / 10)) / 2)
  const stepOf = (a, b) => { let m = 0; for (let i = Math.max(1, a); i < Math.min(both.length, b); i++) m = Math.max(m, Math.abs(both[i] - both[i - 1])); return m }
  const atB = stepOf(B - w(0.005), B + w(0.005))
  const elsewhere = Math.max(stepOf(B - w(4), B - w(1)), stepOf(B + w(1), B + w(4)))
  return {
    levelDiffDb: r3(Math.abs(rms(-1, 0) - rms(0, 1))), level500msDiffDb: r3(Math.abs(rms(-0.5, 0) - rms(0, 0.5))), rmsBeforeDb: r3(rms(-1, 0)), rmsAfterDb: r3(rms(0, 1)),
    dipDb: r3(xfMin - refMin), xfadeLevelDb: r3(rms(-x, 0) - surround),
    maxStepAtBoundary: Math.round(atB * 1e5) / 1e5, maxStepElsewhere: Math.round(elsewhere * 1e5) / 1e5, maxStepRatio: r3(atB / Math.max(elsewhere, 1e-9)),
  }
}
