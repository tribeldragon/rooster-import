/**
 * Microsoft identity platform (MSAL, auth code + PKCE) + Microsoft Graph calendar API, no backend.
 * Works for personal accounts (outlook.com/hotmail) and work/school accounts.
 */
import {
  createStandardPublicClientApplication,
  type AccountInfo, type AuthenticationResult, type IPublicClientApplication,
} from '@azure/msal-browser';
import { eventIdFor, shiftDescription, type Shift } from './parse';
import {
  shiftTimes,
  type CalendarEntry, type CalendarProvider, type EventSettings, type Token, type UpsertOutcome,
} from './calendar';

const CLIENT_ID = (import.meta.env.VITE_MICROSOFT_CLIENT_ID as string | undefined) ?? '';
const SCOPES = ['Calendars.ReadWrite'];
const GRAPH = 'https://graph.microsoft.com/v1.0';

/**
 * Graph has no client-chosen event ids like Google, so the deterministic shift id is stored in
 * an extended property and looked up before writing. The GUID is just this app's namespace.
 */
const SHIFT_ID_PROP = 'String {5e0c6b1a-8f2d-4c3e-9b7a-2d41f6a8c913} Name roosterImportId';

let instance: IPublicClientApplication | null = null;
let initPromise: Promise<IPublicClientApplication> | null = null;

function getApp(): Promise<IPublicClientApplication> {
  initPromise ??= createStandardPublicClientApplication({
    auth: {
      clientId: CLIENT_ID,
      // "common" accepts both personal Microsoft accounts and work/school accounts
      authority: 'https://login.microsoftonline.com/common',
      // tiny page that hands the login response back to this window (see redirect.html)
      redirectUri: `${window.location.origin}/redirect.html`,
    },
    // keeps the session across reloads, like the Google "connected" flag
    cache: { cacheLocation: 'localStorage' },
  }).then((app) => (instance = app));
  return initPromise;
}

// Initialise early: the login popup has to open straight from the click, without awaiting first.
if (CLIENT_ID) void getApp().catch(() => { /* surfaces again on login */ });

function toToken(res: AuthenticationResult): Token {
  const expires = res.expiresOn?.getTime() ?? Date.now() + 3600_000;
  return { value: res.accessToken, expiresAt: expires - 60_000 };
}

async function requestToken(opts: { silent?: boolean } = {}): Promise<Token> {
  const app = instance ?? await getApp();
  if (opts.silent) {
    const account: AccountInfo | null = app.getActiveAccount() ?? app.getAllAccounts()[0] ?? null;
    if (!account) throw new Error('Niet ingelogd bij Microsoft.');
    return toToken(await app.acquireTokenSilent({ scopes: SCOPES, account }));
  }
  try {
    const res = await app.acquireTokenPopup({
      scopes: SCOPES,
      prompt: 'select_account',
      // A failed or closed earlier popup can leave MSAL's "in progress" flag behind in
      // sessionStorage, which would block every later login with interaction_in_progress.
      overrideInteractionInProgress: true,
    });
    app.setActiveAccount(res.account);
    return toToken(res);
  } catch (e) {
    if ((e as { errorCode?: string }).errorCode === 'user_cancelled') throw new Error('Inloggen geannuleerd.');
    throw e;
  }
}

function signOut(): void {
  const app = instance;
  if (!app) return;
  const account = app.getActiveAccount();
  app.setActiveAccount(null);
  // Forget the tokens in this browser only; no Microsoft-wide sign-out popup.
  void app.clearCache(account ? { account } : undefined);
}

async function api(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${GRAPH}${path}`, {
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
    const err = new Error(body?.error?.message ?? `Microsoft Graph fout (${res.status})`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return body;
}

async function listCalendars(token: string): Promise<CalendarEntry[]> {
  const data = await api(token, '/me/calendars?$top=250&$select=id,name,canEdit,isDefaultCalendar');
  return (data.value ?? [])
    .filter((c: any) => c.canEdit)
    .map((c: any) => ({ id: c.id, summary: c.name, primary: !!c.isDefaultCalendar }));
}

function buildEvent(shift: Shift, settings: EventSettings) {
  const { start, end } = shiftTimes(shift);
  return {
    subject: shift.title || 'Werk',
    body: { contentType: 'text', content: shiftDescription(shift) },
    start: { dateTime: start, timeZone: settings.timeZone },
    end: { dateTime: end, timeZone: settings.timeZone },
    showAs: 'busy',
    // null = leave Outlook's own default reminder alone
    ...(settings.reminderMinutes === null
      ? {}
      : { isReminderOn: true, reminderMinutesBeforeStart: settings.reminderMinutes }),
  };
}

/** Same idempotency as the Google side: find the event by its shift id, then update or create. */
async function upsertShift(
  token: string,
  calendarId: string,
  shift: Shift,
  settings: EventSettings,
): Promise<UpsertOutcome> {
  const shiftId = eventIdFor(shift);
  const cal = encodeURIComponent(calendarId);
  const event = buildEvent(shift, settings);

  const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${SHIFT_ID_PROP}' and ep/value eq '${shiftId}')`;
  const found = await api(token, `/me/calendars/${cal}/events?$filter=${encodeURIComponent(filter)}&$select=id&$top=1`);
  const existing = found.value?.[0]?.id as string | undefined;

  if (existing) {
    await api(token, `/me/events/${encodeURIComponent(existing)}`, { method: 'PATCH', body: JSON.stringify(event) });
    return 'updated';
  }
  await api(token, `/me/calendars/${cal}/events`, {
    method: 'POST',
    body: JSON.stringify({ ...event, singleValueExtendedProperties: [{ id: SHIFT_ID_PROP, value: shiftId }] }),
  });
  return 'created';
}

export const microsoft: CalendarProvider = {
  id: 'microsoft',
  label: 'Outlook-agenda',
  clientId: CLIENT_ID,
  envVar: 'VITE_MICROSOFT_CLIENT_ID',
  requestToken,
  signOut,
  listCalendars,
  upsertShift,
};
