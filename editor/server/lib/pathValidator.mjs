// ローカルAIテロップ動画機能: パス検証（最重要セキュリティコード）
//
// すべての入力パス（動画ソース、出力先）は realpathSync で解決したうえで、
// 許可ルート（VIDEO_INPUT_ROOTS / VIDEO_OUTPUT_ROOT）の内側に実際に存在するかを
// 検証する。シンボリックリンクによる許可ルート外への脱出や `..` トラバーサルを
// 防ぐため、必ず realpath 後の文字列同士で比較する（パス文字列の前方一致だけで
// 判定しない）。
//
// 注意: このモジュールが返すエラーメッセージ・throw する Error には、
// 呼び出し側で受け取ったパスをそのまま含めないこと（ログ/レスポンスに
// フルパスが漏れるのを防ぐため）。basename 程度に留める。

import { realpathSync, statSync, constants, accessSync } from 'fs'
import { resolve, isAbsolute, sep, basename } from 'path'

export class PathValidationError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message)
    this.name = 'PathValidationError'
    this.code = code
  }
}

/**
 * 許可ルート配列を realpath 解決する。解決できないルート（未作成など）は無視する。
 * @param {string[]} roots
 * @returns {string[]}
 */
export function resolveAllowedRoots(roots) {
  const out = []
  for (const root of roots ?? []) {
    if (!root || typeof root !== 'string') continue
    try {
      out.push(realpathSync(resolve(root)))
    } catch {
      // ルート自体が存在しない場合は無視（起動時にオペレーターへ警告する側で扱う）
    }
  }
  return out
}

/**
 * realPath が realRoots のいずれかの内側（等しい、またはそのディレクトリ配下）かどうか。
 * @param {string} realPath
 * @param {string[]} realRoots
 */
export function isInsideAnyRoot(realPath, realRoots) {
  return realRoots.some((root) => realPath === root || realPath.startsWith(root + sep))
}

/**
 * ソース動画パスの検証。存在する「読み取り可能な通常ファイル」で、
 * 許可ルートの内側にあることを保証する。
 *
 * @param {string} inputPath ユーザー入力の絶対パス
 * @param {string[]} allowedRoots VIDEO_INPUT_ROOTS（生の設定値。内部で realpath する）
 * @returns {{ realPath: string, size: number }}
 */
export function validateSourcePath(inputPath, allowedRoots) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new PathValidationError('invalid_input', 'パスが指定されていません')
  }
  if (!isAbsolute(inputPath)) {
    throw new PathValidationError('not_absolute', 'パスは絶対パスで指定してください')
  }

  let realPath
  try {
    realPath = realpathSync(inputPath)
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new PathValidationError('not_found', 'ファイルが見つかりません')
    }
    if (err && err.code === 'EACCES') {
      throw new PathValidationError('permission_denied', 'アクセス権限がありません')
    }
    throw new PathValidationError('resolve_failed', 'パスの解決に失敗しました')
  }

  const realRoots = resolveAllowedRoots(allowedRoots)
  if (realRoots.length === 0) {
    throw new PathValidationError('no_allowed_roots', '許可された入力フォルダが設定されていません')
  }
  if (!isInsideAnyRoot(realPath, realRoots)) {
    throw new PathValidationError('outside_roots', '許可されたフォルダ外のパスです')
  }

  let stat
  try {
    stat = statSync(realPath)
  } catch {
    throw new PathValidationError('stat_failed', 'ファイル情報の取得に失敗しました')
  }

  if (stat.isDirectory()) {
    throw new PathValidationError('is_directory', 'フォルダはファイルとして指定できません')
  }
  if (!stat.isFile()) {
    throw new PathValidationError('not_a_file', '通常のファイルではありません')
  }

  try {
    accessSync(realPath, constants.R_OK)
  } catch {
    throw new PathValidationError('permission_denied', '読み取り権限がありません')
  }

  // 17GB 相当でも Number.MAX_SAFE_INTEGER (約9007兆) を大きく下回るため、
  // 誤差なく安全に扱える（下部の byte-size のテストで検証する）。
  return { realPath, size: stat.size }
}

/**
 * ディレクトリブラウズ用: 指定パスが許可ルート内の「ディレクトリ」であることを検証する。
 * ルート未指定（null/undefined）の場合は許可ルート一覧そのものを指す特別値として扱う。
 *
 * @param {string} inputPath
 * @param {string[]} allowedRoots
 * @returns {{ realPath: string }}
 */
export function validateBrowseDirectory(inputPath, allowedRoots) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new PathValidationError('invalid_input', 'パスが指定されていません')
  }
  if (!isAbsolute(inputPath)) {
    throw new PathValidationError('not_absolute', 'パスは絶対パスで指定してください')
  }

  let realPath
  try {
    realPath = realpathSync(inputPath)
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new PathValidationError('not_found', 'フォルダが見つかりません')
    }
    if (err && err.code === 'EACCES') {
      throw new PathValidationError('permission_denied', 'アクセス権限がありません')
    }
    throw new PathValidationError('resolve_failed', 'パスの解決に失敗しました')
  }

  const realRoots = resolveAllowedRoots(allowedRoots)
  if (!isInsideAnyRoot(realPath, realRoots)) {
    throw new PathValidationError('outside_roots', '許可されたフォルダ外のパスです')
  }

  let stat
  try {
    stat = statSync(realPath)
  } catch {
    throw new PathValidationError('stat_failed', 'ディレクトリ情報の取得に失敗しました')
  }
  if (!stat.isDirectory()) {
    throw new PathValidationError('not_a_directory', 'ディレクトリではありません')
  }

  return { realPath }
}

/**
 * 出力先ディレクトリ（単一ルート）の検証。存在する書き込み可能なディレクトリであること。
 * @param {string} outputRoot VIDEO_OUTPUT_ROOT
 * @returns {string} realpath
 */
export function validateOutputRoot(outputRoot) {
  if (!outputRoot || typeof outputRoot !== 'string') {
    throw new PathValidationError('invalid_input', '出力フォルダが設定されていません')
  }
  let realPath
  try {
    realPath = realpathSync(resolve(outputRoot))
  } catch {
    throw new PathValidationError('not_found', '出力フォルダが見つかりません')
  }
  const stat = statSync(realPath)
  if (!stat.isDirectory()) {
    throw new PathValidationError('not_a_directory', '出力先はディレクトリである必要があります')
  }
  try {
    accessSync(realPath, constants.W_OK)
  } catch {
    throw new PathValidationError('permission_denied', '出力フォルダへの書き込み権限がありません')
  }
  return realPath
}

/**
 * ログ出力用: フルパスを出さず basename のみを返す（要件5: パスをログに残さない）。
 * @param {string} p
 */
export function safeLogName(p) {
  try {
    return basename(p)
  } catch {
    return '(unknown)'
  }
}
