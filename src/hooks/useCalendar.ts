import { useEffect, useState } from 'react';
import type { Shift } from '../lib/parse';
import type { CalendarEntry, CalendarProvider, EventSettings, ProviderId, Token } from '../lib/calendar';
import { google } from '../lib/google';
import { microsoft } from '../lib/microsoft';
import { storeGet, storeRemove, storeSet } from '../lib/storage';

export const PROVIDERS: Record<ProviderId, CalendarProvider> = { google, microsoft };

const CALENDAR_KEY = 'rooster-import.calendar';
/** Which provider consent was given for, so the next visit can get a token silently. */
const CONNECTED_KEY = 'rooster-import.connected';

/** Parallel calendar writes; low enough to stay clear of the providers' rate limits. */
const IMPORT_CONCURRENCY = 3;

export type ImportState = Record<string, 'pending' | 'created' | 'updated' | string>;

/** Calendar session (login, token, calendar list) and the import loop. */
export function useCalendar(settings: EventSettings, onError: (message: string | null) => void) {
  const [provider, setProvider] = useState<CalendarProvider | null>(null);
  const [token, setToken] = useState<Token | null>(null);
  const [calendars, setCalendars] = useState<CalendarEntry[]>([]);
  const [calendarId, setCalendarId] = useState<string>(storeGet(CALENDAR_KEY) ?? '');
  const [importState, setImportState] = useState<ImportState>({});
  const [importing, setImporting] = useState(false);

  useEffect(() => { if (calendarId) storeSet(CALENDAR_KEY, calendarId); }, [calendarId]);

  const ensureToken = async (p: CalendarProvider, silent = false): Promise<Token> => {
    if (p === provider && token && token.expiresAt > Date.now()) return token;
    if (!p.clientId) throw new Error(`Geen client ID voor ${p.label}: zet ${p.envVar} in .env en herstart de dev-server.`);
    const t = await p.requestToken({ silent });
    setToken(t);
    return t;
  };

  const applyCalendars = (list: CalendarEntry[]) => {
    setCalendars(list);
    setCalendarId((cur) => (list.some((c) => c.id === cur) ? cur : list.find((c) => c.primary)?.id ?? list[0]?.id ?? ''));
  };

  const connect = async (p: CalendarProvider) => {
    onError(null);
    try {
      const t = await ensureToken(p);
      applyCalendars(await p.listCalendars(t.value));
      setProvider(p);
      storeSet(CONNECTED_KEY, p.id);
    } catch (e) {
      setToken(null);
      onError((e as Error).message);
    }
  };

  const disconnect = () => {
    if (provider && token) provider.signOut(token);
    storeRemove(CONNECTED_KEY);
    setProvider(null);
    setToken(null);
    setCalendars([]);
  };

  /** Already consented once? Then pick the session back up without any dialog. */
  useEffect(() => {
    const stored = storeGet(CONNECTED_KEY);
    // '1' is what older versions stored, back when Google was the only option
    const p = stored === '1' ? google : PROVIDERS[stored as ProviderId];
    if (!p?.clientId) return;
    let cancelled = false;
    (async () => {
      try {
        const t = await p.requestToken({ silent: true });
        if (cancelled) return;
        const list = await p.listCalendars(t.value);
        if (cancelled) return;
        setProvider(p);
        setToken(t);
        applyCalendars(list);
        storeSet(CONNECTED_KEY, p.id);
      } catch {
        storeRemove(CONNECTED_KEY); // consent expired or revoked
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const doImport = async (selected: Shift[]) => {
    if (!provider) return;
    onError(null);
    setImporting(true);
    try {
      let current = await ensureToken(provider, true);
      // A few requests at a time; if the token dies, every worker waits for one shared renewal.
      let renewal: Promise<Token> | null = null;
      const renew = (stale: string): Promise<Token> => {
        if (current.value !== stale) return Promise.resolve(current);
        renewal ??= provider.requestToken({ silent: false })
          .then((t) => { current = t; setToken(t); return t; })
          .finally(() => { renewal = null; });
        return renewal;
      };
      const importOne = async (shift: Shift) => {
        setImportState((p) => ({ ...p, [shift.id]: 'pending' }));
        try {
          let outcome;
          try {
            outcome = await provider.upsertShift(current.value, calendarId, shift, settings);
          } catch (e) {
            if ((e as { status?: number }).status !== 401) throw e;
            const t = await renew(current.value); // token died mid-import: renew and retry once
            outcome = await provider.upsertShift(t.value, calendarId, shift, settings);
          }
          setImportState((p) => ({ ...p, [shift.id]: outcome }));
        } catch (e) {
          setImportState((p) => ({ ...p, [shift.id]: (e as Error).message }));
        }
      };
      const queue = [...selected];
      const worker = async () => { for (let s = queue.shift(); s; s = queue.shift()) await importOne(s); };
      await Promise.all(Array.from({ length: Math.min(IMPORT_CONCURRENCY, queue.length) }, worker));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const resetImportState = () => setImportState({});
  const dropImportState = (id: string) => setImportState(({ [id]: _dropped, ...rest }) => rest);

  return {
    provider, token, calendars, calendarId, setCalendarId, importState, importing,
    connect, disconnect, doImport, resetImportState, dropImportState,
  };
}
