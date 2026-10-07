// Shared decode budget for image dimensions declared by untrusted files.
export const MAX_DIM = 32_767;
export const MAX_PIXELS = 80_000_000;

/** A bounded typed-array length, or null when the declared dimensions are unsafe. */
export function checkedBufLen(width: number, height: number, bytesPerPixel: number): number | null {
  if (![width, height, bytesPerPixel].every(Number.isSafeInteger)
    || width < 1 || height < 1 || bytesPerPixel < 1
    || width > MAX_DIM || height > MAX_DIM) return null;
  const pixels = width * height;
  const bytes = pixels * bytesPerPixel;
  return pixels <= MAX_PIXELS && Number.isSafeInteger(bytes) && bytes <= 0xffff_ffff ? bytes : null;
}
