// ローカルAIテロップ動画: 音声(PCM16 mono)の音量エンベロープから「実測の無音区間」を検出する。
//
// Whisper/DTWのトークン時刻は、発話再開直後のトークン開始が直前の無音の先頭へ
// 引き寄せられる癖があるため、実際の音声から測った無音区間でスナップする用途に使う。
// 外部依存なし。AIは使わない。純粋関数のみ。

/**
 * WAV(RIFF, PCM16 mono)のバッファから PCM サンプルを取り出す。
 * @param {Buffer} buf
 * @returns {{ samples: Int16Array, sampleRate: number }}
 */
export function readWavPcm16Mono(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('WAVファイルとして解釈できません')
  }
  let pos = 12
  let sampleRate = 16000
  let channels = 1
  let bits = 16
  let dataStart = -1
  let dataLen = 0
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(pos + 10)
      sampleRate = buf.readUInt32LE(pos + 12)
      bits = buf.readUInt16LE(pos + 22)
    } else if (id === 'data') {
      dataStart = pos + 8
      dataLen = Math.min(size, buf.length - dataStart)
      break
    }
    pos += 8 + size + (size % 2)
  }
  if (dataStart < 0) throw new Error('WAVのdataチャンクが見つかりません')
  if (channels !== 1 || bits !== 16) throw new Error('モノラル16bit PCMのWAVのみ対応しています')
  const count = Math.floor(dataLen / 2)
  const samples = new Int16Array(count)
  for (let i = 0; i < count; i++) samples[i] = buf.readInt16LE(dataStart + i * 2)
  return { samples, sampleRate }
}

/**
 * フレームごとのRMS(dBFS)を返す。
 * @param {Int16Array} samples
 * @param {number} sampleRate
 * @param {number} [frameSec]
 * @returns {{ db: number[], frameSec: number }}
 */
export function computeFrameDb(samples, sampleRate, frameSec = 0.02) {
  const frameLen = Math.max(1, Math.round(sampleRate * frameSec))
  const db = []
  for (let i = 0; i + frameLen <= samples.length; i += frameLen) {
    let sum = 0
    for (let k = 0; k < frameLen; k++) {
      const v = samples[i + k] / 32768
      sum += v * v
    }
    db.push(10 * Math.log10(sum / frameLen + 1e-12))
  }
  return { db, frameSec: frameLen / sampleRate }
}

function percentile(sortedAsc, p) {
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * (sortedAsc.length - 1))))]
}

/**
 * 適応しきい値で無音区間(minSilenceSec以上)を検出する。
 * しきい値 = ノイズフロア(5%点) + (発話レベル(90%点) - ノイズフロア) * 0.3 を [-55, -35]dBへクランプ。
 *
 * @param {Int16Array} samples
 * @param {number} sampleRate
 * @param {{ minSilenceSec?: number, frameSec?: number }} [options]
 * @returns {{ silences: Array<{ startSec: number, endSec: number }>, thresholdDb: number }}
 */
export function detectSilences(samples, sampleRate, options = {}) {
  const minSilenceSec = options.minSilenceSec ?? 0.3
  const { db, frameSec } = computeFrameDb(samples, sampleRate, options.frameSec ?? 0.02)
  if (db.length === 0) return { silences: [], thresholdDb: -45 }
  const sorted = [...db].sort((a, b) => a - b)
  const floor = percentile(sorted, 0.05)
  const speech = percentile(sorted, 0.9)
  const thresholdDb = Math.min(-35, Math.max(-55, floor + (speech - floor) * 0.3))

  const silences = []
  let runStart = -1
  const flush = (endIdx) => {
    if (runStart < 0) return
    const startSec = runStart * frameSec
    const endSec = endIdx * frameSec
    if (endSec - startSec >= minSilenceSec - 1e-9) silences.push({ startSec, endSec })
    runStart = -1
  }
  for (let i = 0; i < db.length; i++) {
    if (db[i] < thresholdDb) {
      if (runStart < 0) runStart = i
    } else {
      flush(i)
    }
  }
  flush(db.length)
  return { silences, thresholdDb }
}
