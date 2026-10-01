/**
 * JSON fetch shared by the calendar providers: bearer auth, tolerant of non-JSON error
 * bodies (a 502 HTML page), and errors carry the HTTP status so callers can react to 401/409.
 */
export async function apiFetch(
  base: string, providerName: string, token: string, path: string, init: RequestInit = {},
): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const hint = res.status === 429 ? ': te veel verzoeken, probeer het zo opnieuw' : '';
    const err = new Error(body?.error?.message ?? `${providerName} fout (${res.status}${hint})`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return body;
}
