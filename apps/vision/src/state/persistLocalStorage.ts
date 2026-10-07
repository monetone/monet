/** False when quota, permissions, or an unavailable Storage backend rejects the write. */
export function persistLocalStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
