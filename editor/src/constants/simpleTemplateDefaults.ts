import type { SimpleTemplateType } from '../types'

export type SimpleTemplateDefault = {
  visualStyleTags: string[]
  bgmFileName: string
  ctaLabel: string
}

export const SIMPLE_TEMPLATE_DEFAULTS: Record<SimpleTemplateType, SimpleTemplateDefault> = {
  'mmm-event': {
    visualStyleTags: ['音楽', '演奏', 'ライブ感', 'ダイナミック'],
    bgmFileName: 'bgm.mp3',
    ctaLabel: 'イベント詳細を見る',
  },
  'free-diagnosis': {
    visualStyleTags: ['音楽', '上品', 'アーティスト', 'ポップ'],
    bgmFileName: 'bgm.mp3',
    ctaLabel: '無料診断に申し込む',
  },
  'note-article': {
    visualStyleTags: ['上品', 'ミステリアス', 'アーティスト'],
    bgmFileName: 'bgm.mp3',
    ctaLabel: '記事を読む',
  },
  'youtube-video': {
    visualStyleTags: ['かっこいい', 'ダイナミック', 'ポップ'],
    bgmFileName: 'bgm.mp3',
    ctaLabel: '動画を見る',
  },
  'music-community': {
    visualStyleTags: ['音楽', '青春', 'ライブ感', 'かわいい'],
    bgmFileName: 'bgm.mp3',
    ctaLabel: 'コミュニティに参加する',
  },
  custom: {
    visualStyleTags: [],
    bgmFileName: '',
    ctaLabel: '',
  },
}
