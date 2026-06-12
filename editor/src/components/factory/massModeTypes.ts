import type { GeneratedStory } from '../../storyGenerator'

export type MassTemplateType = 'mmm-event' | 'free-diagnosis' | 'note-article'

export const MASS_MODE_TEMPLATES: { type: MassTemplateType; label: string }[] = [
  { type: 'mmm-event',      label: 'MMMイベント告知' },
  { type: 'free-diagnosis', label: '無料歌唱診断' },
  { type: 'note-article',   label: 'Note記事紹介' },
]

export type MassThemeStatus = 'pending' | 'running' | 'completed' | 'failed'
export type MassImageStatus = 'idle' | 'running' | 'completed' | 'failed'
export type MassPostChecklist = { mp4Checked: boolean; captionReady: boolean; platformDecided: boolean; posted: boolean }
export type MassThemeItem = {
  id: string
  templateType: MassTemplateType
  theme: string
  status: MassThemeStatus
  resultMessage?: string
  storyResult?: GeneratedStory
  imageStatus?: MassImageStatus
  imageUrls?: string[]
  imageError?: string
  renderQueued?: boolean
  renderQueueId?: string
  renderQueueError?: string
  postCaption?: string
  postChecklist?: MassPostChecklist
}
export type MassQueueSummary = { total: number; completed: number; failed: number; stopped: boolean }
export type MassPipelineMode = 'story-only' | 'story-image' | 'story-image-queue'

export function getMassItemProgress(item: MassThemeItem): { completedSteps: number; percent: number } {
  if (item.postChecklist?.posted) return { completedSteps: 4, percent: 100 }
  if (item.renderQueued) return { completedSteps: 3, percent: 75 }
  if (item.imageStatus === 'completed') return { completedSteps: 2, percent: 50 }
  if (item.storyResult) return { completedSteps: 1, percent: 25 }
  return { completedSteps: 0, percent: 0 }
}

export function getMassNextAction(item: MassThemeItem): string {
  if (item.postChecklist?.posted) return '完了です 🎉'
  if (item.renderQueued) {
    return (item.postChecklist?.mp4Checked) ? 'キャプションを確認しましょう' : '動画完成を待ちましょう'
  }
  if (item.imageStatus === 'completed') return '動画キューへ追加しましょう'
  if (item.storyResult) return '画像生成へ進みましょう'
  return 'まずStoryを生成してください'
}
