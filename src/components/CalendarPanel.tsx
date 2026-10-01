import type { CalendarProvider, EventSettings } from '../lib/calendar';
import { google } from '../lib/google';
import { microsoft } from '../lib/microsoft';
import type { useCalendar } from '../hooks/useCalendar';

interface Props {
  cal: ReturnType<typeof useCalendar>;
  selectedCount: number;
  settings: EventSettings;
  onReminder: (minutes: number | null) => void;
  onImport: () => void;
  onIcs: () => void;
}

/** Login, calendar choice and the import button. */
export function CalendarPanel({ cal, selectedCount, settings, onReminder, onImport, onIcs }: Props) {
  const { provider, token, calendars, calendarId, setCalendarId, importing, connect, disconnect } = cal;
  const connectBtn = (p: CalendarProvider, text: string) => (
    <button onClick={() => connect(p)} disabled={!p.clientId}>{text}</button>
  );

  const icsBtn = (
    <button className="secondary" onClick={onIcs} disabled={!selectedCount}>Download .ics</button>
  );

  return (
    <section className="panel">
      <h2>{provider ? `Naar ${provider.label}` : 'Naar je agenda'}</h2>
      {!provider || !token ? (
        <>
          <div className="row">
            {connectBtn(google, 'Inloggen met Google')}
            {connectBtn(microsoft, 'Inloggen met Microsoft')}
            {icsBtn}
          </div>
          {[google, microsoft].filter((p) => !p.clientId).map((p) => (
            <div className="note warn" key={p.id}>
              Geen client ID voor {p.label}. Zet <code>{p.envVar}</code> in <code>.env</code> en herstart <code>npm run dev</code>.
            </div>
          ))}
        </>
      ) : (
        <div className="row">
          <div className="field grow">
            <label htmlFor="calendar-select">Agenda</label>
            <select id="calendar-select" value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>{c.summary}{c.primary ? ' (standaard)' : ''}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="reminder-select">Herinnering</label>
            <select
              id="reminder-select"
              value={settings.reminderMinutes ?? ''}
              onChange={(e) => onReminder(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">Agenda-standaard</option>
              <option value="0">Op het moment zelf</option>
              <option value="30">30 minuten vooraf</option>
              <option value="60">1 uur vooraf</option>
              <option value="120">2 uur vooraf</option>
            </select>
          </div>
          <div className="field">
            <span className="field-label-spacer" aria-hidden="true">&nbsp;</span>
            <button onClick={onImport} disabled={importing || !calendarId || !selectedCount}>
              {importing ? 'Bezig…' : selectedCount ? `${selectedCount} shift(s) importeren` : 'Geen shifts geselecteerd'}
            </button>
          </div>
          <div className="field">
            <span className="field-label-spacer" aria-hidden="true">&nbsp;</span>
            {icsBtn}
          </div>
          <div className="field">
            <span className="field-label-spacer" aria-hidden="true">&nbsp;</span>
            <button className="secondary" onClick={disconnect}>Uitloggen</button>
          </div>
        </div>
      )}
      <p className="muted">
        {token
          ? 'Je blijft ingelogd terwijl je een volgende screenshot verwerkt. Opnieuw importeren van dezelfde week maakt geen dubbele afspraken: bestaande shifts worden bijgewerkt.'
          : 'Na één keer toestemming geven blijf je ingelogd, ook na het herladen van de pagina. Zonder inloggen kun je ook een .ics-bestand downloaden en in je agenda-app openen.'}
      </p>
    </section>
  );
}
