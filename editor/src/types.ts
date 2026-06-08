export type SlideLayout = "center" | "bottom" | "cta";

export interface Slide {
  id: number;
  durationSec: number;
  visible: boolean;
  headline: string;
  subline: string;
  emphasis: string;
  image: string;
  layout: SlideLayout;
  showParticles: boolean;
  showCTA?: boolean;
  ctaLabel?: string;
  ctaNote?: string;
  ctaUrl?: string;
  imagePrompt?: string;
}

export interface CTAConfig {
  qrImage: string;
}

export interface SlidesData {
  title: string;
  slides: Slide[];
  cta: CTAConfig;
}

export interface TemplateHints {
  imageCount: number;
  durationSec: number;
  ctaNote: string;
}

export interface TemplateInfo {
  id: string;
  name: string;
  hints: TemplateHints | null;
  favorite?: boolean;
  category?: string;
  description?: string;
  variables?: string[];
  thumbnail?: string;
  usageCount?: number;
}

export interface Template extends SlidesData {
  id: string;
  name: string;
  hints: TemplateHints | null;
  favorite?: boolean;
  category?: string;
  description?: string;
  variables?: string[];
  thumbnail?: string;
}

export type EditPreset = {
  id: string;
  name: string;
  visualStyleTags: string[];
  bgmFileName?: string;
  ctaLabel?: string;
  createdAt: string;
}

export type MmmEventPreset = {
  id: string;
  name: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  venue: string;
  price: string;
  url: string;
  message: string;
  createdAt: string;
}

export type EventPostRecord = {
  id: string;
  eventPresetId?: string;
  eventTitle: string;
  sns: 'youtube' | 'instagram' | 'tiktok' | 'x' | 'other';
  postDate: string;
  postUrl: string;
  memo: string;
  createdAt: string;
}

export type ReelAiConfig = {
  aiMode: 'real' | 'mock'
  dryRun: boolean
  testImageLimit: number | null
}

export type SimpleTemplateType =
  | 'mmm-event'
  | 'free-diagnosis'
  | 'note-article'
  | 'youtube-video'
  | 'music-community'
  | 'custom'

export type FreeDiagnosisForm = {
  campaignName: string
  targetAudience: string
  diagnosisMethod: string
  lineUrl: string
  message: string
}

export type NoteArticleForm = {
  articleTitle: string
  articleTheme: string
  targetReader: string
  articleUrl: string
  message: string
}

export type YoutubeVideoForm = {
  videoTitle: string
  videoTheme: string
  highlights: string
  youtubeUrl: string
  message: string
}

export type MusicCommunityForm = {
  communityName: string
  activities: string
  targetAudience: string
  joinUrl: string
  message: string
}

export type ReelBackupData = {
  version: 1;
  exportedAt: string;
  eventPostRecords: EventPostRecord[];
  eventPostChecklist: Record<string, boolean>;
  eventPostDate: string;
  mmmEventPresets: MmmEventPreset[];
  editPresets: EditPreset[];
}
