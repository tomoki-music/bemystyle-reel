// ローカルAIテロップ動画機能の型定義。
// バックエンド (editor/server/lib/jobStore.mjs createInitial) が返すジョブJSONの形に対応する。

export type CaptionType = 'normal' | 'main' | 'sub' | 'emphasis' | 'heading' | 'annotation'

export type JobStatus =
  | 'uploaded'
  | 'probing'
  | 'extracting_audio'
  | 'transcribing'
  | 'ready_for_edit'
  | 'rendering'
  | 'completed'
  | 'failed'

export interface Caption {
  id: string
  startSec: number
  endSec: number
  text: string
  captionType: CaptionType
  // Phase1のUIでは未使用(将来のemphasisハイライト機能向けに予約)。
  emphasisText?: string | null
  displayOrder: number
}

// Whisperの生segment(分割前・読み取り専用のraw transcription)。
// captions はここから決定的に分割生成した編集用データで、こちらは編集画面から変更しない。
export interface RawSegment {
  startSec: number
  endSec: number
  text: string
}

export interface LocalCaptionJob {
  id: string
  title: string
  sourcePath: string
  sourceFilename: string
  sourceSize: number
  durationSec: number | null
  width: number | null
  height: number | null
  rotation: number | null
  videoCodec: string | null
  audioCodec: string | null
  container: string | null
  hasAudio: boolean | null
  outputPath: string | null
  status: JobStatus
  errorMessage: string | null
  transcriptionNote: string | null
  captions: Caption[]
  // 既存ジョブ(この機能追加前に作成されたもの)には無い場合があるためoptional。
  rawSegments?: RawSegment[]
  createdAt: string
  updatedAt: string
  transcribedAt: string | null
  renderedAt: string | null
  // レンダー進捗（0-100）。レンダー中以外はnull。バックエンドの追加フィールド。
  renderProgress?: number | null
}

export interface BrowseEntry {
  name: string
  path: string
  isDirectory: boolean
  isVideo: boolean
  size: number | null
}

export interface RootInfo {
  path: string
  available: boolean
}

export interface ApiResult<T> {
  ok: boolean
  message?: string
  job?: LocalCaptionJob
  jobs?: LocalCaptionJob[]
  entries?: BrowseEntry[]
  path?: string | null
  inputRoots?: RootInfo[]
  outputRoot?: RootInfo
  fontWarning?: string | null
  [key: string]: unknown
}
