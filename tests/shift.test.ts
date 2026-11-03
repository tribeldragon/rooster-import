import { expect, test } from 'vitest';
import { eventIdFor, officeIn, shiftTitle, type Activity, type Shift } from '../src/lib/parse';
import { parseScheduleText } from '../src/lib/parseText';
import { shiftTimes } from '../src/lib/calendar';

const act = (label: string): Activity => ({ label, start: '09:00', end: '10:00', y: 0, repaired: false, conf: 100 });
const shift = (over: Partial<Shift>): Shift => ({
  id: 'x', date: '2026-10-05', dayName: 'maandag', start: '09:30', end: '18:00', endsNextDay: false,
  activities: [], warnings: [], include: true, title: 'Werk', officeActivities: [], ...over,
});

test('event-id hangt alleen van de datum af (gecorrigeerde starttijd werkt bij)', () => {
  expect(eventIdFor(shift({}))).toBe('rooster20261005');
  expect(eventIdFor(shift({ start: '09:00' }))).toBe('rooster20261005');
});

test('titel met kantoor-activiteiten', () => {
  expect(shiftTitle('Werk', [])).toBe('Werk');
  expect(shiftTitle('Werk', ['Overleg', 'Coaching'])).toBe('Werk | Overleg, Coaching | Kantoor');
});

test('officeIn: hoofdletterongevoelig, volgorde van eerste voorkomen, geen dubbelen', () => {
  const acts = [act('Voice'), act('Coaching'), act('Overleg'), act('Coaching')];
  expect(officeIn(acts, ['overleg', ' Coaching '])).toEqual(['Coaching', 'Overleg']);
  expect(officeIn(acts, [])).toEqual([]);
});

test('nachtshift loopt door naar de volgende dag', () => {
  expect(shiftTimes(shift({ start: '22:00', end: '06:00', endsNextDay: true }))).toEqual({
    start: '2026-10-05T22:00:00', end: '2026-10-06T06:00:00',
  });
});

const ROSTER = `maandag 5 oktober 2026
09:00 - 17:30
1. Voice_123456 09:00 - 12:00
Lunch 12:00 - 12:30
Overleg 12:30 - 17:30
dinsdag 6 oktober 2026
Vrij
`;

test('geplakte tekst: shift, kantoortitel en vrije dag (zonder samples/)', () => {
  const r = parseScheduleText(ROSTER);
  expect(r.shifts).toHaveLength(1);
  expect(r.shifts[0]).toMatchObject({ date: '2026-10-05', start: '09:00', end: '17:30', title: 'Werk | Overleg | Kantoor' });
  expect(r.days.map((d) => d.off)).toEqual([false, true]);
  expect(parseScheduleText(ROSTER, []).shifts[0].title).toBe('Werk');
});

// Leave week with an approval history per day, and a weekend whose roster isn't out yet.
const LEAVE_WEEK = `Campagne\tShift\tActiviteiten\tLocatie\tCampagne van de activiteit
\tvrijdag 11 december 2026
afwezig\t
 1. Verlof_3098328 \t00:00 - 12-12-2026 00:00Last Modified\tStatus\tComments
10/27/2026 1:54 PM\tPending\tCreated
10/29/2026 8:49 AM\tApproved\tUpdated
\tzaterdag 12 december 2026
Niet gepubliceerd\t\t\t
\tzondag 13 december 2026
Niet gepubliceerd\t\t\t
`;

test('geplakte tekst: verlof wordt een hele-dag-item, niet-gepubliceerde dagen worden overgeslagen', () => {
  const r = parseScheduleText(LEAVE_WEEK);
  expect(r.days.map((d) => [d.date, d.offReason])).toEqual([
    ['2026-12-11', 'Verlof'],
    ['2026-12-12', 'Niet gepubliceerd'],
    ['2026-12-13', 'Niet gepubliceerd'],
  ]);
  expect(r.shifts).toHaveLength(1);
  expect(r.shifts[0]).toMatchObject({ date: '2026-12-11', allDay: true, include: true, title: 'Verlof', activities: [] });
  expect(eventIdFor(r.shifts[0])).toBe('rooster20261211');
  expect(r.warnings).toEqual([]);
});
