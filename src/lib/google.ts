/**
 * Google Identity Services (token flow) + Calendar REST API, no backend.
 */
import { eventIdFor, shiftDescription, type Shift } from './parse';
import {
  shiftTimes,
  type CalendarEntry, type CalendarProvider, type EventSettings, type Token, type UpsertOutcome,
} from './calendar';

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

declare global {
  interface Window { google?: any }
}

let gisPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
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

async function requestToken(clientId: string, opts: { silent?: boolean } = {}): Promise<Token> {
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

async function listCalendars(token: string): Promise<CalendarEntry[]> {
  const data = await api(token, '/users/me/calendarList?minAccessRole=writer&maxResults=250');
  return (data.items ?? []).map((c: any) => ({
    id: c.id,
    summary: c.summaryOverride || c.summary,
    primary: !!c.primary,
  }));
}

function buildEvent(shift: Shift, settings: EventSettings) {
  const { start, end } = shiftTimes(shift);
  return {
    id: eventIdFor(shift),
    summary: shift.title || 'Werk',
    description: shiftDescription(shift),
    start: { dateTime: start, timeZone: settings.timeZone },
    end: { dateTime: end, timeZone: settings.timeZone },
    status: 'confirmed',
    transparency: 'opaque',
    source: { title: 'Rooster Import', url: 'http://localhost:5173' },
    extendedProperties: { private: { roosterImport: '1', roosterWeek: shift.date! } },
    reminders: settings.reminderMinutes === null
      ? { useDefault: true }
      : { useDefault: false, overrides: [{ method: 'popup', minutes: settings.reminderMinutes }] },
  };
}

/**
 * Deterministic event ids make re-importing the same week safe: the second
 * import updates the existing event instead of creating a duplicate.
 */
async function upsertShift(
  token: string,
  calendarId: string,
  shift: Shift,
  settings: EventSettings,
): Promise<UpsertOutcome> {
  const event = buildEvent(shift, settings);
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

export const google: CalendarProvider = {
  id: 'google',
  label: 'Google Agenda',
  clientId: CLIENT_ID,
  envVar: 'VITE_GOOGLE_CLIENT_ID',
  requestToken: (opts) => requestToken(CLIENT_ID, opts),
  signOut: (token: Token) => window.google?.accounts?.oauth2?.revoke(token.value, () => {}),
  listCalendars,
  upsertShift,
};
