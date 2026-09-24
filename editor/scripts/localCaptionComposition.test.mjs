import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, 'localCaptionComposition.mjs'), 'utf-8')
const swift = readFileSync(resolve(here, 'tools/qrDecode.swift'), 'utf-8')
const routes = readFileSync(resolve(here, '../server/localCaptionVideoRoutes.mjs'), 'utf-8')

describe('localCaptionComposition: 安全性（静的確認）', () => {
  it('外部AI APIを呼ばない。既存データ・素材は読み取り専用', () => {
    expect(/openai|api\.openai|node-fetch|fetch\(|OPENAI_API_KEY/i.test(src)).toBe(false)
    expect(src).toContain('externalAiApiCalled: false')
    for (const k of ['sourceUnchanged', 'jobFileByteIdentical', 'pagesByteIdentical', 'analysisByteIdentical', 'existingOutputsModified', 'tempDirRemoved']) expect(src).toContain(k)
    expect(/writeFileSync\(\s*(jobFile|pagesFile|resolve\(DATA_DIR)/.test(src)).toBe(false)
  })
  it('素材パス・字幕本文・テーマ名を標準出力へ出さない', () => {
    const logs = src.slice(src.indexOf('console.log(JSON.stringify({\n    stage: \'render\''))
    expect(/args\.(bgm|qr|source)|realPath|\.text\b|\.title\b/.test(logs.slice(0, logs.indexOf('}, null, 2))')))).toBe(false)
  })
  it('動画は withTempDir + renderCompositionToFile（一時ファイル→rename）で書き出し、上書きしない出力名を使う', () => {
    expect(src).toContain("withTempDir('lcv-composition-'")
    expect(src).toContain('renderCompositionToFile(')
    expect(src).toContain("buildComparisonOutputPath('composition_check'")
  })
  it('QR読み取りツールは内容そのもの（URL）を出力せず、読み取り可否・長さ・ドメイン・SHA-256だけを出す', () => {
    expect(swift).toContain('sha256')
    expect(/print\(\s*p\s*\)/.test(swift)).toBe(false)
    expect(/"payload"/.test(swift)).toBe(false)
  })
  it('完成動画レンダーは、composition無効指定・素材/設定不正・空き容量15GB未満で開始せず、既定の経路は従来どおり', () => {
    expect(routes).toContain('compositionDisabled')
    expect(routes).toContain('FULL_RENDER_MIN_FREE_BYTES')
    expect(routes).toContain('prepareJobComposition(')
    expect(routes).toContain('isCompositionConfiguredByEnv()')
    // プレビュー(preview-render)は構成を追加しない
    const preview = routes.slice(routes.indexOf("router.post('/:id/preview-render'"))
    expect(/prepareJobComposition|renderCompositionToFile|resolveCompositionConfig/.test(preview)).toBe(false)
  })
})
