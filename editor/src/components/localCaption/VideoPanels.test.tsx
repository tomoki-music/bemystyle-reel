import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SourceVideoPanel, PreviewVideoPanel, FinalVideoPanel } from './VideoPanels'
import { formatDuration } from './useOutputFileInfo'

describe('元動画パネル', () => {
  it('「元動画（テロップ焼き込み前）」の見出しと source-stream のプレイヤーを表示する', () => {
    render(<SourceVideoPanel jobId="job1" />)
    const panel = screen.getByTestId('source-video-panel')
    expect(within(panel).getByRole('heading', { name: /元動画（テロップ焼き込み前）/ })).toBeInTheDocument()
    expect(panel.querySelector('video')?.getAttribute('src')).toBe('/api/local-caption-videos/job1/source-stream')
  })
})

describe('短時間プレビュー', () => {
  it('実際のプレビュー時間を表示し、preview-stream を再生する（完成動画とは別の枠・クラス）', () => {
    render(
      <PreviewVideoPanel
        jobId="job1"
        previewWindow={{ startSec: 657, endSec: 687, synthetic: false }}
        previewInfo={{ durationSec: 30.02, sizeBytes: 5_000_000 }}
      />,
    )
    const block = screen.getByTestId('preview-video-block')
    expect(within(block).getByText(/実際のプレビュー時間: 30秒/)).toBeInTheDocument()
    const video = block.querySelector('video')!
    expect(video.getAttribute('src')).toBe('/api/local-caption-videos/job1/preview-stream')
    expect(video.className).toContain('lcv-video--preview')
    expect(video.className).not.toContain('lcv-video--final')
  })

  it('ffprobe結果が未取得のときは区間の長さから時間を表示する', () => {
    render(<PreviewVideoPanel jobId="j" previewWindow={{ startSec: 10, endSec: 45, synthetic: false }} previewInfo={null} />)
    expect(screen.getByText(/実際のプレビュー時間: 35秒/)).toBeInTheDocument()
  })
})

describe('完成動画パネル', () => {
  it('「完成動画（フルバージョン）」の見出し・長さ・サイズ・再生プレイヤー・ダウンロードリンク・Finder案内を表示する', () => {
    render(<FinalVideoPanel jobId="job1" outputInfo={{ durationSec: 918.685, sizeBytes: 1_234_567_890 }} />)
    const panel = screen.getByTestId('final-video-panel')
    expect(within(panel).getByRole('heading', { name: /完成動画（フルバージョン）/ })).toBeInTheDocument()
    expect(within(panel).getByText('15分19秒')).toBeInTheDocument()
    expect(within(panel).getByText('1.15 GB')).toBeInTheDocument()
    const video = panel.querySelector('video')!
    expect(video.getAttribute('src')).toBe('/api/local-caption-videos/job1/output-stream')
    expect(video.hasAttribute('controls')).toBe(true)
    const link = within(panel).getByRole('link', { name: /ダウンロード/ })
    expect(link.getAttribute('href')).toBe('/api/local-caption-videos/job1/output-stream')
    expect(link.hasAttribute('download')).toBe(true)
    expect(within(panel).getByText(/Finderで確認するには/)).toBeInTheDocument()
  })

  it('長さ・サイズの取得前は「取得中…」を出す', () => {
    render(<FinalVideoPanel jobId="job1" outputInfo={null} />)
    expect(screen.getAllByText('取得中…')).toHaveLength(2)
  })

  it('絶対パスやAPIキーを画面に出さない', () => {
    const { container } = render(
      <>
        <SourceVideoPanel jobId="job1" />
        <PreviewVideoPanel jobId="job1" previewWindow={{ startSec: 0, endSec: 30, synthetic: false }} previewInfo={null} />
        <FinalVideoPanel jobId="job1" outputInfo={{ durationSec: 60, sizeBytes: 1000 }} />
      </>,
    )
    expect(container.textContent).not.toMatch(/\/Users\/|\/private\/|sk-[A-Za-z0-9]|OPENAI_API_KEY|BeMyStyleReelOutput/)
  })
})

describe('3種の区別', () => {
  it('元動画・プレビュー・完成動画で、見出し文言とパネルのクラスが異なる', () => {
    const { container } = render(
      <>
        <SourceVideoPanel jobId="job1" />
        <FinalVideoPanel jobId="job1" outputInfo={null} />
      </>,
    )
    expect(container.querySelector('.lcv-panel--source')).not.toBeNull()
    expect(container.querySelector('.lcv-panel--final')).not.toBeNull()
    expect(container.querySelector('.lcv-badge--source')?.textContent).toBe('元動画')
    expect(container.querySelector('.lcv-badge--final')?.textContent).toBe('完成')
  })
})

describe('formatDuration', () => {
  it('秒・分秒・時間分秒に整形し、不正値は - を返す', () => {
    expect(formatDuration(30.02)).toBe('30秒')
    expect(formatDuration(918.685)).toBe('15分19秒')
    expect(formatDuration(3725)).toBe('1時間2分5秒')
    expect(formatDuration(59.6)).toBe('1分00秒')
    expect(formatDuration(null)).toBe('-')
    expect(formatDuration(-1)).toBe('-')
  })
})
