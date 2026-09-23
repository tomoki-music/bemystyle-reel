import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.mock('node-fetch', () => ({ default: (...args) => mockFetch(...args) }))

const {
  planClassificationBatches,
  validateBatchResult,
  classifyJobCaptions,
  requestClassification,
  ClassificationApiError,
  ClassificationTimeoutError,
  DEFAULT_BATCH_SIZE,
} = await import('./captionClassifier.mjs')

beforeEach(() => {
  mockFetch.mockReset()
})

function makeCaptions(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `cap-${i}`,
    startSec: i * 3,
    endSec: i * 3 + 2,
    text: `text-${i}`,
    captionType: 'normal',
    emphasisText: null,
    displayOrder: i,
  }))
}

function okResponse(classifications) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ classifications }) } }] }),
  }
}

describe('planClassificationBatches', () => {
  it('290件を30〜50件程度のバッチへ分割し、対象IDの合計が全件と一致する', () => {
    const captions = makeCaptions(290)
    const batches = planClassificationBatches(captions, 42)
    expect(batches.length).toBe(7)
    for (const b of batches) {
      expect(b.targetIds.length).toBeGreaterThanOrEqual(30)
      expect(b.targetIds.length).toBeLessThanOrEqual(50)
    }
    const allIds = batches.flatMap((b) => b.targetIds)
    expect(allIds.length).toBe(290)
    expect(new Set(allIds).size).toBe(290) // 重複なし
  })

  it('各バッチの対象IDは他のバッチと重複しない（1回だけ分類される）', () => {
    const captions = makeCaptions(100)
    const batches = planClassificationBatches(captions, 42)
    const seen = new Set()
    for (const b of batches) {
      for (const id of b.targetIds) {
        expect(seen.has(id)).toBe(false)
        seen.add(id)
      }
    }
  })

  it('前後の文脈captionは対象IDに含まれない', () => {
    const captions = makeCaptions(100)
    const batches = planClassificationBatches(captions, 42)
    for (const b of batches) {
      const targetSet = new Set(b.targetIds)
      for (const ctx of [...b.contextBefore, ...b.contextAfter]) {
        expect(targetSet.has(ctx.id)).toBe(false)
      }
    }
  })

  it('空配列なら空バッチになる', () => {
    expect(planClassificationBatches([])).toEqual([])
  })
})

describe('validateBatchResult', () => {
  const batch = { targetIds: ['a', 'b', 'c'] }

  it('全ID・正しいcaptionTypeなら合格', () => {
    const r = validateBatchResult(batch, [
      { id: 'a', captionType: 'normal' },
      { id: 'b', captionType: 'main' },
      { id: 'c', captionType: 'sub' },
    ])
    expect(r.ok).toBe(true)
    expect(r.result.get('a')).toBe('normal')
    expect(r.result.get('b')).toBe('main')
    expect(r.result.get('c')).toBe('sub')
  })

  it('IDが欠損していれば不合格', () => {
    const r = validateBatchResult(batch, [
      { id: 'a', captionType: 'normal' },
      { id: 'b', captionType: 'main' },
    ])
    expect(r.ok).toBe(false)
    expect(r.missingCount).toBe(1)
  })

  it('未知IDが含まれていれば不合格', () => {
    const r = validateBatchResult(batch, [
      { id: 'a', captionType: 'normal' },
      { id: 'b', captionType: 'main' },
      { id: 'c', captionType: 'sub' },
      { id: 'unknown-id', captionType: 'normal' },
    ])
    expect(r.ok).toBe(false)
    expect(r.unknownCount).toBe(1)
  })

  it('重複IDが含まれていれば不合格', () => {
    const r = validateBatchResult(batch, [
      { id: 'a', captionType: 'normal' },
      { id: 'a', captionType: 'main' },
      { id: 'b', captionType: 'main' },
      { id: 'c', captionType: 'sub' },
    ])
    expect(r.ok).toBe(false)
    expect(r.duplicateCount).toBe(1)
  })

  it('不正なcaptionTypeが含まれていれば不合格', () => {
    const r = validateBatchResult(batch, [
      { id: 'a', captionType: 'normal' },
      { id: 'b', captionType: 'not-a-real-type' },
      { id: 'c', captionType: 'sub' },
    ])
    expect(r.ok).toBe(false)
    expect(r.invalidTypeCount).toBe(1)
  })
})

describe('requestClassification (OpenAI Structured Outputs)', () => {
  const batch = {
    targetIds: ['cap-0', 'cap-1'],
    items: [{ id: 'cap-0', text: 'a' }, { id: 'cap-1', text: 'b' }],
    contextBefore: [],
    contextAfter: [],
  }

  it('strict json_schema のresponse_formatでリクエストし、id/captionTypeのみ返させる', async () => {
    mockFetch.mockImplementation((url, opts) => {
      expect(url).toBe('https://api.openai.com/v1/chat/completions')
      const body = JSON.parse(opts.body)
      expect(body.response_format.type).toBe('json_schema')
      expect(body.response_format.json_schema.strict).toBe(true)
      expect(body.response_format.json_schema.schema.properties.classifications.items.properties).toHaveProperty('id')
      expect(body.response_format.json_schema.schema.properties.classifications.items.properties).toHaveProperty('captionType')
      expect(body.response_format.json_schema.schema.properties.classifications.items.additionalProperties).toBe(false)
      return Promise.resolve(okResponse([{ id: 'cap-0', captionType: 'normal' }, { id: 'cap-1', captionType: 'main' }]))
    })

    const result = await requestClassification(batch, 'sk-test')
    expect(result).toEqual([{ id: 'cap-0', captionType: 'normal' }, { id: 'cap-1', captionType: 'main' }])
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('タイムアウト時はClassificationTimeoutErrorを投げ、自動リトライしない', async () => {
    mockFetch.mockImplementation((url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('aborted')
        err.name = 'AbortError'
        reject(err)
      })
    }))
    await expect(requestClassification(batch, 'sk-test', { timeoutMs: 20 })).rejects.toBeInstanceOf(ClassificationTimeoutError)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('APIエラー応答はClassificationApiErrorを投げ、自動リトライしない', async () => {
    mockFetch.mockImplementation(() => Promise.resolve({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid api key' } }) }))
    await expect(requestClassification(batch, 'sk-bad')).rejects.toBeInstanceOf(ClassificationApiError)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('classifyJobCaptions (バッチオーケストレーション・不変条件)', () => {
  it('全バッチ成功時のみcaptionsへ反映し、id・順序・件数・本文・timestampは変更しない', async () => {
    const captions = makeCaptions(90)
    const job = { captions }
    const requestFn = vi.fn(async (batch) => batch.targetIds.map((id) => ({ id, captionType: 'sub' })))

    const result = await classifyJobCaptions(job, 'sk-test', { batchSize: 42, requestFn })
    expect(result.ok).toBe(true)
    expect(result.captions.length).toBe(90)
    result.captions.forEach((c, i) => {
      expect(c.id).toBe(captions[i].id)
      expect(c.text).toBe(captions[i].text)
      expect(c.startSec).toBe(captions[i].startSec)
      expect(c.endSec).toBe(captions[i].endSec)
      expect(c.displayOrder).toBe(captions[i].displayOrder)
      expect(c.captionType).toBe('sub')
    })
    expect(result.classification.model).toBeTruthy()
    expect(result.classification.batchCount).toBe(3)
    expect(result.requestCount).toBe(3)
  })

  it('290件相当: 予定バッチ数どおりのHTTPリクエスト数になる', async () => {
    const captions = makeCaptions(290)
    const job = { captions }
    const requestFn = vi.fn(async (batch) => batch.targetIds.map((id) => ({ id, captionType: 'normal' })))
    const result = await classifyJobCaptions(job, 'sk-test', { batchSize: 42, requestFn })
    expect(result.ok).toBe(true)
    expect(result.totalBatches).toBe(7)
    expect(requestFn).toHaveBeenCalledTimes(7)
  })

  it('途中のバッチで欠損IDがあれば停止し、それまでの結果も一切保存しない', async () => {
    const captions = makeCaptions(90)
    const job = { captions }
    let call = 0
    const requestFn = vi.fn(async (batch) => {
      call++
      if (call === 2) return batch.targetIds.slice(1).map((id) => ({ id, captionType: 'normal' })) // 1件欠損
      return batch.targetIds.map((id) => ({ id, captionType: 'normal' }))
    })
    const result = await classifyJobCaptions(job, 'sk-test', { batchSize: 42, requestFn })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('validation_error')
    expect(result.missingCount).toBe(1)
    expect(result.failedBatchIndex).toBe(1)
    expect(requestFn).toHaveBeenCalledTimes(2) // 3バッチ目は呼ばれない(即停止)
    expect(result.captions).toBeUndefined()
  })

  it('重複IDのバッチは拒否される', async () => {
    const captions = makeCaptions(10)
    const job = { captions }
    const requestFn = vi.fn(async (batch) => {
      const dup = batch.targetIds[0]
      return [dup, dup, ...batch.targetIds.slice(1)].map((id) => ({ id, captionType: 'normal' }))
    })
    const result = await classifyJobCaptions(job, 'sk-test', { batchSize: 42, requestFn })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('validation_error')
    expect(result.duplicateCount).toBeGreaterThan(0)
  })

  it('未知IDのバッチは拒否される', async () => {
    const captions = makeCaptions(10)
    const job = { captions }
    const requestFn = vi.fn(async (batch) => [...batch.targetIds, 'ghost-id'].map((id) => ({ id, captionType: 'normal' })))
    const result = await classifyJobCaptions(job, 'sk-test', { batchSize: 42, requestFn })
    expect(result.ok).toBe(false)
    expect(result.unknownCount).toBe(1)
  })

  it('不正なcaptionTypeのバッチは拒否される', async () => {
    const captions = makeCaptions(10)
    const job = { captions }
    const requestFn = vi.fn(async (batch) => batch.targetIds.map((id) => ({ id, captionType: 'not-real' })))
    const result = await classifyJobCaptions(job, 'sk-test', { batchSize: 42, requestFn })
    expect(result.ok).toBe(false)
    expect(result.invalidTypeCount).toBe(captions.length)
  })

  it('API途中失敗時は残りのバッチを呼ばず、部分保存もしない(戻り値にcaptionsを含めない)', async () => {
    const captions = makeCaptions(130)
    const job = { captions }
    let call = 0
    const requestFn = vi.fn(async (batch) => {
      call++
      if (call === 2) throw new Error('network down')
      return batch.targetIds.map((id) => ({ id, captionType: 'normal' }))
    })
    const result = await classifyJobCaptions(job, 'sk-test', { batchSize: 42, requestFn })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('api_error')
    expect(requestFn).toHaveBeenCalledTimes(2)
    expect(result.captions).toBeUndefined()
  })

  it('既に分類済みのジョブはforce指定が無い限りAPIを呼ばない(0リクエスト)', async () => {
    const captions = makeCaptions(10)
    const job = { captions, captionClassification: { model: 'gpt-4o-mini', classifiedAt: '2020-01-01T00:00:00Z', version: 1 } }
    const requestFn = vi.fn()
    const result = await classifyJobCaptions(job, 'sk-test', { requestFn })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('already_classified')
    expect(requestFn).not.toHaveBeenCalled()
  })

  it('分類済みでもforce:trueなら再実行される', async () => {
    const captions = makeCaptions(10)
    const job = { captions, captionClassification: { model: 'gpt-4o-mini', classifiedAt: '2020-01-01T00:00:00Z', version: 1 } }
    const requestFn = vi.fn(async (batch) => batch.targetIds.map((id) => ({ id, captionType: 'sub' })))
    const result = await classifyJobCaptions(job, 'sk-test', { force: true, requestFn })
    expect(result.ok).toBe(true)
    expect(requestFn).toHaveBeenCalled()
  })

  it('captionsが空ならAPIを呼ばない', async () => {
    const requestFn = vi.fn()
    const result = await classifyJobCaptions({ captions: [] }, 'sk-test', { requestFn })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_captions')
    expect(requestFn).not.toHaveBeenCalled()
  })
})
