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

describe('localCaptionComposition: 本編BGM・先頭無音カットの静的確認', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8')
  const routes = read('../server/localCaptionVideoRoutes.mjs')
  const assets = read('../server/lib/mainBgmAssets.mjs')
  const bgm = read('../server/lib/mainBgm.mjs')
  it('本編BGMのMP3はアップロード・コピーせず、許可ルート内を直接参照する（multer・コピー・移動・削除を使わない）', () => {
    for (const src of [assets, bgm]) expect(/multer|copyFile|renameSync|unlinkSync|writeFileSync\(\s*(?:bgmPath|inputPath|realPath)/.test(src)).toBe(false)
    expect(assets).toContain('validateSourcePath')
    expect(assets).toContain('isInsideAnyRoot')
  })
  it('ffmpegは argv配列で起動し、shellを使わない。外部AI APIを呼ばない', () => {
    expect(assets).toContain('shell: false')
    expect(/exec\(|execSync|shell:\s*true/.test(assets + bgm)).toBe(false)
    expect(/openai|fetch\(|https?:\/\//i.test(assets + bgm + read('../server/lib/introCut.mjs') + read('../server/lib/mainEdit.mjs'))).toBe(false)
  })
  it('本編BGMプレビューのルートは、ダイジェスト・LINE案内を入れない構成で、絶対パスをログ・レスポンスに出さない', () => {
    const r = routes.slice(routes.indexOf("router.post('/:id/main-bgm-preview'"), routes.indexOf("router.post('/:id/preview-render'"))
    expect(r.length).toBeGreaterThan(200)
    expect(r).toContain('prepareMainBgmPreview')
    expect(/logSafe\([^)]*(sourcePath|outputPath|realPath)/.test(r)).toBe(false)
  })
})
