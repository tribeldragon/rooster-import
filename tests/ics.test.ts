import { expect, test } from 'vitest';
import { buildIcs, toUtcStamp } from '../src/lib/ics';
import type { Shift } from '../src/lib/parse';

const shift: Shift = {
  id: 'x', date: '2026-10-05', dayName: 'maandag', start: '22:00', end: '06:00', endsNextDay: true,
  activities: [{ label: 'Voice', start: '22:00', end: '06:00', y: 0, repaired: false, conf: 100 }],
  warnings: [], include: true, title: 'Werk, nacht', officeActivities: [],
};
const settings = { timeZone: 'Europe/Amsterdam', reminderMinutes: 30 };

test('lokale tijd naar UTC, zomer- en wintertijd', () => {
  expect(toUtcStamp('2026-10-05T22:00:00', 'Europe/Amsterdam')).toBe('20261005T200000Z'); // CEST +2
  expect(toUtcStamp('2026-12-05T22:00:00', 'Europe/Amsterdam')).toBe('20261205T210000Z'); // CET +1
  expect(toUtcStamp('2026-10-05T22:00:00', 'UTC')).toBe('20261005T220000Z');
});

test('ics: nachtshift, escaping, alarm, CRLF en vouwen', () => {
  const ics = buildIcs([shift], settings, new Date('2026-10-01T10:00:00Z'));
  expect(ics).toContain('UID:rooster20261005@rooster-import');
  expect(ics).toContain('DTSTART:20261005T200000Z');
  expect(ics).toContain('DTEND:20261006T040000Z');
  expect(ics).toContain('SUMMARY:Werk\\, nacht');
  expect(ics).toContain('TRIGGER:-PT30M');
  expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
});
