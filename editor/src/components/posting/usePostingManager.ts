import { useState, useCallback, useEffect, useMemo } from 'react'
import type React from 'react'
import type { Slide, TemplateInfo } from '../../types'
import type { AIPresetKey, CustomPreset } from '../../storyGenerator'

// ==============================
// Types
// ==============================
export type SnsCaption = {
  youtubeTitle: string
  youtubeDescription: string
  instagramCaption: string
  tiktokCaption?: string
  xCaption?: string
  hashtags: string[]
}

export type CaptionEditKey =
  | 'youtubeTitle'
  | 'youtubeDescription'
  | 'instagramCaption'
  | 'tiktokCaption'
  | 'xCaption'
  | 'hashtags'

export type PostChecklistKey =
  | 'downloaded'
  | 'captionChecked'
  | 'hashtagsChecked'
  | 'snsSelected'
  | 'posted'

export type PostedSns = 'instagram' | 'tiktok' | 'youtube' | 'x'

export type PostedRecord = {
  sns: PostedSns
  postedAt: string
  url: string
  memo: string
}

// ==============================
// Constants (exported for JSX use)
// ==============================
export const POST_CHECKLIST_ITEMS: { key: PostChecklistKey; label: string }[] = [
  { key: 'downloaded', label: '動画をダウンロードした' },
  { key: 'captionChecked', label: '投稿文を確認した' },
  { key: 'hashtagsChecked', label: 'ハッシュタグを確認した' },
  { key: 'snsSelected', label: '投稿先SNSを決めた' },
  { key: 'posted', label: '実際に投稿した' },
]

export const POSTED_SNS_LABELS: Record<PostedSns, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  x: 'X',
}

export const formatCaptionHashtags = (caption: SnsCaption) => {
  return caption.hashtags?.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ') ?? ''
}

export const formatYouTubeCaption = (caption: SnsCaption) => {
  return [
    caption.youtubeTitle,
    '',
    caption.youtubeDescription,
    '',
    formatCaptionHashtags(caption),
  ].join('\n')
}

export const formatInstagramCaption = (caption: SnsCaption) => {
  return [
    caption.instagramCaption,
    '',
    formatCaptionHashtags(caption),
  ].join('\n')
}

export const formatTikTokCaption = (caption: SnsCaption) => {
  return [
    caption.tiktokCaption || caption.instagramCaption,
    '',
    formatCaptionHashtags(caption),
  ].join('\n')
}

export const formatXCaption = (caption: SnsCaption) => {
  const baseCaption = caption.xCaption || caption.instagramCaption
  const shortCaption = baseCaption.length > 120
    ? `${baseCaption.slice(0, 117)}...`
    : baseCaption

  return [
    shortCaption,
    '',
    formatCaptionHashtags(caption),
  ].join('\n')
}

// ==============================
// Internal constants
// ==============================
const POST_CHECKLIST_STORAGE_KEY = 'reel-post-checklist'
const POSTED_RECORDS_STORAGE_KEY = 'reel-posted-records'

const DEFAULT_POST_CHECKLIST: Record<PostChecklistKey, boolean> = {
  downloaded: false,
  captionChecked: false,
  hashtagsChecked: false,
  snsSelected: false,
  posted: false,
}

const DEFAULT_POSTED_FORM: PostedRecord = {
  sns: 'instagram',
  postedAt: '',
  url: '',
  memo: '',
}

// ==============================
// Hook
// ==============================
type UsePostingManagerParams = {
  slides: Slide[]
  title: string
  selectedPresetKey: AIPresetKey | ''
  customPresets: CustomPreset[]
  selectedCustomPresetId: string
  selectedTemplateId: string
  simpleTemplateId: string | null
  aiTheme: string
  templates: TemplateInfo[]
  updateLatestHistory: (patch: { snsCaption?: SnsCaption }) => void
}

export function usePostingManager({
  slides,
  title,
  selectedPresetKey,
  customPresets,
  selectedCustomPresetId,
  selectedTemplateId,
  simpleTemplateId,
  aiTheme,
  templates,
  updateLatestHistory,
}: UsePostingManagerParams) {
  const [snsCaption, setSnsCaption] = useState<SnsCaption | null>(null)
  const [isGeneratingSnsCaption, setIsGeneratingSnsCaption] = useState(false)
  const [snsCaptionError, setSnsCaptionError] = useState('')
  const [copiedSnsField, setCopiedSnsField] = useState<string | null>(null)
  const [copiedAllCaption, setCopiedAllCaption] = useState(false)
  const [copiedCaptionLabel, setCopiedCaptionLabel] = useState('')
  const [editingCaptionKey, setEditingCaptionKey] = useState<CaptionEditKey | ''>('')
  const [editingCaptionText, setEditingCaptionText] = useState('')
  const [regeneratingCaptionKey, setRegeneratingCaptionKey] = useState<CaptionEditKey | ''>('')

  const [postChecklist, setPostChecklist] = useState<Record<PostChecklistKey, boolean>>(() => {
    try {
      const raw = localStorage.getItem(POST_CHECKLIST_STORAGE_KEY)
      if (!raw) return { ...DEFAULT_POST_CHECKLIST }
      const parsed = JSON.parse(raw) as Partial<Record<PostChecklistKey, boolean>>
      return {
        ...DEFAULT_POST_CHECKLIST,
        downloaded: parsed.downloaded === true,
        captionChecked: parsed.captionChecked === true,
        hashtagsChecked: parsed.hashtagsChecked === true,
        snsSelected: parsed.snsSelected === true,
        posted: parsed.posted === true,
      }
    } catch {
      return { ...DEFAULT_POST_CHECKLIST }
    }
  })

  const [postedRecords, setPostedRecords] = useState<PostedRecord[]>(() => {
    try {
      const raw = localStorage.getItem(POSTED_RECORDS_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []

      return parsed
        .filter((record): record is Partial<PostedRecord> => record && typeof record === 'object')
        .filter((record) => (
          record.sns === 'instagram' ||
          record.sns === 'tiktok' ||
          record.sns === 'youtube' ||
          record.sns === 'x'
        ))
        .map((record) => ({
          sns: record.sns as PostedSns,
          postedAt: typeof record.postedAt === 'string' ? record.postedAt : '',
          url: typeof record.url === 'string' ? record.url : '',
          memo: typeof record.memo === 'string' ? record.memo : '',
        }))
        .filter((record) => record.postedAt)
    } catch {
      return []
    }
  })

  const [postedForm, setPostedForm] = useState<PostedRecord>({ ...DEFAULT_POSTED_FORM })
  const [postedRecordsImportMessage, setPostedRecordsImportMessage] = useState('')
  const [postedRecordsImportError, setPostedRecordsImportError] = useState('')

  // localStorage persistence
  useEffect(() => {
    try {
      localStorage.setItem(POST_CHECKLIST_STORAGE_KEY, JSON.stringify(postChecklist))
    } catch {}
  }, [postChecklist])

  useEffect(() => {
    try {
      localStorage.setItem(POSTED_RECORDS_STORAGE_KEY, JSON.stringify(postedRecords))
    } catch {}
  }, [postedRecords])

  // Derived
  const isPostChecklistComplete = POST_CHECKLIST_ITEMS.every((item) => postChecklist[item.key])

  const postedReport = useMemo(() => {
    const counts: Record<PostedSns, number> = {
      instagram: 0,
      tiktok: 0,
      youtube: 0,
      x: 0,
    }

    postedRecords.forEach((record) => {
      counts[record.sns] += 1
    })

    const latest = [...postedRecords]
      .filter((record) => record.postedAt)
      .sort((a, b) => b.postedAt.localeCompare(a.postedAt))[0]

    return {
      total: postedRecords.length,
      counts,
      latest,
      urlCount: postedRecords.filter((record) => record.url.trim()).length,
    }
  }, [postedRecords])

  // ==============================
  // SNS caption callbacks
  // ==============================
  const generateSnsCaption = useCallback(async () => {
    setIsGeneratingSnsCaption(true)
    setSnsCaptionError('')
    setSnsCaption(null)
    setEditingCaptionKey('')
    setEditingCaptionText('')
    setRegeneratingCaptionKey('')
    const selectedCustomPreset = customPresets.find((p) => p.id === selectedCustomPresetId) ?? null
    try {
      const res = await fetch('/api/sns-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slides, title, selectedPresetKey, selectedCustomPreset, templateId: selectedTemplateId || simpleTemplateId || '' }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.message ?? '不明なエラー')
      const caption = data.caption as SnsCaption
      setSnsCaption(caption)
      updateLatestHistory({ snsCaption: caption })
    } catch (err) {
      setSnsCaptionError(String(err instanceof Error ? err.message : err))
    } finally {
      setIsGeneratingSnsCaption(false)
    }
  }, [slides, title, selectedPresetKey, customPresets, selectedCustomPresetId, selectedTemplateId, simpleTemplateId, updateLatestHistory])

  const regenerateCaptionPart = useCallback(async (key: CaptionEditKey) => {
    if (!snsCaption) return

    setRegeneratingCaptionKey(key)
    setSnsCaptionError('')
    setEditingCaptionKey('')
    setEditingCaptionText('')
    const selectedCustomPreset = customPresets.find((p) => p.id === selectedCustomPresetId) ?? null

    try {
      const res = await fetch('/api/sns-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slides,
          title,
          selectedPresetKey,
          selectedCustomPreset,
          templateId: selectedTemplateId || simpleTemplateId || '',
          regenerateTarget: key,
          currentCaption: snsCaption,
        }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.message ?? '不明なエラー')
      const caption = data.caption as SnsCaption
      setSnsCaption(caption)
      updateLatestHistory({ snsCaption: caption })
    } catch (err) {
      setSnsCaptionError(String(err instanceof Error ? err.message : err))
    } finally {
      setRegeneratingCaptionKey('')
    }
  }, [customPresets, selectedCustomPresetId, selectedPresetKey, selectedTemplateId, simpleTemplateId, slides, snsCaption, title, updateLatestHistory])

  const copySnsText = useCallback(async (field: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedSnsField(field)
      setTimeout(() => setCopiedSnsField(null), 2000)
    } catch {
      // clipboard API 非対応環境では無視
    }
  }, [])

  const copyAllCaptions = useCallback(async (caption: SnsCaption) => {
    const text = [
      caption.youtubeTitle,
      '',
      caption.youtubeDescription,
      '',
      caption.instagramCaption,
      '',
      caption.tiktokCaption || caption.instagramCaption,
      '',
      caption.xCaption || caption.instagramCaption,
      '',
      formatCaptionHashtags(caption),
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopiedAllCaption(true)
      setTimeout(() => setCopiedAllCaption(false), 3000)
    } catch {
      // clipboard API 非対応環境では無視
    }
  }, [])

  const copyCaptionText = useCallback(async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedCaptionLabel(label)
      setTimeout(() => setCopiedCaptionLabel(''), 3000)
    } catch {
      // clipboard API 非対応環境では無視
    }
  }, [])

  const startCaptionEdit = useCallback((key: CaptionEditKey, text: string) => {
    setEditingCaptionKey(key)
    setEditingCaptionText(text)
  }, [])

  const cancelCaptionEdit = useCallback(() => {
    setEditingCaptionKey('')
    setEditingCaptionText('')
  }, [])

  const saveCaptionEdit = useCallback(() => {
    if (!editingCaptionKey || !snsCaption) return

    const nextCaption: SnsCaption = (() => {
      switch (editingCaptionKey) {
        case 'hashtags':
          return {
            ...snsCaption,
            hashtags: editingCaptionText
              .split(/\s+/)
              .map((tag) => tag.trim().replace(/^#+/, ''))
              .filter(Boolean),
          }
        case 'youtubeTitle':
          return { ...snsCaption, youtubeTitle: editingCaptionText }
        case 'youtubeDescription':
          return { ...snsCaption, youtubeDescription: editingCaptionText }
        case 'instagramCaption':
          return { ...snsCaption, instagramCaption: editingCaptionText }
        case 'tiktokCaption':
          return { ...snsCaption, tiktokCaption: editingCaptionText }
        case 'xCaption':
          return { ...snsCaption, xCaption: editingCaptionText }
      }
    })()

    setSnsCaption(nextCaption)
    updateLatestHistory({ snsCaption: nextCaption })
    cancelCaptionEdit()
  }, [cancelCaptionEdit, editingCaptionKey, editingCaptionText, snsCaption, updateLatestHistory])

  // ==============================
  // Post checklist callbacks
  // ==============================
  const togglePostChecklist = useCallback((key: PostChecklistKey) => {
    setPostChecklist((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }, [])

  const resetPostChecklist = useCallback(() => {
    setPostChecklist({ ...DEFAULT_POST_CHECKLIST })
  }, [])

  // ==============================
  // Posted records callbacks
  // ==============================
  const resetPostedRecords = useCallback(() => {
    setPostedRecords([])
    setPostedForm({ ...DEFAULT_POSTED_FORM })
  }, [])

  const addPostedRecord = useCallback(() => {
    if (!postedForm.postedAt) return

    const nextRecord: PostedRecord = {
      sns: postedForm.sns,
      postedAt: postedForm.postedAt,
      url: postedForm.url.trim(),
      memo: postedForm.memo.trim(),
    }

    setPostedRecords((prev) => [...prev, nextRecord])
    setPostedForm({ ...DEFAULT_POSTED_FORM })
    setPostChecklist((prev) => ({
      ...prev,
      posted: true,
    }))
  }, [postedForm])

  const deletePostedRecord = useCallback((index: number) => {
    setPostedRecords((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const exportPostedRecordsCsv = useCallback(() => {
    if (postedRecords.length === 0) return

    const selectedTemplateName = selectedTemplateId || simpleTemplateId
      ? templates.find((t) => t.id === (selectedTemplateId || simpleTemplateId))?.name ?? (selectedTemplateId || simpleTemplateId)
      : ''
    const videoTheme = aiTheme.trim() || title
    const rows = [
      ['SNS', '投稿日', '投稿URL', 'メモ', '動画テーマ', 'テンプレート'],
      ...postedRecords.map((record) => [
        POSTED_SNS_LABELS[record.sns],
        record.postedAt,
        record.url,
        record.memo,
        videoTheme,
        selectedTemplateName,
      ]),
    ]

    const csv = rows
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `posted-records-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [aiTheme, postedRecords, selectedTemplateId, simpleTemplateId, templates, title])

  const exportPostedRecordsJson = useCallback(() => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      postedRecords,
      postChecklist,
      postedReport,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8;',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `posted-records-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [postChecklist, postedRecords, postedReport])

  const handleImportPostedRecordsJson = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setPostedRecordsImportMessage('')
    setPostedRecordsImportError('')

    try {
      const text = await file.text()
      const data = JSON.parse(text) as {
        postedRecords?: unknown
        postChecklist?: unknown
      }

      if (!Array.isArray(data.postedRecords)) {
        throw new Error('JSONの形式が正しくありません')
      }

      const importedRecords: PostedRecord[] = data.postedRecords.map((record) => {
        if (!record || typeof record !== 'object') {
          throw new Error('JSONの形式が正しくありません')
        }
        const candidate = record as Partial<PostedRecord>
        if (
          candidate.sns !== 'instagram' &&
          candidate.sns !== 'tiktok' &&
          candidate.sns !== 'youtube' &&
          candidate.sns !== 'x'
        ) {
          throw new Error('JSONの形式が正しくありません')
        }
        if (
          typeof candidate.postedAt !== 'string' ||
          typeof candidate.url !== 'string' ||
          typeof candidate.memo !== 'string'
        ) {
          throw new Error('JSONの形式が正しくありません')
        }

        return {
          sns: candidate.sns,
          postedAt: candidate.postedAt,
          url: candidate.url,
          memo: candidate.memo,
        }
      })

      if (data.postChecklist !== undefined) {
        if (!data.postChecklist || typeof data.postChecklist !== 'object') {
          throw new Error('JSONの形式が正しくありません')
        }
        const importedChecklist = data.postChecklist as Partial<Record<PostChecklistKey, unknown>>
        setPostChecklist({
          downloaded: importedChecklist.downloaded === true,
          captionChecked: importedChecklist.captionChecked === true,
          hashtagsChecked: importedChecklist.hashtagsChecked === true,
          snsSelected: importedChecklist.snsSelected === true,
          posted: importedChecklist.posted === true,
        })
      }

      setPostedRecords(importedRecords)
      setPostedRecordsImportMessage('投稿記録を復元しました')
    } catch {
      setPostedRecordsImportError('JSONの形式が正しくありません')
    }
  }, [])

  return {
    // SNS caption state
    snsCaption,
    setSnsCaption,
    isGeneratingSnsCaption,
    snsCaptionError,
    copiedSnsField,
    copiedAllCaption,
    copiedCaptionLabel,
    editingCaptionKey,
    editingCaptionText,
    setEditingCaptionText,
    regeneratingCaptionKey,
    // Post checklist state
    postChecklist,
    isPostChecklistComplete,
    // Posted records state
    postedRecords,
    postedForm,
    setPostedForm,
    postedRecordsImportMessage,
    postedRecordsImportError,
    postedReport,
    // SNS caption callbacks
    generateSnsCaption,
    regenerateCaptionPart,
    copySnsText,
    copyAllCaptions,
    copyCaptionText,
    startCaptionEdit,
    cancelCaptionEdit,
    saveCaptionEdit,
    // Post checklist callbacks
    togglePostChecklist,
    resetPostChecklist,
    // Posted records callbacks
    resetPostedRecords,
    addPostedRecord,
    deletePostedRecord,
    exportPostedRecordsCsv,
    exportPostedRecordsJson,
    handleImportPostedRecordsJson,
  }
}
