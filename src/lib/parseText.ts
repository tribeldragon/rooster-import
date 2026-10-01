/**
 * Parse a schedule that was copied as text (select the table in the roster page, Ctrl+C)
 * instead of read from a screenshot. The text is exact, so no OCR repair is needed.
 */
import {
  DAY_NAMES, MONTHS, OFFICE_ACTIVITIES, detectAbsence, minutesOf, officeIn, pad2, shiftTitle, weekdayOf,
  type Activity, type DayRow, type ParseResult, type Shift,
} from './parse';

const DAY_HEADER_RE = new RegExp(`\\b(${DAY_NAMES.join('|')})\\s+(\\d{1,2})\\s+(${MONTHS.join('|')})\\s+(\\d{4})\\b`, 'i');
const DECLARED_SHIFT_RE = /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\b/;
const ACTIVITY_RE = /^(?:\d+\.\s*)?(.+?)\s+(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/;

const time = (h: string, m: string) => `${pad2(+h)}:${m}`;

function activityLabel(raw: string): string {
  const s = raw.replace(/[_\s]*\d{4,}$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.replace(/^(.)/, (c) => c.toUpperCase()) : 'Activiteit';
}

/** True when the text looks like a copied roster, so a paste can be told apart from other text. */
export function looksLikeScheduleText(text: string): boolean {
  return text.split(/\r?\n/).some((l) => DAY_HEADER_RE.test(l));
}

export function parseScheduleText(text: string, officeList: string[] = OFFICE_ACTIVITIES): ParseResult {
  const warnings: string[] = [];
  const days: DayRow[] = [];
  const dayActs: Activity[][] = [];

  text.split(/\r?\n/).forEach((rawLine, y) => {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) return;

    const header = line.match(DAY_HEADER_RE);
    if (header) {
      const month = MONTHS.indexOf(header[3].toLowerCase()) + 1;
      const date = `${header[4]}-${pad2(month)}-${pad2(+header[2])}`;
      days.push({
        index: days.length, raw: line, dayName: weekdayOf(date), date,
        off: false, offReason: null, y, declaredShift: null,
      });
      dayActs.push([]);
      return;
    }
    const day = days[days.length - 1];
    if (!day) return;

    const declared = line.match(DECLARED_SHIFT_RE);
    if (declared) {
      day.declaredShift = { start: time(declared[1], declared[2]), end: time(declared[3], declared[4]) };
      return;
    }
    const act = line.match(ACTIVITY_RE);
    if (act) {
      dayActs[dayActs.length - 1].push({
        label: activityLabel(act[1]), start: time(act[2], act[3]), end: time(act[4], act[5]),
        y, repaired: false, conf: 100,
      });
      return;
    }
    // Skip the approval history table that follows a leave entry.
    if (/^\d{2}\/\d{2}\/\d{4}/.test(line)) return;
    const reason = detectAbsence(line.split(/Last Modified/i)[0]);
    // "Afwezig"/"Vrij" is only the generic status; a later line names the real reason (Verlof, Ziek, ...).
    if (reason && (!day.off || day.offReason === 'Afwezig' || day.offReason === 'Vrij')) { day.off = true; day.offReason = reason; }
  });

  const shifts: Shift[] = [];
  days.forEach((day, i) => {
    if (day.off) return;
    const acts = dayActs[i];
    const start = acts[0]?.start ?? day.declaredShift?.start;
    const end = acts[acts.length - 1]?.end ?? day.declaredShift?.end;
    if (!start || !end) {
      warnings.push(`Geen shift gevonden voor ${day.dayName} (${day.date}) — voeg deze handmatig toe.`);
      return;
    }
    const shiftWarnings: string[] = [];
    if (!acts.length) shiftWarnings.push('Geen activiteiten gevonden; shifttijd komt uit de shiftregel.');
    else if (day.declaredShift && (day.declaredShift.start !== start || day.declaredShift.end !== end)) {
      shiftWarnings.push(`Shifttijd (${day.declaredShift.start} - ${day.declaredShift.end}) wijkt af van de activiteiten (${start} - ${end}).`);
    }
    const officeActivities = officeIn(acts, officeList);
    shifts.push({
      id: `${day.date}-${start}-${i}`,
      date: day.date, dayName: day.dayName,
      start, end, endsNextDay: minutesOf(end) <= minutesOf(start),
      activities: acts, warnings: shiftWarnings, include: true,
      title: shiftTitle('Werk', officeActivities),
      officeActivities,
    });
  });

  if (!days.length) warnings.push('Geen dagen herkend in de geplakte tekst. Kopieer de hele roostertabel, inclusief de datums.');
  return { days, shifts, warnings, splitX: 0 };
}
