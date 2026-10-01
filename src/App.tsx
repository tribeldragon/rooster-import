import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  parseSchedule, addDays, minutesOf, officeIn, shiftTitle, OFFICE_ACTIVITIES,
  type ParseResult, type Shift,
} from './lib/parse';
import { parseScheduleText, looksLikeScheduleText } from './lib/parseText';
import { fileToDataUrl, runOcr, type Progress } from './lib/ocr';
import type { EventSettings } from './lib/calendar';
import { storeGet, storeSet } from './lib/storage';
import { downloadIcs } from './lib/ics';
import { useCalendar } from './hooks/useCalendar';
import { UploadPanel } from './components/UploadPanel';
import { ShiftTable } from './components/ShiftTable';
import { CalendarPanel } from './components/CalendarPanel';

interface Settings extends EventSettings {
  defaultTitle: string;
  /** Comma-separated activity names that make a shift an office shift. */
  officeActivities: string;
}

const SETTINGS_KEY = 'rooster-import.settings';
const THEME_KEY = 'rooster-import.theme';

const defaultSettings: Settings = {
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Amsterdam',
  reminderMinutes: null,
  defaultTitle: 'Werk',
  officeActivities: OFFICE_ACTIVITIES.join(', '),
};

function loadSettings(): Settings {
  try {
    const raw = storeGet(SETTINGS_KEY);
    if (raw) {
      const { clientId: _old, ...stored } = JSON.parse(raw); // client IDs now come from .env only
      return { ...defaultSettings, ...stored } as Settings;
    }
  } catch { /* ignore */ }
  return defaultSettings;
}

const splitList = (list: string) => list.split(',').map((s) => s.trim()).filter(Boolean);

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'),
  );

  const cal = useCalendar(settings, setError);

  useEffect(() => { storeSet(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    storeSet(THEME_KEY, theme);
  }, [theme]);

  /* ------------------------------------------------------------ screenshot */

  const applyParsed = useCallback((parsed: ParseResult) => {
    setResult(parsed);
    setShifts(parsed.shifts.map((s) => ({ ...s, title: shiftTitle(settings.defaultTitle, s.officeActivities) })));
  }, [settings.defaultTitle]);

  const ocrRunning = useRef(false);

  const handleImage = useCallback(async (file: File | Blob) => {
    if (ocrRunning.current) return; // one OCR run at a time; a second would race the first
    ocrRunning.current = true;
    setError(null);
    setResult(null);
    setShifts([]);
    cal.resetImportState();
    try {
      const dataUrl = await fileToDataUrl(file);
      setImageUrl(dataUrl);
      setProgress({ stage: 'Starten', progress: 0 });
      const ocr = await runOcr(dataUrl, setProgress);
      applyParsed(parseSchedule({
        fullWords: ocr.fullWords,
        leftWords: ocr.leftWords,
        timeWords: ocr.timeWords,
        imageWidth: ocr.width,
        fallbackYear: new Date().getFullYear(),
        today: new Date(),
        officeActivities: splitList(settings.officeActivities),
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      ocrRunning.current = false;
      setProgress(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyParsed, settings.officeActivities]);

  /** Copied roster text: exact, so no OCR needed. */
  const handleText = useCallback((text: string) => {
    setError(null);
    cal.resetImportState();
    setImageUrl(null);
    applyParsed(parseScheduleText(text, splitList(settings.officeActivities)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyParsed, settings.officeActivities]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) { e.preventDefault(); void handleImage(file); return; }
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return; // normal paste in a field
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (looksLikeScheduleText(text)) { e.preventDefault(); handleText(text); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleImage, handleText]);

  /* ---------------------------------------------------------- shift edits */

  const patchShift = (id: string, patch: Partial<Shift>) =>
    setShifts((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      const next = { ...s, ...patch };
      // a hand-edited time can move the end across midnight (or back)
      if ('start' in patch || 'end' in patch) next.endsNextDay = minutesOf(next.end) <= minutesOf(next.start);
      return next;
    }));

  const removeShift = (id: string) => {
    setShifts((prev) => prev.filter((s) => s.id !== id));
    cal.dropImportState(id);
  };

  /** Clear the table without touching the calendar session. */
  const clearAll = () => {
    setResult(null);
    setShifts([]);
    cal.resetImportState();
    setImageUrl(null);
    setError(null);
  };

  const firstDate = shifts.find((s) => s.date)?.date ?? '';

  const moveWeek = (newFirst: string) => {
    if (!firstDate || !newFirst) return;
    const delta = Math.round(
      (Date.parse(newFirst + 'T00:00:00Z') - Date.parse(firstDate + 'T00:00:00Z')) / 86400000,
    );
    if (!delta) return;
    setShifts((prev) => prev.map((s) => (s.date ? { ...s, date: addDays(s.date, delta) } : s)));
  };

  /** Re-title every shift from the base title and the office-activity list. */
  const retitle = (defaultTitle: string, officeList: string) => {
    const list = splitList(officeList);
    setSettings((s) => ({ ...s, defaultTitle, officeActivities: officeList }));
    setShifts((prev) => prev.map((s) => {
      const officeActivities = officeIn(s.activities, list);
      return { ...s, officeActivities, title: shiftTitle(defaultTitle, officeActivities) };
    }));
  };

  const selected = useMemo(() => shifts.filter((s) => s.include && s.date), [shifts]);

  /* ------------------------------------------------------------------ ui */

  return (
    <div className="app">
      <header className="top">
        <h1>Rooster Import</h1>
        <p>Screenshot of tekst van je weekrooster → Google Agenda of Outlook</p>
      </header>
      <hr className="tear" />

      <UploadPanel
        busy={progress !== null}
        progress={progress}
        error={error}
        imageUrl={imageUrl}
        onImage={(f) => void handleImage(f)}
        onText={handleText}
      />

      {result && (
        <ShiftTable
          result={result}
          shifts={shifts}
          firstDate={firstDate}
          defaultTitle={settings.defaultTitle}
          officeActivities={settings.officeActivities}
          importState={cal.importState}
          onPatch={patchShift}
          onRemove={removeShift}
          onClear={clearAll}
          onMoveWeek={moveWeek}
          onDefaultTitle={(t) => retitle(t, settings.officeActivities)}
          onOfficeActivities={(l) => retitle(settings.defaultTitle, l)}
        />
      )}

      <CalendarPanel
        cal={cal}
        selectedCount={selected.length}
        settings={settings}
        onReminder={(m) => setSettings((s) => ({ ...s, reminderMinutes: m }))}
        onImport={() => void cal.doImport(selected)}
        onIcs={() => downloadIcs(selected, settings)}
      />

      <div className="theme-toggle">
        <button className="secondary" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
      </div>
    </div>
  );
}
