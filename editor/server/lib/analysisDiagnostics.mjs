// ローカルAIテロップ動画: AI分析リクエストの診断データ（成功・不合格を問わず保存）。
//
// 目的: 不合格になった原因を後から確認でき、次の分析実行時に「同じ応答を再検証（HTTPなし）」できるようにする。
//
// 安全設計:
// - 保存先は呼び出し側が渡す git 管理外の領域（既定は5分比較用データ配下の diagnostics/）。リポジトリへcommitされない。
// - ディレクトリは 0700、ファイルは 0600（可能な範囲で）。原子的に保存する（一時ファイル → rename）。
// - APIキー・Authorizationヘッダー・リクエストヘッダー・HTTPエラー本文は保存しない
//   （保存するのはステータスコードとエラーコードだけ）。保存前にAPIキー文字列が含まれていないことを確認する。
// - 生のAI応答（=字幕本文・テーマ名・強調語を含みうる）は診断ファイルの中にだけ保存する。
//   ログ・戻り値・エラーメッセージには本文・絶対パスを出さない（戻り値は件数・理由コードなど）。
// - 既存のジョブJSONには一切保存しない。

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

export const DIAGNOSTICS_DIRNAME = 'diagnostics'

export const diagnosticsDir = (dir) => join(dir, DIAGNOSTICS_DIRNAME)
export const attemptDiagnosticsPath = (dir, key, attempt) => join(diagnosticsDir(dir), `${key}.attempt-${attempt}.json`)

/** 診断ディレクトリを作る（権限0700）。 */
export function ensureDiagnosticsDir(dir) {
  const d = diagnosticsDir(dir)
  mkdirSync(d, { recursive: true, mode: 0o700 })
  try {
    chmodSync(d, 0o700)
  } catch {
    // 権限を変えられない環境でも診断の保存自体は続ける（gitignore領域の内側にある）
  }
  return d
}

/**
 * 診断を保存する。record に apiKey が含まれていれば保存せず例外にする。
 * @param {{ dir: string, key: string, attempt: number, record: object, apiKey?: string }} p
 * @returns {{ saved: true, mode: string }} 権限の8進表記（絶対パスは返さない）
 */
export function saveAttemptDiagnostics(p) {
  ensureDiagnosticsDir(p.dir)
  const body = JSON.stringify(p.record, null, 2)
  if (p.apiKey && p.apiKey.length >= 8 && body.includes(p.apiKey)) throw new Error('診断データにAPIキーが含まれているため保存しません')
  if (/Bearer\s+sk-[A-Za-z0-9_-]{8,}|\bsk-[A-Za-z0-9_-]{20,}/.test(body)) throw new Error('診断データにAPIキーらしい文字列が含まれているため保存しません')
  const path = attemptDiagnosticsPath(p.dir, p.key, p.attempt)
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmp, body, { encoding: 'utf-8', mode: 0o600, flag: 'wx' })
    try {
      chmodSync(tmp, 0o600)
    } catch {
      // 権限を変えられない環境では既定のまま
    }
    renameSync(tmp, path)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
  return { saved: true, mode: '0600' }
}

export const revalidationDiagnosticsPath = (dir, key, attempt, version) => join(diagnosticsDir(dir), `${key}.attempt-${attempt}.revalidation-v${version}.json`)

/**
 * 再検証の結果（検証版つき）を保存する。元の診断ファイルは変更しない。既に同じ版の記録がある場合は上書きせず、
 * 連番つきの別ファイルへ保存して履歴を残す。
 */
export function saveRevalidationRecord(p) {
  ensureDiagnosticsDir(p.dir)
  const body = JSON.stringify(p.record, null, 2)
  if (/Bearer\s+sk-[A-Za-z0-9_-]{8,}|\bsk-[A-Za-z0-9_-]{20,}/.test(body)) throw new Error('診断データにAPIキーらしい文字列が含まれているため保存しません')
  let path = revalidationDiagnosticsPath(p.dir, p.key, p.attempt, p.validationVersion)
  for (let n = 2; existsSync(path); n++) path = path.replace(/(\.revalidation-v\d+)(-\d+)?\.json$/, `$1-${n}.json`)
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmp, body, { encoding: 'utf-8', mode: 0o600, flag: 'wx' })
    renameSync(tmp, path)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
  return { saved: true, file: path.split('/').pop() }
}

/** 保存済みの診断を読む（無ければ null）。 */
export function loadAttemptDiagnostics(dir, key, attempt) {
  const p = attemptDiagnosticsPath(dir, key, attempt)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null
}

/** 診断の要約（本文・生応答を含まない）。標準出力・UI向け。 */
export function summarizeDiagnostics(record) {
  if (!record) return null
  return {
    attemptId: record.attemptId,
    attempt: record.attempt,
    createdAt: record.createdAt,
    model: record.model,
    inputSha256: record.inputSha256,
    httpRequestCount: record.httpRequestCount,
    status: record.status,
    httpStatus: record.httpStatus ?? null,
    responseSaved: typeof record.rawResponseText === 'string',
    validation: record.validation ?? null,
  }
}
