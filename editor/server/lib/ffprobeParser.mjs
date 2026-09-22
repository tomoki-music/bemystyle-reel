// ffprobe の JSON 出力 (`ffprobe -v error -print_format json -show_format -show_streams <path>`)
// をパースし、アプリが必要とするメタデータへ正規化する純粋関数群。
// spawn 呼び出しは ffmpegRunner.mjs 側が担当し、このモジュールは文字列/オブジェクトの変換のみを行う
// （ffprobe を実際に起動せずにユニットテストできるようにするため）。

export class FfprobeParseError extends Error {
  constructor(message) {
    super(message)
    this.name = 'FfprobeParseError'
  }
}

/**
 * Display Matrix の side_data、または tags.rotate から回転角(度)を取得し、
 * 0/90/180/270 のうち最も近い値へ正規化する。どちらもなければ 0。
 *
 * @param {any} videoStream ffprobe streams[] のうち video のもの
 * @returns {number} 0 | 90 | 180 | 270
 */
export function extractRotationDegrees(videoStream) {
  const sideDataList = Array.isArray(videoStream?.side_data_list) ? videoStream.side_data_list : []
  const displayMatrix = sideDataList.find(
    (sd) => typeof sd?.side_data_type === 'string' && sd.side_data_type.includes('Display Matrix')
  )

  let raw
  if (displayMatrix && displayMatrix.rotation !== undefined && displayMatrix.rotation !== null) {
    raw = Number(displayMatrix.rotation)
  } else if (videoStream?.tags && videoStream.tags.rotate !== undefined) {
    raw = Number(videoStream.tags.rotate)
  }

  if (raw === undefined || !Number.isFinite(raw)) return 0

  let normalized = Math.round(raw / 90) * 90
  normalized = ((normalized % 360) + 360) % 360
  return normalized
}

/**
 * ffprobe の JSON 文字列（または既にパース済みのオブジェクト）から
 * アプリで使うメタデータを抽出する。
 *
 * @param {string | object} rawOutput
 * @returns {{
 *   durationSec: number,
 *   width: number,
 *   height: number,
 *   rotation: number,
 *   videoCodec: string,
 *   audioCodec: string | null,
 *   container: string,
 *   hasAudio: boolean,
 * }}
 */
export function parseFfprobeOutput(rawOutput) {
  let data
  if (typeof rawOutput === 'string') {
    try {
      data = JSON.parse(rawOutput)
    } catch {
      throw new FfprobeParseError('ffprobeの出力を解析できませんでした（不正なJSON）')
    }
  } else if (rawOutput && typeof rawOutput === 'object') {
    data = rawOutput
  } else {
    throw new FfprobeParseError('ffprobeの出力がありません')
  }

  const streams = Array.isArray(data?.streams) ? data.streams : []
  const videoStream = streams.find((s) => s?.codec_type === 'video')
  if (!videoStream) {
    throw new FfprobeParseError('動画ストリームが見つかりませんでした（映像を含まないファイルの可能性があります）')
  }
  const audioStream = streams.find((s) => s?.codec_type === 'audio')

  const rotation = extractRotationDegrees(videoStream)

  const codedWidth = Number(videoStream.width) || 0
  const codedHeight = Number(videoStream.height) || 0
  if (codedWidth <= 0 || codedHeight <= 0) {
    throw new FfprobeParseError('動画の解像度を取得できませんでした')
  }

  // rotation が 90 / 270 の場合、実際に表示される幅高さは coded の値を入れ替えたもの。
  const isSideways = rotation === 90 || rotation === 270
  const width = isSideways ? codedHeight : codedWidth
  const height = isSideways ? codedWidth : codedHeight

  const formatDuration = Number(data?.format?.duration)
  const streamDuration = Number(videoStream.duration)
  const durationSec = Number.isFinite(formatDuration) && formatDuration > 0
    ? formatDuration
    : (Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration : 0)

  if (!durationSec || durationSec <= 0) {
    throw new FfprobeParseError('動画の長さを取得できませんでした')
  }

  return {
    durationSec,
    width,
    height,
    rotation,
    videoCodec: typeof videoStream.codec_name === 'string' ? videoStream.codec_name : 'unknown',
    audioCodec: audioStream && typeof audioStream.codec_name === 'string' ? audioStream.codec_name : null,
    container: typeof data?.format?.format_name === 'string' ? data.format.format_name : 'unknown',
    hasAudio: Boolean(audioStream),
  }
}
