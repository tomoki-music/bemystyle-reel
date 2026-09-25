import { describe, it, expect } from 'vitest'
import { selectPreviewWindow, buildSyntheticPreviewWindow, buildPreviewAssView, PREVIEW_MIN_SEC, PREVIEW_MAX_SEC } from './previewClip.mjs'

function cap(id, startSec, endSec, captionType) {
  return { id, startSec, endSec, captionType, text: `t-${id}`, emphasisText: null, displayOrder: 0 }
}

describe('selectPreviewWindow', () => {
  it('main/sub/emphasisを含む最小の区間(30〜60秒)を選ぶ', () => {
    const captions = [
      cap('a', 0, 5, 'normal'),
      cap('b', 5, 10, 'main'),
      cap('c', 10, 15, 'sub'),
      cap('d', 15, 20, 'emphasis'),
      cap('e', 20, 40, 'normal'),
      cap('f', 100, 105, 'main'), // 遠く離れた場所にもう1セット(使われないはず)
    ]
    const win = selectPreviewWindow(captions)
    expect(win).not.toBeNull()
    expect(win.endSec - win.startSec).toBeGreaterThanOrEqual(PREVIEW_MIN_SEC)
    expect(win.endSec - win.startSec).toBeLessThanOrEqual(PREVIEW_MAX_SEC)
    const types = new Set(win.captions.map((c) => c.captionType))
    expect(types.has('main')).toBe(true)
    expect(types.has('sub')).toBe(true)
    expect(types.has('emphasis')).toBe(true)
  })

  it('heading/annotationも含む場合はより多く含む区間を優先する', () => {
    // 30秒枠A(main/sub/emphasisのみ) vs 30秒枠B(main/sub/emphasis+heading+annotation)
    const captions = [
      cap('a1', 0, 10, 'main'),
      cap('a2', 10, 20, 'sub'),
      cap('a3', 20, 30, 'emphasis'),
      cap('b0', 100, 105, 'heading'),
      cap('b1', 105, 115, 'main'),
      cap('b2', 115, 125, 'sub'),
      cap('b3', 125, 129.5, 'emphasis'),
      cap('b4', 129.5, 130, 'annotation'),
    ]
    const win = selectPreviewWindow(captions, { candidateLengths: [30] })
    const types = new Set(win.captions.map((c) => c.captionType))
    expect(types.has('heading')).toBe(true)
    expect(types.has('annotation')).toBe(true)
  })

  it('要件を満たす区間が無ければnullを返す', () => {
    const captions = [cap('a', 0, 10, 'normal'), cap('b', 10, 20, 'normal')]
    expect(selectPreviewWindow(captions)).toBeNull()
  })

  it('空配列ならnullを返す', () => {
    expect(selectPreviewWindow([])).toBeNull()
  })
})

describe('buildSyntheticPreviewWindow', () => {
  it('30秒ぴったりで6種類全captionTypeを含むダミーデータを返す', () => {
    const win = buildSyntheticPreviewWindow()
    expect(win.endSec - win.startSec).toBe(PREVIEW_MIN_SEC)
    const types = new Set(win.captions.map((c) => c.captionType))
    expect(types).toEqual(new Set(['normal', 'main', 'sub', 'emphasis', 'heading', 'annotation']))
    expect(win.synthetic).toBe(true)
  })

  it('時刻が昇順・非重複', () => {
    const win = buildSyntheticPreviewWindow()
    for (let i = 1; i < win.captions.length; i++) {
      expect(win.captions[i].startSec).toBeGreaterThanOrEqual(win.captions[i - 1].endSec)
    }
  })
})

describe('buildPreviewAssView', () => {
  it('区間開始を0秒とする相対時刻へシフトする(元captionは変更しない)', () => {
    const job = { width: 1920, height: 1080 }
    const window = {
      startSec: 100,
      endSec: 140,
      captions: [cap('x', 105, 110, 'main'), cap('y', 110, 120, 'sub')],
    }
    const original = JSON.parse(JSON.stringify(window.captions))
    const view = buildPreviewAssView(job, window)
    expect(view.captions[0].startSec).toBe(5)
    expect(view.captions[0].endSec).toBe(10)
    expect(view.captions[1].startSec).toBe(10)
    expect(view.captions[1].endSec).toBe(20)
    expect(view.width).toBe(1920)
    expect(view.height).toBe(1080)
    // 元のwindow.captionsオブジェクトは書き換えられていない
    expect(window.captions).toEqual(original)
  })

  it('シフト後にマイナスにならないようクランプする', () => {
    const job = { width: 1920, height: 1080 }
    const window = { startSec: 10, endSec: 40, captions: [cap('x', 8, 15, 'main')] }
    const view = buildPreviewAssView(job, window)
    expect(view.captions[0].startSec).toBe(0)
  })
})
