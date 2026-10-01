/** localStorage throws in private mode / when site data is blocked; the app must keep working. */
export function storeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function storeSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
export function storeRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
