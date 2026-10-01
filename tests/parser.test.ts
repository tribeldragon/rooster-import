/**
 * Regression test for the parser, run against real Tesseract output recorded
 * from samples/week-2026-09-07.png (fixture.json).
 *
 *   npm test
 */
import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSchedule, reconcileDates, parseTimeRange, detectAbsence, type OcrWord } from '../src/lib/parse';

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

const check = (label: string, actual: unknown, expected: unknown) =>
  test(label, () => expect(actual).toEqual(expected));

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

/*
 * Regression: when a block's y-band lands inside no day row at all (e.g. the
 * day it truly belongs to had all its own activities fail to OCR, throwing
 * off spacing), it used to fall back to position-in-sequence among working
 * days - silently mis-assigning it to whichever day happened to be first.
 * Picking the nearest day by vertical distance instead gets this right.
 */
const nearestDaySynthetic = parseSchedule({
  fullWords: [
    { text: 'maandag 5 januari 2026', conf: 90, x0: 10, x1: 160, y0: 10, y1: 16 },
    { text: 'dinsdag 6 januari 2026', conf: 90, x0: 10, x1: 160, y0: 200, y1: 206 },
    { text: 'Voice 09:00 - 10:00', conf: 90, x0: 650, x1: 900, y0: 140, y1: 146 },
  ],
  imageWidth: 1000,
  fallbackYear: 2026,
});
check('dichtstbijzijnde dag: precies één shift', nearestDaySynthetic.shifts.length, 1);
check('dichtstbijzijnde dag: shift toegewezen aan dinsdag, niet maandag', nearestDaySynthetic.shifts[0]?.dayName, 'dinsdag');

/* Regression: OCR-confused letters standing in for digits inside a time range. */
check(
  'digit-fix: letters die op cijfers lijken worden hersteld',
  parseTimeRange('Voice O9:3O - 12:0O'),
  { start: '09:30', end: '12:00', rest: 'Voice' },
);

/*
 * Regression: the first activity of a shift has no predecessor to repair its
 * start time against, unlike later activities in the chain. Use the shift's
 * declared start time (left column) as the trusted anchor instead.
 */
const firstActivitySynthetic = parseSchedule({
  fullWords: [
    { text: 'maandag 7 september', conf: 90, x0: 10, x1: 160, y0: 97, y1: 103 },
    { text: '09:30 - 18:00', conf: 90, x0: 10, x1: 160, y0: 105, y1: 111 },
    { text: 'Voice 09:35 - 18:00', conf: 90, x0: 650, x1: 900, y0: 98, y1: 104 },
  ],
  imageWidth: 1000,
  fallbackYear: 2026,
});
const firstActivityShift = firstActivitySynthetic.shifts[0];
check(
  'eerste activiteit: starttijd hersteld naar linkerkolom',
  firstActivityShift?.activities[0] && {
    start: firstActivityShift.activities[0].start,
    repaired: firstActivityShift.activities[0].repaired,
  },
  { start: '09:30', repaired: true },
);
check('eerste activiteit: shift-starttijd volgt de correctie', firstActivityShift?.start, '09:30');

/* Regression: OCR-mangled absence labels must still be recognised. */
check('afwezigheid: vrij', detectAbsence('Vrij'), 'Vrij');
check('afwezigheid: vrij (OCR vri)', detectAbsence('Vri'), 'Vrij');
check('afwezigheid: verlof', detectAbsence('Verlof'), 'Verlof');
check('afwezigheid: verlof (OCR verlot)', detectAbsence('Verlot'), 'Verlof');
check('afwezigheid: vakantie', detectAbsence('Vakantie'), 'Vakantie');
check('afwezigheid: ziek', detectAbsence('Ziek'), 'Ziek');
check('afwezigheid: ziek (OCR z1ek)', detectAbsence('Z1ek'), 'Ziek');
check('afwezigheid: medisch verlof', detectAbsence('Medisch verlof'), 'Medisch verlof');
check('afwezigheid: medisch verlof (OCR medlsch verlot)', detectAbsence('Medlsch Verlot'), 'Medisch verlof');
check('afwezigheid: medisch verlof (omgekeerde woordvolgorde)', detectAbsence('Verlof Medisch'), 'Medisch verlof');
check('afwezigheid: geen match op een tijdrange', detectAbsence('09:30 - 18:00'), null);
check('afwezigheid: geen match op "Voice"', detectAbsence('Voice'), null);

// Real tester screenshot (IMG-20260925-WA0003): noisy OCR, colons dropped, date-carrying
// time cells, an echoed activity on an off day. Shift times must still come out exact.
const wa = JSON.parse(fs.readFileSync(path.join(here, 'fixture-wa0003.json'), 'utf8'));
const waResult = parseSchedule({ fullWords: wa.fullWords, leftWords: wa.leftWords, timeWords: wa.timeWords, imageWidth: wa.imageWidth, fallbackYear: 2026 });
check(
  'wa0003: shifts',
  waResult.shifts.map((s) => `${s.date} ${s.start}-${s.end}${s.endsNextDay ? '+1' : ''}`),
  ['2026-10-21 16:30-01:00+1', '2026-10-24 13:30-22:00', '2026-10-25 16:30-01:00+1'],
);
check('wa0003: woensdag heeft 7 activiteiten', waResult.shifts[0]?.activities.length, 7);

// Week over de jaarwisseling, datums zonder jaar (di 29 dec - ma 4 jan)
const nye = [29, 30, 31, 1, 2, 3, 4].map((day, index) => ({
  raw: { dayName: null, day, month: day > 20 ? 12 : 1, year: null }, index,
}));
check('jaarwisseling: begin in december (vandaag 30 dec 2026)', reconcileDates(nye, 2026, new Date(2026, 11, 30)).anchor, '2026-12-29');
check('jaarwisseling: week bekeken in januari erna', reconcileDates(nye, 2027, new Date(2027, 0, 2)).anchor, '2026-12-29');
check('jaarwisseling: zonder referentiedatum geldt fallbackYear', reconcileDates(nye.slice(0, 3), 2026).anchor, '2026-12-29');

// Same screenshot at another resolution: all coordinates scale, the result must not change.
for (const f of [0.7, 1.5, 2]) {
  const sc = (ws: OcrWord[]) => ws.map((w) => ({ ...w, x0: w.x0 * f, x1: w.x1 * f, y0: w.y0 * f, y1: w.y1 * f }));
  const scaled = parseSchedule({ fullWords: sc(fixture.full), leftWords: sc(fixture.left), imageWidth: fixture.width * f, fallbackYear: 2026 });
  check(
    `schaal x${f}: zelfde shifts`,
    scaled.shifts.map((x) => ({ date: x.date, start: x.start, end: x.end, activities: x.activities.length })),
    expectedShifts,
  );
}

