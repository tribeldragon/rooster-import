/**
 * Google Identity Services (token flow) + Calendar REST API, no backend.
 */
import { eventIdFor, shiftDescription, type Shift } from './parse';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

declare global {
  interface Window { google?: any }
}

let gisPromise: Promise<void> | null = null;

export function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google-script kon niet worden geladen (offline?).'));
    document.head.appendChild(s);
  });
  return gisPromise;
}

export interface Token { value: string; expiresAt: number }

export async function requestToken(clientId: string, opts: { silent?: boolean } = {}): Promise<Token> {
  await loadGis();
  return new Promise<Token>((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      prompt: opts.silent ? '' : 'consent',
      callback: (res: any) => {
        if (res.error) reject(new Error(res.error_description || res.error));
        else resolve({ value: res.access_token, expiresAt: Date.now() + (Number(res.expires_in) - 60) * 1000 });
      },
      error_callback: (err: any) => reject(new Error(err?.message ?? 'Inloggen geannuleerd.')),
    });
    client.requestAccessToken();
  });
}

export function revokeToken(token: string): void {
  window.google?.accounts?.oauth2?.revoke(token, () => {});
}

async function api(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(body?.error?.message ?? `Google API fout (${res.status})`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return body;
}

export interface CalendarEntry { id: string; summary: string; primary: boolean; accessRole: string }

export async function listCalendars(token: string): Promise<CalendarEntry[]> {
  const data = await api(token, '/users/me/calendarList?minAccessRole=writer&maxResults=250');
  return (data.items ?? []).map((c: any) => ({
    id: c.id,
    summary: c.summaryOverride || c.summary,
    primary: !!c.primary,
    accessRole: c.accessRole,
  }));
}

export interface EventSettings {
  timeZone: string;
  reminderMinutes: number | null;
  colorId?: string;
}

export function buildEvent(shift: Shift, settings: EventSettings) {
  const date = shift.date!;
  const endDate = shift.endsNextDay ? addIso(date, 1) : date;
  return {
    id: eventIdFor(shift),
    summary: shift.title || 'Werk',
    description: shiftDescription(shift),
    start: { dateTime: `${date}T${shift.start}:00`, timeZone: settings.timeZone },
    end: { dateTime: `${endDate}T${shift.end}:00`, timeZone: settings.timeZone },
    status: 'confirmed',
    transparency: 'opaque',
    source: { title: 'Rooster Import', url: 'http://localhost:5173' },
    extendedProperties: { private: { roosterImport: '1', roosterWeek: date } },
    reminders: settings.reminderMinutes === null
      ? { useDefault: true }
      : { useDefault: false, overrides: [{ method: 'popup', minutes: settings.reminderMinutes }] },
    ...(settings.colorId ? { colorId: settings.colorId } : {}),
  };
}

function addIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const p = (x: number) => (x < 10 ? '0' + x : String(x));
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

export type UpsertOutcome = 'created' | 'updated';

/**
 * Deterministic event ids make re-importing the same week safe: the second
 * import updates the existing event instead of creating a duplicate.
 */
export async function upsertEvent(
  token: string,
  calendarId: string,
  event: ReturnType<typeof buildEvent>,
): Promise<UpsertOutcome> {
  const cal = encodeURIComponent(calendarId);
  try {
    await api(token, `/calendars/${cal}/events`, { method: 'POST', body: JSON.stringify(event) });
    return 'created';
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status !== 409) throw e;
    const { id, ...patch } = event;
    await api(token, `/calendars/${cal}/events/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return 'updated';
  }
}
