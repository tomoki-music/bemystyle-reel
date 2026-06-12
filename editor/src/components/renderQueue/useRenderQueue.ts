import { useState, useCallback, useRef } from 'react'
import type { Slide } from '../../types'

export type RenderQueueItem = {
  id: string
  variantName: string
  status: 'pending' | 'rendering' | 'completed' | 'failed'
  outputPath?: string
  renderedAt?: string
  slidesSnapshot?: Slide[]
  snapshotCreatedAt?: string
}

export const RENDER_QUEUE_KEY = 'bemystyle-reel-render-queue'

function persist(items: RenderQueueItem[]) {
  try { localStorage.setItem(RENDER_QUEUE_KEY, JSON.stringify(items)) } catch {}
}

export function useRenderQueue() {
  const [items, setItems] = useState<RenderQueueItem[]>(() => {
    try {
      const raw = localStorage.getItem(RENDER_QUEUE_KEY)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })

  const itemsRef = useRef<RenderQueueItem[]>(items)
  itemsRef.current = items

  // Used by useMassMode — adds item with mandatory snapshot, always appends
  const addToRenderQueue = useCallback((variantName: string, slidesSnapshot: Slide[]) => {
    const id = crypto.randomUUID()
    setItems(prev => {
      const next = [...prev, { id, variantName, status: 'pending' as const, slidesSnapshot }]
      itemsRef.current = next
      persist(next)
      return next
    })
    return id
  }, [])

  // Add single item by variantName (no snapshot), dedup by variantName
  const addVariantName = useCallback((variantName: string): void => {
    setItems(prev => {
      if (prev.some(q => q.variantName === variantName)) return prev
      const next = [...prev, { id: crypto.randomUUID(), variantName, status: 'pending' as const }]
      itemsRef.current = next
      persist(next)
      return next
    })
  }, [])

  // Add multiple items by variantNames (no snapshot), dedup — returns { added, skipped }
  const addVariantNames = useCallback((variantNames: string[]): { added: number, skipped: number } => {
    const existingNames = new Set(itemsRef.current.map(q => q.variantName))
    const toAdd: RenderQueueItem[] = []
    let added = 0, skipped = 0
    for (const variantName of variantNames) {
      if (existingNames.has(variantName)) {
        skipped++
      } else {
        toAdd.push({ id: crypto.randomUUID(), variantName, status: 'pending' as const })
        added++
        existingNames.add(variantName) // prevent dupes within the same batch
      }
    }
    if (toAdd.length > 0) {
      setItems(prev => {
        const prevNames = new Set(prev.map(q => q.variantName))
        const filtered = toAdd.filter(item => !prevNames.has(item.variantName))
        if (filtered.length === 0) return prev
        const next = [...prev, ...filtered]
        itemsRef.current = next
        persist(next)
        return next
      })
    }
    return { added, skipped }
  }, [])

  // Add single item with snapshot, dedup by variantName — returns id or null if duplicate
  const addSnapshotItem = useCallback((variantName: string, slidesSnapshot: Slide[]): string | null => {
    if (itemsRef.current.some(q => q.variantName === variantName)) return null
    const id = crypto.randomUUID()
    const newItem: RenderQueueItem = {
      id, variantName, status: 'pending' as const,
      slidesSnapshot, snapshotCreatedAt: new Date().toISOString(),
    }
    setItems(prev => {
      if (prev.some(q => q.variantName === variantName)) return prev
      const next = [...prev, newItem]
      itemsRef.current = next
      persist(next)
      return next
    })
    return id
  }, [])

  // Add pre-built RenderQueueItem[] (dedup by variantName) — returns actually-added items
  // Also syncs itemsRef immediately so subsequent renderQueueRef reads see the new state
  const addQueueItems = useCallback((newItems: RenderQueueItem[]): RenderQueueItem[] => {
    const existingNames = new Set(itemsRef.current.map(q => q.variantName))
    const toAdd = newItems.filter(item => !existingNames.has(item.variantName))
    if (toAdd.length === 0) return []
    setItems(prev => {
      const prevNames = new Set(prev.map(q => q.variantName))
      const filtered = toAdd.filter(item => !prevNames.has(item.variantName))
      if (filtered.length === 0) return prev
      const next = [...prev, ...filtered]
      itemsRef.current = next
      persist(next)
      return next
    })
    return toAdd
  }, [])

  const updateQueueItem = useCallback((id: string, patch: Partial<RenderQueueItem>) => {
    setItems(prev => {
      const next = prev.map(q => q.id === id ? { ...q, ...patch } : q)
      itemsRef.current = next
      persist(next)
      return next
    })
  }, [])

  const removeFromQueue = useCallback((id: string) => {
    setItems(prev => {
      const next = prev.filter(q => q.id !== id)
      persist(next)
      return next
    })
  }, [])

  const clearQueue = useCallback(() => {
    setItems(prev => {
      const rendering = prev.filter(q => q.status === 'rendering')
      persist(rendering)
      return rendering
    })
  }, [])

  return {
    items,
    itemsRef,
    addToRenderQueue,
    addVariantName,
    addVariantNames,
    addSnapshotItem,
    addQueueItems,
    updateQueueItem,
    removeFromQueue,
    clearQueue,
  }
}
