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
check('titel "Werk | Coaching | Kantoor" bij coaching', mon?.title, 'Werk | Coaching | Kantoor');

/*
 * Regression: a misread boundary time (e.g. around lunch/an event) used to
 * break the back-to-back match and split one working day into two shifts.
 * Synthetic input: one day, three activities, where the 2nd activity's OCR'd
 * start ("12:05") doesn't match the 1st activity's end ("12:00").
 */
const splitDaySynthetic = parseSchedule({
  fullWords: [
    { text: 'maandag 7 september', conf: 90, x0: 10, x1: 160, y0: 97, y1: 103 },
    { text: 'Voice 09:00 - 12:00', conf: 90, x0: 650, x1: 900, y0: 98, y1: 104 },
    { text: 'Coaching 12:05 - 12:30', conf: 90, x0: 650, x1: 900, y0: 110, y1: 116 },
    { text: 'Voice 12:30 - 16:00', conf: 90, x0: 650, x1: 900, y0: 122, y1: 128 },
  ],
  imageWidth: 1000,
  fallbackYear: 2026,
});
check('gesplitste dag: precies één shift', splitDaySynthetic.shifts.length, 1);
const splitDay = splitDaySynthetic.shifts[0];
check('gesplitste dag: alle activiteiten samengevoegd', splitDay?.activities.length, 3);
check('gesplitste dag: starttijd van shift', splitDay?.start, '09:00');
check('gesplitste dag: eindtijd van shift', splitDay?.end, '16:00');
check(
  'gesplitste dag: misread grenstijd hersteld',
  splitDay?.activities[1] && { start: splitDay.activities[1].start, repaired: splitDay.activities[1].repaired },
  { start: '12:00', repaired: true },
);
check('gesplitste dag: titel bevat Coaching', splitDay?.title, 'Werk | Coaching | Kantoor');

console.log('\n--- omschrijving maandag ---\n' + shiftDescription(mon));
console.log(`\n${failures ? `${failures} test(s) MISLUKT` : 'Alle tests geslaagd'}`);
process.exit(failures ? 1 : 0);
