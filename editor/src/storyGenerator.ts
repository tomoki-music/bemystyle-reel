export type AIPresetKey =
  | 'note'
  | 'singing_pr'
  | 'session'
  | 'youtube_shorts'
  | 'instagram_reels'
  | 'mmm_event'

export interface GeneratedSlideContent {
  headline: string
  subline?: string
  emphasis?: string
  imagePrompt?: string
}

export interface GeneratedStory {
  slides: GeneratedSlideContent[]
  variables: {
    title: string
    subtitle: string
    cta: string
  }
  warning?: string
}

export type CustomPresetPayload = {
  tone: string
  targetAudience: string
  platform: string
  imageStyle: string
  ctaText: string
}

export type CustomPreset = {
  id: string
  name: string
  presetKey: AIPresetKey | ''
  tone: string
  targetAudience: string
  platform: string
  imageStyle: string
  ctaText: string
  createdAt: string
  isFavorite?: boolean
  useCount?: number
  sortOrder?: number
  usedAt?: string[]
  lastUsedAt?: string
}

export async function generateStory(
  theme: string,
  presetKey?: AIPresetKey | '',
  customPreset?: CustomPresetPayload | null,
  visualStyleTags?: string[]
): Promise<GeneratedStory> {
  const res = await fetch('/api/generate-story', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      theme,
      presetKey: presetKey || undefined,
      customPreset: customPreset || undefined,
      visualStyleTags: visualStyleTags && visualStyleTags.length > 0 ? visualStyleTags : undefined,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { message?: string; errorType?: string }
    const err = new Error(data.message ?? `HTTP ${res.status}`)
    if (data.errorType === 'quota') (err as Error & { errorType: string }).errorType = 'quota'
    throw err
  }
  const data = (await res.json()) as { story: GeneratedStory; warning?: string }
  return { ...data.story, warning: data.warning }
}
