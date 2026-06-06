/**
 * slide.image の値から staticFile() に渡すアセットパスを返す。
 *
 * - "uploads/xxx.jpg"   → "assets/uploads/xxx.jpg"
 * - "generated/xxx.png" → "assets/generated/xxx.png"
 * - "slide01.jpg"       → "assets/slides/slide01.jpg"
 */
export function resolveImageAssetPath(image: string): string {
  if (image.startsWith('uploads/') || image.startsWith('generated/')) return `assets/${image}`
  return `assets/slides/${image}`
}
