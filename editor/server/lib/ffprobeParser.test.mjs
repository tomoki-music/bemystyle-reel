import { describe, it, expect } from 'vitest'
import { parseFfprobeOutput, extractRotationDegrees, FfprobeParseError } from './ffprobeParser.mjs'

function baseVideoStream(overrides = {}) {
  return {
    codec_type: 'video',
    codec_name: 'h264',
    width: 1080,
    height: 1920,
    duration: '10.0',
    ...overrides,
  }
}

function baseAudioStream(overrides = {}) {
  return {
    codec_type: 'audio',
    codec_name: 'aac',
    ...overrides,
  }
}

describe('extractRotationDegrees', () => {
  it('Display Matrix side_data から回転角を取得する（-90 -> 270 に正規化）', () => {
    const stream = baseVideoStream({
      side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }],
    })
    expect(extractRotationDegrees(stream)).toBe(270)
  })

  it('Display Matrix rotation=90 はそのまま90', () => {
    const stream = baseVideoStream({
      side_data_list: [{ side_data_type: 'Display Matrix', rotation: 90 }],
    })
    expect(extractRotationDegrees(stream)).toBe(90)
  })

  it('tags.rotate へのフォールバック', () => {
    const stream = baseVideoStream({ tags: { rotate: '180' } })
    expect(extractRotationDegrees(stream)).toBe(180)
  })

  it('回転情報が無ければ0', () => {
    const stream = baseVideoStream()
    expect(extractRotationDegrees(stream)).toBe(0)
  })

  it('Display Matrixが優先され、tags.rotateより優先される', () => {
    const stream = baseVideoStream({
      side_data_list: [{ side_data_type: 'Display Matrix', rotation: 90 }],
      tags: { rotate: '180' },
    })
    expect(extractRotationDegrees(stream)).toBe(90)
  })
})

describe('parseFfprobeOutput', () => {
  it('回転なしの横動画を正しくパースする', () => {
    const output = {
      format: { duration: '12.5', format_name: 'mov,mp4,m4a' },
      streams: [baseVideoStream({ width: 1920, height: 1080 }), baseAudioStream()],
    }
    const result = parseFfprobeOutput(output)
    expect(result).toMatchObject({
      durationSec: 12.5,
      width: 1920,
      height: 1080,
      rotation: 0,
      videoCodec: 'h264',
      audioCodec: 'aac',
      hasAudio: true,
    })
  })

  it('90度回転の場合、coded width/heightを入れ替えて表示サイズにする', () => {
    const output = {
      format: { duration: '5', format_name: 'mov' },
      streams: [
        baseVideoStream({
          width: 1920, // coded (物理)
          height: 1080,
          side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }],
        }),
      ],
    }
    const result = parseFfprobeOutput(output)
    expect(result.rotation).toBe(270)
    // 90/270度回転なので、表示上は縦動画になる（coded 1920x1080 -> 表示 1080x1920）
    expect(result.width).toBe(1080)
    expect(result.height).toBe(1920)
  })

  it('音声ストリームが無い場合 hasAudio=false, audioCodec=null', () => {
    const output = {
      format: { duration: '3', format_name: 'mp4' },
      streams: [baseVideoStream()],
    }
    const result = parseFfprobeOutput(output)
    expect(result.hasAudio).toBe(false)
    expect(result.audioCodec).toBeNull()
  })

  it('動画ストリームが無い場合はエラー', () => {
    const output = { format: { duration: '3' }, streams: [baseAudioStream()] }
    expect(() => parseFfprobeOutput(output)).toThrow(FfprobeParseError)
  })

  it('不正なJSON文字列はエラー', () => {
    expect(() => parseFfprobeOutput('{not valid json')).toThrow(FfprobeParseError)
  })

  it('streamsが無い/壊れている場合はエラー', () => {
    expect(() => parseFfprobeOutput({})).toThrow(FfprobeParseError)
    expect(() => parseFfprobeOutput(null)).toThrow(FfprobeParseError)
  })

  it('JSON文字列としても解釈できる', () => {
    const output = JSON.stringify({
      format: { duration: '7', format_name: 'mp4' },
      streams: [baseVideoStream({ width: 640, height: 480 })],
    })
    const result = parseFfprobeOutput(output)
    expect(result.width).toBe(640)
    expect(result.height).toBe(480)
  })
})
