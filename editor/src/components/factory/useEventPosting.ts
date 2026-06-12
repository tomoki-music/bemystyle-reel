import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { EventPostRecord, ReelBackupData, EditPreset, MmmEventPreset } from '../../types'
import type { SnsCaption } from '../posting/usePostingManager'

export type EventPostChecklistKey =
  | 'downloaded'
  | 'captionChecked'
  | 'qrChecked'
  | 'urlChecked'
  | 'bgmChecked'
  | 'postDateEntered'

export type EventPostRecordForm = {
  sns: EventPostRecord['sns']
  postDate: string
  postUrl: string
  memo: string
}

export type EventPostFilter = {
  sns: string
  keyword: string
  postDate: string
  urlStatus: string
}

const EVENT_POST_CHECKLIST_KEY = 'bemystyle-reel-event-post-checklist'
const EVENT_POST_DATE_KEY = 'bemystyle-reel-event-post-date'
const EVENT_POST_RECORDS_KEY = 'bemystyle-reel-event-post-records'
const MMM_EVENT_PRESETS_KEY_LOCAL = 'bemystyle-reel-mmm-event-presets'
const EDIT_PRESETS_KEY_LOCAL = 'bemystyle-reel-edit-presets'

export const EVENT_POST_RECORD_SNS_OPTIONS: { value: EventPostRecord['sns']; label: string }[] = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'x', label: 'X' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'other', label: 'その他' },
]

const DEFAULT_EVENT_POST_RECORD_FORM: EventPostRecordForm = {
  sns: 'instagram',
  postDate: '',
  postUrl: '',
  memo: '',
}

export const DEFAULT_EVENT_POST_CHECKLIST: Record<EventPostChecklistKey, boolean> = {
  downloaded: false,
  captionChecked: false,
  qrChecked: false,
  urlChecked: false,
  bgmChecked: false,
  postDateEntered: false,
}

export const EVENT_POST_CHECKLIST_ITEMS: { key: EventPostChecklistKey; label: string }[] = [
  { key: 'downloaded', label: '動画をダウンロードした' },
  { key: 'captionChecked', label: 'SNS投稿文を確認した' },
  { key: 'qrChecked', label: 'QRコードを確認した' },
  { key: 'urlChecked', label: 'イベントURLを確認した' },
  { key: 'bgmChecked', label: 'BGMを確認した' },
  { key: 'postDateEntered', label: '投稿日を入力した' },
]

interface UseEventPostingProps {
  qrFileName: string
  bgmFileName: string
  mmmEventForm: { url: string; title: string }
  snsCaption: SnsCaption | null
  selectedMmmEventPresetId: string
  aiTheme: string
  editPresets: EditPreset[]
  mmmEventPresets: MmmEventPreset[]
  setMmmEventPresets: React.Dispatch<React.SetStateAction<MmmEventPreset[]>>
  setEditPresets: React.Dispatch<React.SetStateAction<EditPreset[]>>
}

export function useEventPosting({
  qrFileName,
  bgmFileName,
  mmmEventForm,
  snsCaption,
  selectedMmmEventPresetId,
  aiTheme,
  editPresets,
  mmmEventPresets,
  setMmmEventPresets,
  setEditPresets,
}: UseEventPostingProps) {
  const [eventPostChecklist, setEventPostChecklist] = useState<Record<EventPostChecklistKey, boolean>>(() => {
    try {
      const raw = localStorage.getItem(EVENT_POST_CHECKLIST_KEY)
      if (!raw) return { ...DEFAULT_EVENT_POST_CHECKLIST }
      const parsed = JSON.parse(raw) as Partial<Record<EventPostChecklistKey, boolean>>
      return {
        ...DEFAULT_EVENT_POST_CHECKLIST,
        downloaded: parsed.downloaded === true,
        captionChecked: parsed.captionChecked === true,
        qrChecked: parsed.qrChecked === true,
        urlChecked: parsed.urlChecked === true,
        bgmChecked: parsed.bgmChecked === true,
        postDateEntered: parsed.postDateEntered === true,
      }
    } catch {
      return { ...DEFAULT_EVENT_POST_CHECKLIST }
    }
  })

  const [eventPostDate, setEventPostDate] = useState(() => {
    try { return localStorage.getItem(EVENT_POST_DATE_KEY) ?? '' } catch { return '' }
  })

  const [eventPostRecords, setEventPostRecords] = useState<EventPostRecord[]>(() => {
    try {
      const raw = localStorage.getItem(EVENT_POST_RECORDS_KEY)
      if (!raw) return []
      return JSON.parse(raw) as EventPostRecord[]
    } catch { return [] }
  })

  const [eventPostRecordForm, setEventPostRecordForm] = useState<EventPostRecordForm>({ ...DEFAULT_EVENT_POST_RECORD_FORM })

  const [eventPostFilter, setEventPostFilter] = useState<EventPostFilter>({
    sns: 'all',
    keyword: '',
    postDate: '',
    urlStatus: 'all',
  })

  const [backupImportMessage, setBackupImportMessage] = useState('')
  const [backupImportError, setBackupImportError] = useState('')

  // Phase19-I: チェックリスト 永続化
  useEffect(() => {
    try { localStorage.setItem(EVENT_POST_CHECKLIST_KEY, JSON.stringify(eventPostChecklist)) } catch {}
  }, [eventPostChecklist])

  useEffect(() => {
    try { localStorage.setItem(EVENT_POST_DATE_KEY, eventPostDate) } catch {}
    if (eventPostDate) {
      setEventPostChecklist((prev) => prev.postDateEntered ? prev : { ...prev, postDateEntered: true })
    }
  }, [eventPostDate])

  // Phase19-I: 自動チェック補助
  useEffect(() => {
    if (qrFileName) setEventPostChecklist((prev) => prev.qrChecked ? prev : { ...prev, qrChecked: true })
  }, [qrFileName])

  useEffect(() => {
    if (bgmFileName) setEventPostChecklist((prev) => prev.bgmChecked ? prev : { ...prev, bgmChecked: true })
  }, [bgmFileName])

  useEffect(() => {
    if (mmmEventForm.url.trim()) setEventPostChecklist((prev) => prev.urlChecked ? prev : { ...prev, urlChecked: true })
  }, [mmmEventForm.url])

  useEffect(() => {
    if (snsCaption) setEventPostChecklist((prev) => prev.captionChecked ? prev : { ...prev, captionChecked: true })
  }, [snsCaption])

  // Phase19-K: 投稿記録 永続化
  useEffect(() => {
    try { localStorage.setItem(EVENT_POST_RECORDS_KEY, JSON.stringify(eventPostRecords)) } catch {}
  }, [eventPostRecords])

  // Phase19-I: チェックリスト操作
  const toggleEventPostChecklist = useCallback((key: EventPostChecklistKey) => {
    setEventPostChecklist((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  // Phase19-K: 投稿記録 操作
  const saveEventPostRecord = useCallback(() => {
    if (!eventPostRecordForm.sns || !eventPostRecordForm.postDate) return
    const record: EventPostRecord = {
      id: `epr-${Date.now()}`,
      eventPresetId: selectedMmmEventPresetId || undefined,
      eventTitle: mmmEventForm.title || aiTheme || '未設定イベント',
      sns: eventPostRecordForm.sns,
      postDate: eventPostRecordForm.postDate,
      postUrl: eventPostRecordForm.postUrl,
      memo: eventPostRecordForm.memo,
      createdAt: new Date().toISOString(),
    }
    setEventPostRecords((prev) => [record, ...prev])
    setEventPostRecordForm({ ...DEFAULT_EVENT_POST_RECORD_FORM })
  }, [eventPostRecordForm, selectedMmmEventPresetId, mmmEventForm.title, aiTheme])

  const deleteEventPostRecord = useCallback((id: string) => {
    setEventPostRecords((prev) => prev.filter((r) => r.id !== id))
  }, [])

  // Phase19-K/O/M: 派生値
  const { eventPostReport, eventDashboardStats, filteredEventPostRecords } = useMemo(() => {
    const counts: Record<EventPostRecord['sns'], number> = {
      instagram: 0, x: 0, tiktok: 0, youtube: 0, other: 0,
    }
    eventPostRecords.forEach((r) => { counts[r.sns] += 1 })
    const eventPostReport = {
      total: eventPostRecords.length,
      counts,
      urlCount: eventPostRecords.filter((r) => r.postUrl.trim()).length,
    }

    const currentMonth = new Date().toISOString().slice(0, 7)
    const thisMonthRecords = eventPostRecords.filter((r) => r.postDate.startsWith(currentMonth))

    const snsCounts: Record<EventPostRecord['sns'], number> = {
      instagram: 0, x: 0, tiktok: 0, youtube: 0, other: 0,
    }
    eventPostRecords.forEach((r) => { snsCounts[r.sns] += 1 })

    const recentRecords = [...eventPostRecords]
      .sort((a, b) => {
        const da = a.postDate || a.createdAt
        const db = b.postDate || b.createdAt
        return db.localeCompare(da)
      })
      .slice(0, 3)

    const postedTitles = new Set(eventPostRecords.map((r) => r.eventTitle.trim().toLowerCase()))
    const unpostedPresets = mmmEventPresets.filter(
      (p) => !p.id.startsWith('default-') && !postedTitles.has(p.title.trim().toLowerCase())
    )

    const eventDashboardStats = {
      thisMonthCount: thisMonthRecords.length,
      urlCount: eventPostRecords.filter((r) => r.postUrl.trim()).length,
      total: eventPostRecords.length,
      snsCounts,
      recentRecords,
      unpostedPresets,
    }

    const kw = eventPostFilter.keyword.trim().toLowerCase()
    const filteredEventPostRecords = eventPostRecords.filter((r) => {
      if (eventPostFilter.sns !== 'all' && r.sns !== eventPostFilter.sns) return false
      if (kw && !r.eventTitle.toLowerCase().includes(kw) && !r.memo.toLowerCase().includes(kw)) return false
      if (eventPostFilter.postDate && r.postDate !== eventPostFilter.postDate) return false
      if (eventPostFilter.urlStatus === 'with' && !r.postUrl.trim()) return false
      if (eventPostFilter.urlStatus === 'without' && r.postUrl.trim()) return false
      return true
    })

    return { eventPostReport, eventDashboardStats, filteredEventPostRecords }
  }, [eventPostRecords, eventPostFilter, mmmEventPresets])

  const isEventPostFilterActive = eventPostFilter.sns !== 'all'
    || eventPostFilter.keyword !== ''
    || eventPostFilter.postDate !== ''
    || eventPostFilter.urlStatus !== 'all'

  const eventPostChecklistCount = EVENT_POST_CHECKLIST_ITEMS.filter((item) => eventPostChecklist[item.key]).length
  const isEventPostChecklistComplete = eventPostChecklistCount === EVENT_POST_CHECKLIST_ITEMS.length

  // Phase19-L: CSV出力
  const exportEventPostRecordsCsv = useCallback(() => {
    if (filteredEventPostRecords.length === 0) return
    const csvEscape = (value: string) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const headers = ['イベント名', 'SNS', '投稿日', '投稿URL', 'メモ', '作成日']
    const snsLabel = (sns: EventPostRecord['sns']) =>
      EVENT_POST_RECORD_SNS_OPTIONS.find((o) => o.value === sns)?.label ?? sns
    const rows = filteredEventPostRecords.map((r) => [
      csvEscape(r.eventTitle),
      csvEscape(snsLabel(r.sns)),
      csvEscape(r.postDate),
      csvEscape(r.postUrl),
      csvEscape(r.memo),
      csvEscape(r.createdAt.slice(0, 10)),
    ].join(','))
    const csv = [headers.map(csvEscape).join(','), ...rows].join('\n')
    const bom = '﻿'
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
    const today = new Date().toISOString().slice(0, 10)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `event-post-records-${today}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filteredEventPostRecords])

  // Phase19-N: バックアップ出力
  const exportReelBackupJson = useCallback(() => {
    const data: ReelBackupData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      eventPostRecords,
      eventPostChecklist,
      eventPostDate,
      mmmEventPresets,
      editPresets,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json;charset=utf-8;',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bemystyle-reel-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [editPresets, eventPostChecklist, eventPostDate, eventPostRecords, mmmEventPresets])

  // Phase19-N: バックアップ復元
  const handleImportReelBackupJson = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setBackupImportMessage('')
    setBackupImportError('')

    try {
      const text = await file.text()
      const data = JSON.parse(text) as unknown

      if (!data || typeof data !== 'object') throw new Error()
      const d = data as Partial<ReelBackupData>

      if (d.version !== 1) {
        setBackupImportError('バックアップJSONの形式が正しくありません。')
        return
      }

      if (!window.confirm('現在の保存データをバックアップ内容で上書きします。よろしいですか？')) return

      try {
        if (Array.isArray(d.eventPostRecords)) {
          setEventPostRecords(d.eventPostRecords as EventPostRecord[])
          localStorage.setItem(EVENT_POST_RECORDS_KEY, JSON.stringify(d.eventPostRecords))
        }
        if (d.eventPostChecklist && typeof d.eventPostChecklist === 'object') {
          const cl = d.eventPostChecklist as Record<string, boolean>
          setEventPostChecklist({
            downloaded: cl.downloaded === true,
            captionChecked: cl.captionChecked === true,
            qrChecked: cl.qrChecked === true,
            urlChecked: cl.urlChecked === true,
            bgmChecked: cl.bgmChecked === true,
            postDateEntered: cl.postDateEntered === true,
          })
          localStorage.setItem(EVENT_POST_CHECKLIST_KEY, JSON.stringify(d.eventPostChecklist))
        }
        if (typeof d.eventPostDate === 'string') {
          setEventPostDate(d.eventPostDate)
          localStorage.setItem(EVENT_POST_DATE_KEY, d.eventPostDate)
        }
        if (Array.isArray(d.mmmEventPresets)) {
          setMmmEventPresets(d.mmmEventPresets as MmmEventPreset[])
          localStorage.setItem(MMM_EVENT_PRESETS_KEY_LOCAL, JSON.stringify(d.mmmEventPresets))
        }
        if (Array.isArray(d.editPresets)) {
          setEditPresets(d.editPresets as EditPreset[])
          localStorage.setItem(EDIT_PRESETS_KEY_LOCAL, JSON.stringify(d.editPresets))
        }
        setBackupImportMessage('バックアップを復元しました。')
      } catch {
        setBackupImportError('復元に失敗しました。')
      }
    } catch {
      setBackupImportError('バックアップJSONの形式が正しくありません。')
    }
  }, [setMmmEventPresets, setEditPresets])

  return {
    eventPostChecklist,
    eventPostDate,
    eventPostRecords,
    eventPostRecordForm,
    eventPostFilter,
    setEventPostChecklist,
    setEventPostDate,
    setEventPostRecordForm,
    setEventPostFilter,
    toggleEventPostChecklist,
    saveEventPostRecord,
    deleteEventPostRecord,
    exportEventPostRecordsCsv,
    exportReelBackupJson,
    handleImportReelBackupJson,
    eventPostChecklistCount,
    isEventPostChecklistComplete,
    eventPostReport,
    eventDashboardStats,
    filteredEventPostRecords,
    isEventPostFilterActive,
    backupImportMessage,
    backupImportError,
  }
}
