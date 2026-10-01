/**
 * .ics export: the no-login route. Import the file into any calendar app. Every event has a
 * stable UID (the same one the API imports use), so re-importing the file updates in most apps.
 */
import { eventIdFor, shiftDescription, type Shift } from './parse';
import { shiftTimes, type EventSettings } from './calendar';

/** UTC offset (ms) of `timeZone` at the given instant. */
function zoneOffset(utcMs: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}

/** Local wall-clock `YYYY-MM-DDTHH:mm:ss` in `timeZone` to a UTC `YYYYMMDDTHHmmssZ` stamp. */
export function toUtcStamp(local: string, timeZone: string): string {
  const [d, t] = local.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi, s] = t.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, da, h, mi, s);
  let utc = wall - zoneOffset(wall, timeZone);
  utc = wall - zoneOffset(utc, timeZone); // second pass settles times next to a DST change
  return new Date(utc).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545 line folding: max 75 octets per line, continuation lines start with a space. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    const limit = out.length ? 74 : 75; // continuation lines lose one octet to the leading space
    if (enc.encode(cur + ch).length > limit) { out.push(cur); cur = ch; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function buildIcs(shifts: Shift[], settings: EventSettings, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rooster Import//NL', 'CALSCALE:GREGORIAN'];
  for (const shift of shifts) {
    const { start, end } = shiftTimes(shift);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${eventIdFor(shift)}@rooster-import`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toUtcStamp(start, settings.timeZone)}`,
      `DTEND:${toUtcStamp(end, settings.timeZone)}`,
      `SUMMARY:${escapeText(shift.title || 'Werk')}`,
      `DESCRIPTION:${escapeText(shiftDescription(shift))}`,
      'TRANSP:OPAQUE',
    );
    if (settings.reminderMinutes !== null) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Shift',
        `TRIGGER:-PT${settings.reminderMinutes}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadIcs(shifts: Shift[], settings: EventSettings): void {
  const blob = new Blob([buildIcs(shifts, settings)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rooster-${shifts[0]?.date ?? 'import'}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
