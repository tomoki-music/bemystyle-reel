/**
 * slide.image の値から staticFile() に渡すアセットパスを返す。
 *
 * - "uploads/xxx.jpg"  → "assets/uploads/xxx.jpg"
 * - "slide01.jpg"      → "assets/slides/slide01.jpg"
 */
export function resolveImageAssetPath(image: string): string {
  if (image.startsWith('uploads/')) return `assets/${image}`
  return `assets/slides/${image}`
}
