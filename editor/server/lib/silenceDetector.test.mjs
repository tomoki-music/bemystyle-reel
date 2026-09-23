import { describe, it, expect } from 'vitest'
import { readWavPcm16Mono, computeFrameDb, detectSilences } from './silenceDetector.mjs'

const SR = 16000

/** 指定区間だけ音(サイン波)があり、他は無音(ごく小さなノイズ)のPCMを作る。 */
function makePcm(totalSec, speechRanges) {
  const n = Math.round(totalSec * SR)
  const samples = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const inSpeech = speechRanges.some(([a, b]) => t >= a && t < b)
    samples[i] = inSpeech ? Math.round(8000 * Math.sin(2 * Math.PI * 220 * t)) : Math.round((Math.random() - 0.5) * 6)
  }
  return samples
}

function toWav(samples) {
  const dataLen = samples.length * 2
  const buf = Buffer.alloc(44 + dataLen)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataLen, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataLen, 40)
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2)
  return buf
}

describe('readWavPcm16Mono', () => {
  it('PCM16 mono WAVを読める', () => {
    const src = makePcm(0.5, [[0, 0.5]])
    const { samples, sampleRate } = readWavPcm16Mono(toWav(src))
    expect(sampleRate).toBe(SR)
    expect(samples.length).toBe(src.length)
    expect(samples[100]).toBe(src[100])
  })

  it('WAVでないデータは拒否する', () => {
    expect(() => readWavPcm16Mono(Buffer.from('not a wav file at all, definitely not a wav file!!!!'))).toThrow()
  })
})

describe('detectSilences', () => {
  it('0.3秒以上の無音だけを、およそ正しい位置で検出する', () => {
    // 発話: 0-1.0, 1.5-3.0, 3.2-4.0（3.0-3.2の0.2秒は短いので検出しない）。無音: 1.0-1.5(0.5s)
    const samples = makePcm(4, [[0, 1.0], [1.5, 3.0], [3.2, 4.0]])
    const { silences } = detectSilences(samples, SR, { minSilenceSec: 0.3 })
    expect(silences).toHaveLength(1)
    expect(silences[0].startSec).toBeCloseTo(1.0, 1)
    expect(silences[0].endSec).toBeCloseTo(1.5, 1)
  })

  it('先頭の無音も検出する', () => {
    const samples = makePcm(3, [[1.0, 3.0]])
    const { silences } = detectSilences(samples, SR)
    expect(silences[0].startSec).toBeCloseTo(0, 1)
    expect(silences[0].endSec).toBeCloseTo(1.0, 1)
  })

  it('無音が無ければ空配列', () => {
    const samples = makePcm(2, [[0, 2]])
    expect(detectSilences(samples, SR).silences).toEqual([])
  })

  it('空入力でも例外にならない', () => {
    expect(detectSilences(new Int16Array(0), SR).silences).toEqual([])
    expect(computeFrameDb(new Int16Array(10), SR).db).toEqual([])
  })
})
