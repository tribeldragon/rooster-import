/**
 * Regression test for the parser, run against real Tesseract output recorded
 * from samples/week-2026-09-07.png (fixture.json).
 *
 *   npm run test:parser
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSchedule, shiftDescription, type OcrWord } from '../src/lib/parse.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(here, 'fixture.json'), 'utf8')) as {
  width: number; height: number; full: OcrWord[]; left: OcrWord[];
};

const result = parseSchedule({
  fullWords: fixture.full,
  leftWords: fixture.left,
  imageWidth: fixture.width,
  fallbackYear: 2026,
});

const expectedDays = [
  { date: '2026-09-07', off: false },
  { date: '2026-09-08', off: true },
  { date: '2026-09-09', off: false },
  { date: '2026-09-10', off: false },
  { date: '2026-09-11', off: true },
  { date: '2026-09-12', off: false },
  { date: '2026-09-13', off: false },
];

const expectedShifts = [
  { date: '2026-09-07', start: '09:30', end: '18:00', activities: 9 },
  { date: '2026-09-09', start: '08:00', end: '16:30', activities: 5 },
  { date: '2026-09-10', start: '10:30', end: '19:00', activities: 4 },
  { date: '2026-09-12', start: '11:30', end: '20:00', activities: 12 },
  { date: '2026-09-13', start: '13:30', end: '22:00', activities: 4 },
];

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : `\n     verwacht: ${JSON.stringify(expected)}\n     gekregen: ${JSON.stringify(actual)}`}`);
}

check('aantal dagen', result.days.length, expectedDays.length);
check(
  'datums + vrije dagen',
  result.days.map((d) => ({ date: d.date, off: d.off })),
  expectedDays,
);
check(
  'shifts',
  result.shifts.map((s) => ({ date: s.date, start: s.start, end: s.end, activities: s.activities.length })),
  expectedShifts,
);
check('geen onbekende datums', result.shifts.filter((s) => !s.date).length, 0);

const mon = result.shifts[0];
check('eerste activiteit maandag', mon?.activities[0]?.label, 'Voice');
check('lunch herkend', mon?.activities.some((a) => a.label === 'Lunch'), true);
check('coaching herkend', mon?.activities.some((a) => a.label === 'Coaching'), true);

console.log('\n--- omschrijving maandag ---\n' + shiftDescription(mon));
console.log(`\n${failures ? `${failures} test(s) MISLUKT` : 'Alle tests geslaagd'}`);
process.exit(failures ? 1 : 0);
