import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseSchedule, addDays, weekdayOf, type ParseResult, type Shift } from './lib/parse';
import { fileToDataUrl, runOcr, type Progress } from './lib/ocr';
import {
  buildEvent, listCalendars, requestToken, revokeToken, upsertEvent,
  type CalendarEntry, type EventSettings, type Token,
} from './lib/google';

interface Settings extends EventSettings {
  clientId: string;
  defaultTitle: string;
}

const SETTINGS_KEY = 'rooster-import.settings';
const CALENDAR_KEY = 'rooster-import.calendar';
/** Remembers that consent was given, so the next visit can get a token silently. */
const CONNECTED_KEY = 'rooster-import.connected';

const defaultSettings: Settings = {
  clientId: (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) ?? '',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Amsterdam',
  reminderMinutes: null,
  defaultTitle: 'Werk',
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const merged = { ...defaultSettings, ...JSON.parse(raw) } as Settings;
      // a client ID from .env wins over an empty stored one
      if (!merged.clientId) merged.clientId = defaultSettings.clientId;
      return merged;
    }
  } catch { /* ignore */ }
  return defaultSettings;
}

type ImportState = Record<string, 'pending' | 'created' | 'updated' | string>;

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [token, setToken] = useState<Token | null>(null);
  const [calendars, setCalendars] = useState<CalendarEntry[]>([]);
  const [calendarId, setCalendarId] = useState<string>(localStorage.getItem(CALENDAR_KEY) ?? '');
  const [importState, setImportState] = useState<ImportState>({});
  const [importing, setImporting] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);
  useEffect(() => { if (calendarId) localStorage.setItem(CALENDAR_KEY, calendarId); }, [calendarId]);

  /* ------------------------------------------------------------ screenshot */

  const handleImage = useCallback(async (file: File | Blob) => {
    setError(null);
    setResult(null);
    setShifts([]);
    setImportState({});
    try {
      const dataUrl = await fileToDataUrl(file);
      setImageUrl(dataUrl);
      setProgress({ stage: 'Starten', progress: 0 });
      const ocr = await runOcr(dataUrl, setProgress);
      const parsed = parseSchedule({
        fullWords: ocr.fullWords,
        leftWords: ocr.leftWords,
        imageWidth: ocr.width,
        fallbackYear: new Date().getFullYear(),
      });
      setResult(parsed);
      setShifts(parsed.shifts.map((s) => ({ ...s, title: settings.defaultTitle })));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  }, [settings.defaultTitle]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) { e.preventDefault(); void handleImage(file); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleImage]);

  /* ---------------------------------------------------------- shift edits */

  const patchShift = (id: string, patch: Partial<Shift>) =>
    setShifts((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const removeShift = (id: string) => {
    setShifts((prev) => prev.filter((s) => s.id !== id));
    setImportState(({ [id]: _dropped, ...rest }) => rest);
  };

  /** Clear the table without touching the Google session. */
  const clearAll = () => {
    setResult(null);
    setShifts([]);
    setImportState({});
    setImageUrl(null);
    setError(null);
  };

  const firstDate = shifts.find((s) => s.date)?.date ?? '';

  const moveWeek = (newFirst: string) => {
    if (!firstDate || !newFirst) return;
    const delta = Math.round(
      (Date.parse(newFirst + 'T00:00:00Z') - Date.parse(firstDate + 'T00:00:00Z')) / 86400000,
    );
    if (!delta) return;
    setShifts((prev) => prev.map((s) => (s.date ? { ...s, date: addDays(s.date, delta) } : s)));
  };

  /* --------------------------------------------------------------- google */

  const ensureToken = async (silent = false): Promise<Token> => {
    if (token && token.expiresAt > Date.now()) return token;
    if (!settings.clientId) throw new Error('Vul eerst je Google client ID in bij Instellingen.');
    const t = await requestToken(settings.clientId, { silent });
    setToken(t);
    return t;
  };

  const applyCalendars = (list: CalendarEntry[]) => {
    setCalendars(list);
    setCalendarId((cur) => (list.some((c) => c.id === cur) ? cur : list.find((c) => c.primary)?.id ?? list[0]?.id ?? ''));
  };

  const connect = async () => {
    setError(null);
    try {
      const t = await ensureToken();
      applyCalendars(await listCalendars(t.value));
      localStorage.setItem(CONNECTED_KEY, '1');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const disconnect = () => {
    if (token) revokeToken(token.value);
    localStorage.removeItem(CONNECTED_KEY);
    setToken(null);
    setCalendars([]);
  };

  /** Already consented once? Then pick the session back up without any dialog. */
  useEffect(() => {
    if (!settings.clientId || localStorage.getItem(CONNECTED_KEY) !== '1') return;
    let cancelled = false;
    (async () => {
      try {
        const t = await requestToken(settings.clientId, { silent: true });
        if (cancelled) return;
        setToken(t);
        const list = await listCalendars(t.value);
        if (!cancelled) applyCalendars(list);
      } catch {
        localStorage.removeItem(CONNECTED_KEY); // consent expired or revoked
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(() => shifts.filter((s) => s.include && s.date), [shifts]);

  const doImport = async () => {
    setError(null);
    setImporting(true);
    try {
      let t = await ensureToken(true);
      for (const shift of selected) {
        setImportState((p) => ({ ...p, [shift.id]: 'pending' }));
        const event = buildEvent(shift, settings);
        try {
          const outcome = await upsertEvent(t.value, calendarId, event);
          setImportState((p) => ({ ...p, [shift.id]: outcome }));
        } catch (e) {
          if ((e as { status?: number }).status === 401) {
            // token died mid-import: ask Google for a new one and retry once
            t = await requestToken(settings.clientId, { silent: false });
            setToken(t);
            const outcome = await upsertEvent(t.value, calendarId, event);
            setImportState((p) => ({ ...p, [shift.id]: outcome }));
          } else {
            setImportState((p) => ({ ...p, [shift.id]: (e as Error).message }));
          }
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  /* ------------------------------------------------------------------ ui */

  const busy = progress !== null;

  return (
    <div className="app">
      <header className="top">
        <h1>Rooster Import</h1>
        <p>Screenshot van je weekrooster → Google Agenda</p>
      </header>

      {/* ---------------------------------------------------------- upload */}
      <section className="panel">
        <div
          className={'drop' + (dragOver ? ' over' : '')}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) void handleImage(file);
          }}
        >
          <strong>Sleep hier je screenshot, klik om te bladeren, of plak met Ctrl+V</strong>
          PNG of JPG van de roostertabel (Shift + Activiteiten)
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImage(f); e.target.value = ''; }}
        />

        {busy && (
          <>
            <p className="muted" style={{ marginBottom: 0 }}>{progress!.stage}…</p>
            <div className="bar"><div style={{ width: `${Math.round(progress!.progress * 100)}%` }} /></div>
            <p className="muted">De eerste keer duurt het wat langer: de taalbestanden worden gedownload en gecachet.</p>
          </>
        )}

        {error && <div className="note err">{error}</div>}

        {imageUrl && !busy && (
          <details style={{ marginTop: 10 }}>
            <summary>Screenshot tonen</summary>
            <img className="preview" src={imageUrl} alt="rooster screenshot" />
          </details>
        )}
      </section>

      {/* ---------------------------------------------------------- review */}
      {result && (
        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Gevonden shifts</h2>
            <span className="muted">{shifts.length} in de lijst</span>
            <div className="spacer" />
            <button className="secondary" onClick={clearAll}>Tabel leegmaken</button>
          </div>

          {result.warnings.map((w, i) => <div className="note warn" key={i}>{w}</div>)}

          <div className="row" style={{ marginBottom: 12 }}>
            <div className="field">
              <label>Eerste werkdag (verschuift alle datums)</label>
              <input type="date" value={firstDate} onChange={(e) => moveWeek(e.target.value)} />
            </div>
            <div className="field">
              <label>Titel voor alle shifts</label>
              <input
                type="text"
                value={settings.defaultTitle}
                onChange={(e) => {
                  const title = e.target.value;
                  setSettings((s) => ({ ...s, defaultTitle: title }));
                  setShifts((prev) => prev.map((s) => ({ ...s, title })));
                }}
              />
            </div>
            <div className="spacer" />
            <div className="field">
              <label>&nbsp;</label>
              <span className="muted">
                {result.days.filter((d) => d.off).length} vrije dag(en) overgeslagen
              </span>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>Datum</th>
                <th>Dag</th>
                <th>Van</th>
                <th>Tot</th>
                <th>Titel</th>
                <th>Activiteiten</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => {
                const state = importState[s.id];
                return (
                  <tr key={s.id}>
                    <td>
                      <input type="checkbox" checked={s.include}
                        onChange={(e) => patchShift(s.id, { include: e.target.checked })} />
                    </td>
                    <td>
                      <input type="date" value={s.date ?? ''}
                        onChange={(e) => patchShift(s.id, { date: e.target.value })} />
                    </td>
                    <td className="muted">{s.date ? weekdayOf(s.date) : '—'}</td>
                    <td>
                      <input type="time" value={s.start}
                        onChange={(e) => patchShift(s.id, { start: e.target.value })} />
                    </td>
                    <td>
                      <input type="time" value={s.end}
                        onChange={(e) => patchShift(s.id, { end: e.target.value })} />
                      {s.endsNextDay && <span className="muted"> +1d</span>}
                    </td>
                    <td>
                      <input type="text" value={s.title} style={{ width: 110 }}
                        onChange={(e) => patchShift(s.id, { title: e.target.value })} />
                    </td>
                    <td>
                      <details>
                        <summary>{s.activities.length} activiteiten</summary>
                        <ul className="acts">
                          {s.activities.map((a, i) => (
                            <li key={i}>{a.start}–{a.end} {a.label}{a.repaired ? ' *' : ''}</li>
                          ))}
                        </ul>
                      </details>
                      {s.warnings.map((w, i) => <div className="note warn" key={i}>{w}</div>)}
                    </td>
                    <td>
                      {state === 'pending' && <span className="muted">bezig…</span>}
                      {state === 'created' && <span style={{ color: 'var(--ok)' }}>toegevoegd</span>}
                      {state === 'updated' && <span style={{ color: 'var(--ok)' }}>bijgewerkt</span>}
                      {state && !['pending', 'created', 'updated'].includes(state) &&
                        <span style={{ color: 'var(--err)' }}>{state}</span>}
                    </td>
                    <td>
                      <button
                        className="iconbtn"
                        title="Verwijder deze shift uit de lijst"
                        aria-label={`Verwijder shift van ${s.date ?? 'onbekende datum'}`}
                        onClick={() => removeShift(s.id)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!shifts.length && (
            <p className="muted">Alle shifts verwijderd. Sleep hierboven een nieuwe screenshot om verder te gaan.</p>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------- google */}
      <section className="panel">
        <h2>Naar Google Agenda</h2>
        {!token ? (
          <>
            <button onClick={connect} disabled={!settings.clientId}>Inloggen met Google</button>
            {!settings.clientId && <div className="note warn">Vul eerst je Google client ID in bij Instellingen hieronder.</div>}
          </>
        ) : (
          <div className="row">
            <div className="field grow">
              <label>Agenda</label>
              <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>{c.summary}{c.primary ? ' (standaard)' : ''}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Herinnering</label>
              <select
                value={settings.reminderMinutes ?? ''}
                onChange={(e) => setSettings((s) => ({
                  ...s, reminderMinutes: e.target.value === '' ? null : Number(e.target.value),
                }))}
              >
                <option value="">Agenda-standaard</option>
                <option value="0">Op het moment zelf</option>
                <option value="30">30 minuten vooraf</option>
                <option value="60">1 uur vooraf</option>
                <option value="120">2 uur vooraf</option>
              </select>
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <button onClick={doImport} disabled={importing || !calendarId || !selected.length}>
                {importing ? 'Bezig…' : selected.length ? `${selected.length} shift(s) importeren` : 'Geen shifts geselecteerd'}
              </button>
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <button className="secondary" onClick={disconnect}>Uitloggen</button>
            </div>
          </div>
        )}
        <p className="muted">
          {token
            ? 'Je blijft ingelogd terwijl je een volgende screenshot verwerkt. Opnieuw importeren van dezelfde week maakt geen dubbele afspraken: bestaande shifts worden bijgewerkt.'
            : 'Na één keer toestemming geven blijf je ingelogd, ook na het herladen van de pagina.'}
        </p>
      </section>

      {/* -------------------------------------------------------- settings */}
      <section className="panel">
        <details>
          <summary><strong>Instellingen</strong></summary>
          <div className="row" style={{ marginTop: 12 }}>
            <div className="field grow">
              <label>Google OAuth client ID</label>
              <input
                type="text"
                placeholder="123-abc.apps.googleusercontent.com"
                value={settings.clientId}
                onChange={(e) => setSettings((s) => ({ ...s, clientId: e.target.value.trim() }))}
              />
            </div>
            <div className="field">
              <label>Tijdzone</label>
              <input
                type="text"
                value={settings.timeZone}
                onChange={(e) => setSettings((s) => ({ ...s, timeZone: e.target.value.trim() }))}
              />
            </div>
          </div>
          <p className="muted">
            Maak in Google Cloud Console een OAuth-client van het type <code>Web application</code> met
            JavaScript-origin <code>http://localhost:5173</code>. Zie README.md voor de stappen.
          </p>
        </details>
      </section>
    </div>
  );
}
