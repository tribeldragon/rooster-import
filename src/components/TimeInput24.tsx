import { useEffect, useState } from 'react';

/** Accepts "9:30", "0930", "09.30", "09:30"; returns "HH:MM" or null. */
export function normalizeTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\s*[:.]?\s*(\d{2})$/);
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * A 24-hour time field. <input type="time"> follows the OS/browser locale and
 * can't be forced to 24h, so this is a plain text field that only ever commits a
 * valid "HH:MM".
 */
export function TimeInput24({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const valid = normalizeTime(draft) !== null;

  const commit = () => {
    const n = normalizeTime(draft);
    if (n) { setDraft(n); if (n !== value) onChange(n); }
    else setDraft(value); // invalid: revert
  };

  return (
    <input
      type="text"
      className="time-input"
      inputMode="numeric"
      placeholder="UU:MM"
      maxLength={5}
      size={5}
      aria-label={label}
      aria-invalid={!valid}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = normalizeTime(e.target.value);
        if (n && /^\d{2}:\d{2}$/.test(e.target.value)) onChange(n);
      }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
    />
  );
}
