/**
 * What App.tsx needs from a calendar backend. Google and Microsoft each implement this.
 */
import type { Shift } from './parse';

export type ProviderId = 'google' | 'microsoft';

export interface Token { value: string; expiresAt: number }

export interface CalendarEntry { id: string; summary: string; primary: boolean }

export interface EventSettings {
  timeZone: string;
  reminderMinutes: number | null;
}

export type UpsertOutcome = 'created' | 'updated';

export interface CalendarProvider {
  id: ProviderId;
  /** Name of the calendar product, e.g. "Google Agenda". */
  label: string;
  /** Empty when the matching VITE_* variable is missing. */
  clientId: string;
  /** Name of the .env variable, for the "not configured" hint. */
  envVar: string;
  requestToken(opts?: { silent?: boolean }): Promise<Token>;
  signOut(token: Token): void;
  listCalendars(token: string): Promise<CalendarEntry[]>;
  upsertShift(token: string, calendarId: string, shift: Shift, settings: EventSettings): Promise<UpsertOutcome>;
}

export function addIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const p = (x: number) => (x < 10 ? '0' + x : String(x));
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/** Local start/end as `YYYY-MM-DDTHH:mm:00`, end rolled to the next day for night shifts. */
export function shiftTimes(shift: Shift): { start: string; end: string } {
  const date = shift.date!;
  const endDate = shift.endsNextDay ? addIso(date, 1) : date;
  return { start: `${date}T${shift.start}:00`, end: `${endDate}T${shift.end}:00` };
}
