/**
 * Test for the copy-pasted-text route, against samples/week-2026-10-05.txt.
 *
 *   npm test
 */
import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScheduleText, looksLikeScheduleText } from '../src/lib/parseText';

const here = path.dirname(fileURLToPath(import.meta.url));
const samplePath = path.join(here, '../samples/week-2026-10-05.txt');
// samples/ is gitignored (real roster); on a fresh clone or in CI there is nothing to test against
const haveSample = fs.existsSync(samplePath);
const text = haveSample ? fs.readFileSync(samplePath, 'utf8') : '';

const check = (label: string, actual: unknown, expected: unknown) =>
  test(label, () => expect(actual).toEqual(expected));

check('gewone tekst is geen rooster', looksLikeScheduleText('hallo wereld'), false);

// without the sample (CI, fresh clone) the checks below are skipped; tests/shift.test.ts covers the text route
if (haveSample) {
  const result = parseScheduleText(text);
  check('herkend als rooster', looksLikeScheduleText(text), true);
  check('dagen', result.days.map((d) => ({ date: d.date, off: d.off, reason: d.offReason })), [
    { date: '2026-10-05', off: false, reason: null },
    { date: '2026-10-06', off: true, reason: 'Vrij' },
    { date: '2026-10-07', off: false, reason: null },
    { date: '2026-10-08', off: true, reason: 'Vrij' },
    { date: '2026-10-09', off: false, reason: null },
    { date: '2026-10-10', off: true, reason: 'Verlof' },
    { date: '2026-10-11', off: false, reason: null },
  ]);
  check('shifts', result.shifts.map((s) => ({ date: s.date, start: s.start, end: s.end, activities: s.activities.length, warnings: s.warnings.length })), [
    { date: '2026-10-05', start: '13:30', end: '22:00', activities: 4, warnings: 0 },
    { date: '2026-10-07', start: '09:30', end: '18:00', activities: 4, warnings: 0 },
    { date: '2026-10-09', start: '09:30', end: '18:00', activities: 6, warnings: 0 },
    { date: '2026-10-11', start: '13:30', end: '22:00', activities: 4, warnings: 0 },
  ]);
  check('activiteitlabels schoon', result.shifts[0].activities.map((a) => a.label), ['Voice', 'Lunch', 'Voice', 'Messaging OEC']);
  check('notitie achter tijd negeren', result.shifts[2].activities[1], { label: 'E-Learning', start: '12:30', end: '13:00', y: result.shifts[2].activities[1].y, repaired: false, conf: 100 });
  check('geen waarschuwingen', result.warnings, []);

  const spaces = parseScheduleText(text.replace(/\t/g, ' '));
  check('werkt ook zonder tabs', spaces.shifts.length, 4);

  const night = parseScheduleText('vrijdag 2 oktober 2026\n22:00 - 06:30\nVoice_1234567 22:00 - 06:30\n');
  check('nachtshift', [night.shifts[0].endsNextDay, night.shifts[0].start], [true, '22:00']);
}
