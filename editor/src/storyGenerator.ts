export type AIPresetKey =
  | 'note'
  | 'singing_pr'
  | 'session'
  | 'youtube_shorts'
  | 'instagram_reels'

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
  customPreset?: CustomPresetPayload | null
): Promise<GeneratedStory> {
  const res = await fetch('/api/generate-story', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      theme,
      presetKey: presetKey || undefined,
      customPreset: customPreset || undefined,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { message?: string }).message ?? `HTTP ${res.status}`)
  }
  const data = (await res.json()) as { story: GeneratedStory }
  return data.story
}
