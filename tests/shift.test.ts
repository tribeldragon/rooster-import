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
