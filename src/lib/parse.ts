/**
 * Pure parsing logic: Tesseract word boxes -> structured shifts.
 * No DOM / browser APIs here so it can be unit-tested with plain node.
 */

export interface OcrWord {
  text: string;
  conf: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Activity {
  label: string;
  start: string; // "HH:MM"
  end: string;
  y: number;
  repaired: boolean;
  /** Lowest word confidence (0-100) behind this activity's OCR line. */
  conf: number;
}

/** Below this Tesseract confidence, an activity is flagged for manual review. */
export const LOW_CONF_THRESHOLD = 60;

export interface DayRow {
  index: number;
  raw: string;
  dayName: string | null;
  date: string | null; // ISO yyyy-mm-dd
  off: boolean;
  y: number;
  declaredShift: { start: string; end: string } | null;
}

export interface Shift {
  id: string;
  date: string | null;
  dayName: string | null;
  start: string;
  end: string;
  endsNextDay: boolean;
  activities: Activity[];
  warnings: string[];
  include: boolean;
  title: string;
  /** Which OFFICE_ACTIVITIES occur during this shift, in order of first occurrence. */
  officeActivities: string[];
}

export interface ParseResult {
  days: DayRow[];
  shifts: Shift[];
  warnings: string[];
  splitX: number;
}

export const DAY_NAMES = [
  'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag',
];

export const MONTHS = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
];

/* ------------------------------------------------------------------ utils */

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

/** Fuzzy-match a (possibly OCR-mangled) token against a list of known words. */
export function fuzzyIndex(token: string, list: string[], maxDist = 3): number {
  const t = token.toLowerCase().replace(/[^a-z]/g, '');
  if (!t) return -1;
  let best = -1, bestD = Infinity;
  list.forEach((cand, i) => {
    const d = editDistance(t, cand);
    // allow more slack on longer words, less on short ones
    const limit = Math.min(maxDist, Math.max(1, Math.floor(cand.length / 3)));
    if (d <= limit && d < bestD) { bestD = d; best = i; }
  });
  return best;
}

const DIGIT_FIXES: Record<string, string> = {
  o: '0', O: '0', Q: '0', D: '0',
  l: '1', I: '1', i: '1', '|': '1', ']': '1', '[': '1',
  z: '2', Z: '2',
  s: '5', S: '5',
  b: '6', G: '6',
  t: '7', T: '7',
  B: '8', '&': '8',
  g: '9', q: '9',
};

function digitsOnly(token: string): string {
  return token
    .split('')
    .map((c) => (/[0-9]/.test(c) ? c : DIGIT_FIXES[c] ?? ''))
    .join('');
}

export function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}

function validTime(h: number, m: number): boolean {
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/** Digits, or a lone OCR-confusable letter/symbol standing in for one. */
const DIGITISH = '[0-9oOQDlIi|\\]\\[zZsSbGtTB&gq]';

/** Pull the trailing "HH:MM - HH:MM" (colons optional, sloppy separators) out of a line. */
export function parseTimeRange(text: string): { start: string; end: string; rest: string } | null {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const re = new RegExp(
    `(${DIGITISH}{1,2})\\s*[:.;']?\\s*(${DIGITISH}{2})\\s*[-–—~=_>]+\\s*(${DIGITISH}{1,2})\\s*[:.;']?\\s*(${DIGITISH}{2})\\.?\\s*$`,
  );
  const m = cleaned.match(re);
  if (!m) return null;
  const h1 = +digitsOnly(m[1]), m1 = +digitsOnly(m[2]), h2 = +digitsOnly(m[3]), m2 = +digitsOnly(m[4]);
  if (!validTime(h1, m1) || !validTime(h2, m2)) return null;
  return {
    start: pad2(h1) + ':' + pad2(m1),
    end: pad2(h2) + ':' + pad2(m2),
    rest: cleaned.slice(0, m.index).trim(),
  };
}

/* ------------------------------------------------------------- line building */

export interface OcrLine {
  text: string;
  words: OcrWord[];
  y: number;
  yMin: number;
  yMax: number;
  x0: number;
  /** Lowest word confidence (0-100) on the line. */
  conf: number;
}

export function toLines(words: OcrWord[], tolerance = 6): OcrLine[] {
  const sorted = [...words].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const lines: OcrWord[][] = [];
  for (const w of sorted) {
    const cy = (w.y0 + w.y1) / 2;
    const last = lines[lines.length - 1];
    if (last) {
      const lastCy = last.reduce((s, x) => s + (x.y0 + x.y1) / 2, 0) / last.length;
      if (Math.abs(cy - lastCy) <= tolerance) { last.push(w); continue; }
    }
    lines.push([w]);
  }
  return lines.map((ws) => {
    ws.sort((a, b) => a.x0 - b.x0);
    return {
      words: ws,
      text: ws.map((w) => w.text).join(' '),
      y: ws.reduce((s, w) => s + (w.y0 + w.y1) / 2, 0) / ws.length,
      yMin: Math.min(...ws.map((w) => w.y0)),
      yMax: Math.max(...ws.map((w) => w.y1)),
      x0: Math.min(...ws.map((w) => w.x0)),
      conf: Math.min(...ws.map((w) => w.conf)),
    };
  });
}

/* ------------------------------------------------------------------- dates */

export interface RawDate { dayName: string | null; day: number | null; month: number | null; year: number | null }

export function parseDutchDate(text: string): RawDate | null {
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  let dayName: string | null = null, day: number | null = null, month: number | null = null, year: number | null = null;
  for (const tok of tokens) {
    const alpha = tok.toLowerCase().replace(/[^a-z]/g, '');
    if (alpha.length >= 3) {
      const di = fuzzyIndex(alpha, DAY_NAMES);
      if (di >= 0 && dayName === null) { dayName = DAY_NAMES[di]; continue; }
      const mi = fuzzyIndex(alpha, MONTHS);
      if (mi >= 0 && month === null) { month = mi + 1; continue; }
    }
    const d = digitsOnly(tok);
    if (d.length === 4 && +d >= 1990 && +d <= 2100 && year === null) { year = +d; continue; }
    if ((d.length === 1 || d.length === 2) && +d >= 1 && +d <= 31 && day === null) { day = +d; continue; }
  }
  if (month === null && dayName === null) return null;
  return { dayName, day, month, year };
}

function isoOf(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return isoOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function weekdayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = sunday
  return DAY_NAMES[(dow + 6) % 7];
}

/**
 * Rows are consecutive calendar days, so a single confident row fixes them all.
 * We take the most common implied "row 0" date as the anchor.
 */
export function reconcileDates(
  rows: { raw: RawDate | null; index: number }[],
  fallbackYear: number,
): { anchor: string | null; warnings: string[] } {
  const votes = new Map<string, number>();
  const warnings: string[] = [];
  for (const r of rows) {
    if (!r.raw || r.raw.day === null || r.raw.month === null) continue;
    const year = r.raw.year ?? fallbackYear;
    const iso = isoOf(year, r.raw.month, r.raw.day);
    if (isNaN(Date.parse(iso))) continue;
    const anchor = addDays(iso, -r.index);
    votes.set(anchor, (votes.get(anchor) ?? 0) + 1);
    // weekday cross-check
    if (r.raw.dayName && weekdayOf(iso) !== r.raw.dayName) {
      warnings.push(`Datum "${r.raw.dayName} ${r.raw.day}" komt niet overeen met de kalender (${weekdayOf(iso)}).`);
    }
  }
  if (!votes.size) return { anchor: null, warnings };
  let anchor: string | null = null, best = 0;
  for (const [k, v] of votes) if (v > best) { best = v; anchor = k; }
  if (votes.size > 1) warnings.push('Niet alle datums in de linkerkolom waren consistent; de meest voorkomende reeks is gebruikt.');
  return { anchor, warnings };
}

/* -------------------------------------------------------------- activities */

const KNOWN_ACTIVITIES = ['Voice', 'Admin Klant', 'Lunch', 'Chat', 'Coaching', 'Overleg', 'Systeemstoring', 'Training', 'Pauze', 'Meeting', 'Email', 'Backoffice'];

/** Break activity labels: they don't count as "working" but stay inside the shift. */
export const BREAK_ACTIVITIES = ['Lunch', 'Pauze'];

/** If any of these activities occur during a shift, the event title becomes "Werk | Kantoor". */
export const OFFICE_ACTIVITIES = ['Overleg', 'Coaching'];

export function cleanLabel(raw: string): string {
  let s = raw
    .replace(/[_\s]*\d{4,}\.?$/, '')       // trailing id: Voice_3098328
    .replace(/[_\s]*\d{4,}[^A-Za-z]*$/, '')
    .replace(/[|\[\]{}<>*·•]/g, ' ')
    .trim();
  // strip leading colour-swatch noise ("B", "Hl", "Mj", "ll", "I")
  const toks = s.split(/\s+/).filter(Boolean);
  while (toks.length > 1 && toks[0].length <= 2 && !/^[A-Z][a-z]$/.test(toks[0])) toks.shift();
  s = toks.join(' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const i = fuzzyIndex(s, KNOWN_ACTIVITIES.map((k) => k.toLowerCase()), 3);
  if (i >= 0) return KNOWN_ACTIVITIES[i];
  return s.replace(/^(.)/, (c) => c.toUpperCase());
}

/**
 * Within a shift, activities run back-to-back; use that to repair sloppy OCR.
 * The first activity has no predecessor to repair against — pass the shift's
 * declared start time (from the left column) as its trusted anchor, if known.
 */
function repairChain(acts: Activity[], declaredStart?: string): void {
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i];
    if (i > 0) {
      const prevEnd = acts[i - 1].end;
      if (a.start !== prevEnd) { a.start = prevEnd; a.repaired = true; }
    } else if (declaredStart && a.start !== declaredStart) {
      a.start = declaredStart; a.repaired = true;
    }
    if (minutesOf(a.end) <= minutesOf(a.start)) {
      const next = acts[i + 1];
      if (next && minutesOf(next.start) > minutesOf(a.start)) { a.end = next.start; a.repaired = true; }
    }
  }
}

/** Column 2 ("Activiteiten") starts at its header; fall back to a fixed ratio if not found. */
export function computeSplitX(fullWords: OcrWord[], imageWidth: number): { splitX: number; found: boolean } {
  const header = fullWords.find((w) => fuzzyIndex(w.text, ['activiteiten'], 3) === 0);
  return { splitX: header ? header.x0 - 8 : Math.round(imageWidth * 0.594), found: !!header };
}

/* ------------------------------------------------------------------- main */

export interface ParseInput {
  fullWords: OcrWord[];
  leftWords?: OcrWord[];
  imageWidth: number;
  fallbackYear?: number;
}

export function parseSchedule(input: ParseInput): ParseResult {
  const { fullWords, imageWidth } = input;
  const fallbackYear = input.fallbackYear ?? new Date().getFullYear();
  const warnings: string[] = [];

  // --- column split: the "Activiteiten" header marks the start of column 2
  const { splitX, found: splitFound } = computeSplitX(fullWords, imageWidth);
  if (!splitFound) warnings.push('Kolomkop "Activiteiten" niet gevonden; kolomgrens geschat.');

  // --- left column: dates, "vrij", declared shift times
  const leftSource = (input.leftWords && input.leftWords.length ? input.leftWords : fullWords).filter(
    (w) => (w.x0 + w.x1) / 2 < splitX,
  );
  const leftLines = toLines(leftSource);

  const days: DayRow[] = [];
  const rawDates: { raw: RawDate | null; index: number }[] = [];
  for (const line of leftLines) {
    const lower = line.text.toLowerCase();
    if (/^shift\b/.test(lower.trim())) continue;
    const raw = parseDutchDate(line.text);
    const looksLikeDate = raw && (raw.dayName !== null || (raw.month !== null && raw.day !== null));
    if (looksLikeDate) {
      days.push({
        index: days.length, raw: line.text, dayName: raw!.dayName, date: null,
        off: false, y: line.y, declaredShift: null,
      });
      rawDates.push({ raw, index: days.length - 1 });
      continue;
    }
    const current = days[days.length - 1];
    if (!current) continue;
    if (/vrij|verlof|vakantie|vrjj|vri/.test(lower.replace(/[^a-z]/g, ''))) { current.off = true; continue; }
    const tr = parseTimeRange(line.text.replace(/[^\d\s:.\-–—~=]/g, ' '));
    if (tr) current.declaredShift = { start: tr.start, end: tr.end };
  }

  const { anchor, warnings: dateWarnings } = reconcileDates(rawDates, fallbackYear);
  warnings.push(...dateWarnings);
  if (anchor) {
    days.forEach((d) => {
      d.date = addDays(anchor, d.index);
      d.dayName = weekdayOf(d.date);
    });
  } else {
    warnings.push('Geen datum herkend in de linkerkolom — vul de begindatum van de week zelf in.');
  }

  // --- right column: activities
  const rightLines = toLines(fullWords.filter((w) => (w.x0 + w.x1) / 2 >= splitX));
  const activities: Activity[] = [];
  for (const line of rightLines) {
    const tr = parseTimeRange(line.text);
    if (!tr) continue;
    const label = cleanLabel(tr.rest);
    if (!label && !tr.rest) continue;
    activities.push({ label: label || 'Activiteit', start: tr.start, end: tr.end, y: line.y, repaired: false, conf: line.conf });
  }
  activities.sort((a, b) => a.y - b.y);

  // --- group activities into chains (a shift's activities run back-to-back)
  let chains: Activity[][] = [];
  for (const a of activities) {
    const chain = chains[chains.length - 1];
    const prev = chain?.[chain.length - 1];
    if (!prev || prev.end !== a.start) chains.push([a]);
    else chain.push(a);
  }

  // --- attach each chain to the day label that sits inside its vertical band
  const pad = 6;
  const labelFor = (chain: Activity[]): DayRow[] => {
    const yMin = Math.min(...chain.map((a) => a.y)) - 14;
    const yMax = Math.max(...chain.map((a) => a.y)) + 14;
    return days.filter((d) => d.y >= yMin - pad && d.y <= yMax + pad);
  };

  // Merge chains that are really one working day split in two: either the block
  // carries no day label of its own, or it lands on the *same* single day as the
  // previous block (a misread boundary time - e.g. around lunch or a one-off
  // event - breaks the back-to-back match even though it's still one shift).
  // A working day only ever produces one shift/event, so never leave it split.
  const merged: Activity[][] = [];
  for (const chain of chains) {
    const hits = labelFor(chain);
    const prevChain = merged[merged.length - 1];
    const prevHits = prevChain ? labelFor(prevChain) : [];
    const sameDay = hits.length === 1 && prevHits.length === 1 && hits[0] === prevHits[0];
    if (prevChain && (!hits.length || sameDay)) prevChain.push(...chain);
    else merged.push(chain);
  }
  chains = merged;

  const shifts: Shift[] = [];
  const workingDays = days.filter((d) => !d.off);
  chains.forEach((chain, ci) => {
    const chainWarnings: string[] = [];
    const hits = labelFor(chain);
    let day: DayRow | undefined = hits[0];
    if (hits.length > 1) {
      chainWarnings.push('Meerdere dagen gevonden bij dit blok; controleer de datum.');
      day = hits[0];
    }
    if (!day) {
      day = workingDays[ci];
      if (day) chainWarnings.push('Datum afgeleid uit de volgorde van de blokken.');
      else chainWarnings.push('Geen datum gevonden voor dit blok.');
    }
    repairChain(chain, day?.declaredShift?.start);
    const start = chain[0].start;
    const end = chain[chain.length - 1].end;
    const endsNextDay = minutesOf(end) <= minutesOf(start);
    if (day?.declaredShift) {
      if (day.declaredShift.start !== start || day.declaredShift.end !== end) {
        chainWarnings.push(
          `Shifttijd in de linkerkolom (${day.declaredShift.start} - ${day.declaredShift.end}) wijkt af van de activiteiten (${start} - ${end}).`,
        );
      }
    }
    if (chain.some((a) => a.repaired)) chainWarnings.push('Eén of meer activiteittijden zijn automatisch gecorrigeerd.');
    if (chain.some((a) => a.conf < LOW_CONF_THRESHOLD)) chainWarnings.push('Eén of meer activiteiten hebben een lage OCR-betrouwbaarheid; controleer ze.');
    const officeActivities = [...new Set(chain.map((a) => a.label).filter((l) => OFFICE_ACTIVITIES.includes(l)))];
    shifts.push({
      id: `${day?.date ?? 'onbekend'}-${start}-${ci}`,
      date: day?.date ?? null,
      dayName: day?.dayName ?? null,
      start, end, endsNextDay,
      activities: chain,
      warnings: chainWarnings,
      include: true,
      title: officeActivities.length ? `Werk | ${officeActivities.join(', ')} | Kantoor` : 'Werk',
      officeActivities,
    });
  });

  if (chains.length !== workingDays.length && days.length) {
    warnings.push(
      `${chains.length} shiftblok(ken) gevonden voor ${workingDays.length} werkdag(en) — controleer de tabel hieronder.`,
    );
  }
  if (!shifts.length) warnings.push('Geen activiteiten herkend. Probeer een scherpere of grotere screenshot.');

  return { days, shifts, warnings, splitX };
}

/* --------------------------------------------------------- event rendering */

export function shiftDescription(shift: Shift): string {
  const lines = shift.activities.map((a) => `${a.start} - ${a.end}  ${a.label}${a.repaired ? ' (gecorrigeerd)' : ''}`);
  const totals = new Map<string, number>();
  for (const a of shift.activities) {
    let dur = minutesOf(a.end) - minutesOf(a.start);
    if (dur < 0) dur += 1440;
    totals.set(a.label, (totals.get(a.label) ?? 0) + dur);
  }
  const summary = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, min]) => `${label}: ${Math.floor(min / 60)}u${pad2(min % 60)}`)
    .join(' · ');
  return [...lines, '', summary, '', 'Geïmporteerd uit rooster-screenshot.'].join('\n');
}

/** Deterministic per-shift event id so re-importing updates instead of duplicating. */
export function eventIdFor(shift: Shift): string {
  const d = (shift.date ?? '').replace(/-/g, '');
  const t = shift.start.replace(':', '');
  return `rooster${d}t${t}`;
}
