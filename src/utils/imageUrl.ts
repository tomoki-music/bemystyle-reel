/**
 * slide.image の値から staticFile() に渡すアセットパスを返す。
 *
 * - "/assets/uploads/xxx.png" → "assets/uploads/xxx.png"
 * - "/assets/generated/xxx.png" → "assets/generated/xxx.png"
 * - "uploads/xxx.jpg"   → "assets/uploads/xxx.jpg"
 * - "generated/xxx.png" → "assets/generated/xxx.png"
 * - "slide01.jpg"       → "assets/slides/slide01.jpg"
 */
export function resolveImageAssetPath(image: string): string {
  if (image.startsWith('/assets/')) return image.slice(1)
  if (image.startsWith('uploads/') || image.startsWith('generated/')) return `assets/${image}`
  return `assets/slides/${image}`
}
