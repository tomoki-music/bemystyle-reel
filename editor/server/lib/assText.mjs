// ASS (Advanced SubStation Alpha) 字幕テキストの安全なエスケープ。
//
// ユーザーが入力したキャプション本文をそのまま Dialogue: 行に埋め込むと、
// `{...}` の override タグや `\` によるコマンドを注入できてしまう。
// 必ずこの escapeAssText() を通してから .ass ファイルへ書き込むこと。
//
// 順序が重要:
//   1. バックスラッシュのエスケープ（先にやらないと、後で挿入する \N の \ まで壊れる）
//   2. 中括弧 { } を全角に置換（override タグ開始/終了を無効化）
//   3. 改行を ASS の強制改行シーケンス \N に変換

/**
 * @param {string} text
 * @returns {string}
 */
export function escapeAssText(text) {
  if (typeof text !== 'string') return ''
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '｛')
    .replace(/\}/g, '｝')
    .replace(/\r\n/g, '\\N')
    .replace(/\r/g, '\\N')
    .replace(/\n/g, '\\N')
}

/**
 * ffmpeg の filtergraph 文字列 (`ass=<path>`) に埋め込む際のパスエスケープ。
 * これはシェルエスケープとは無関係で、ffmpeg 自身のフィルタパーサ用。
 * `\` -> `\\\\`, `:` -> `\:`, `'` -> `\'` の順で置換する。
 *
 * @param {string} filePath
 * @returns {string}
 */
export function escapePathForFfmpegFilter(filePath) {
  if (typeof filePath !== 'string') return ''
  return filePath
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
}
