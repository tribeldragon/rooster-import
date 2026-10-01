import { LOW_CONF_THRESHOLD, weekdayOf, type ParseResult, type Shift } from '../lib/parse';
import type { ImportState } from '../hooks/useCalendar';
import { TimeInput24 } from './TimeInput24';

interface Props {
  result: ParseResult;
  shifts: Shift[];
  firstDate: string;
  defaultTitle: string;
  officeActivities: string;
  importState: ImportState;
  onPatch: (id: string, patch: Partial<Shift>) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onMoveWeek: (newFirst: string) => void;
  onDefaultTitle: (title: string) => void;
  onOfficeActivities: (list: string) => void;
}

function offSummary(result: ParseResult): string {
  const offDays = result.days.filter((d) => d.off);
  if (!offDays.length) return '0 dagen overgeslagen';
  const counts = new Map<string, number>();
  offDays.forEach((d) => {
    const label = d.offReason ?? 'Vrij';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  const parts = [...counts.entries()].map(([label, n]) => `${n}x ${label}`);
  return `${offDays.length} dag(en) overgeslagen (${parts.join(', ')})`;
}

/** The review step: editable list of the shifts that were found. */
export function ShiftTable({
  result, shifts, firstDate, defaultTitle, officeActivities, importState,
  onPatch, onRemove, onClear, onMoveWeek, onDefaultTitle, onOfficeActivities,
}: Props) {
  return (
    <section className="panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Gevonden shifts</h2>
        <span className="muted">{shifts.length} in de lijst</span>
        <div className="spacer" />
        <button className="secondary" onClick={onClear}>Tabel leegmaken</button>
      </div>

      {result.warnings.map((w, i) => <div className="note warn" key={i}>{w}</div>)}

      <div className="row" style={{ marginBottom: 12 }}>
        <div className="field">
          <label htmlFor="first-workday">Eerste werkdag (verschuift alle datums)</label>
          <input id="first-workday" type="date" value={firstDate} onChange={(e) => onMoveWeek(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="default-title">Titel voor alle shifts</label>
          <input id="default-title" type="text" value={defaultTitle} onChange={(e) => onDefaultTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="office-activities">Kantoor-activiteiten (komma-gescheiden)</label>
          <input
            id="office-activities"
            type="text"
            value={officeActivities}
            onChange={(e) => onOfficeActivities(e.target.value)}
          />
        </div>
        <div className="spacer" />
        <div className="field">
          <span className="field-label-spacer" aria-hidden="true">&nbsp;</span>
          <span className="muted">{offSummary(result)}</span>
        </div>
      </div>

      <div className="muted legend">
        <p><code>*</code> tijd is automatisch gecorrigeerd</p>
        <p><code>⚠</code> onduidelijk gelezen — controleer deze shift even</p>
      </div>

      <div className="table-wrap">
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
                  <td className="cell-check">
                    <input type="checkbox" checked={s.include}
                      aria-label={`Shift van ${s.date ?? 'onbekende datum'} meenemen bij importeren`}
                      onChange={(e) => onPatch(s.id, { include: e.target.checked })} />
                  </td>
                  <td data-label="Datum">
                    <input type="date" value={s.date ?? ''}
                      onChange={(e) => onPatch(s.id, { date: e.target.value })} />
                  </td>
                  <td className="muted" data-label="Dag">{s.date ? weekdayOf(s.date) : '—'}</td>
                  <td data-label="Van">
                    <TimeInput24 label="Van" value={s.start} onChange={(v) => onPatch(s.id, { start: v })} />
                  </td>
                  <td data-label="Tot">
                    <TimeInput24 label="Tot" value={s.end} onChange={(v) => onPatch(s.id, { end: v })} />
                    {s.endsNextDay && <span className="muted"> +1d</span>}
                  </td>
                  <td data-label="Titel">
                    <input type="text" value={s.title} className="title-input"
                      onChange={(e) => onPatch(s.id, { title: e.target.value })} />
                  </td>
                  <td data-label="Activiteiten">
                    <details>
                      <summary>{s.activities.length} activiteiten</summary>
                      <ul className="acts">
                        {s.activities.map((a, i) => (
                          <li key={i}>
                            <span className="mono">{a.start}–{a.end}</span> {a.label}
                            {a.repaired ? ' *' : ''}
                            {a.conf < LOW_CONF_THRESHOLD ? ' ⚠' : ''}
                          </li>
                        ))}
                      </ul>
                    </details>
                    {s.warnings.map((w, i) => <div className="note warn" key={i}>{w}</div>)}
                  </td>
                  <td data-label="Status">
                    {state === 'pending' && <span className="muted">bezig…</span>}
                    {state === 'created' && <span className="status ok">toegevoegd</span>}
                    {state === 'updated' && <span className="status ok">bijgewerkt</span>}
                    {state && !['pending', 'created', 'updated'].includes(state) &&
                      <span className="status err">{state}</span>}
                  </td>
                  <td className="cell-delete">
                    <button
                      className="iconbtn"
                      title="Verwijder deze shift uit de lijst"
                      aria-label={`Verwijder shift van ${s.date ?? 'onbekende datum'}`}
                      onClick={() => onRemove(s.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!shifts.length && (
        <p className="muted">Alle shifts verwijderd. Sleep hierboven een nieuwe screenshot om verder te gaan.</p>
      )}
    </section>
  );
}
