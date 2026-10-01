import { useRef, useState } from 'react';
import type { Progress } from '../lib/ocr';

interface Props {
  busy: boolean;
  progress: Progress | null;
  error: string | null;
  imageUrl: string | null;
  onImage: (file: File | Blob) => void;
  onText: (text: string) => void;
}

/** Screenshot drop zone, pasted-text box, OCR progress and errors. */
export function UploadPanel({ busy, progress, error, imageUrl, onImage, onText }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <section className="panel">
      <div
        className={'drop' + (dragOver ? ' over' : '')}
        role="button"
        tabIndex={0}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) onImage(file);
        }}
      >
        <strong>Plak je rooster met Ctrl+V (tekst of screenshot), sleep een screenshot hierheen, of klik om te bladeren</strong>
        Kopieer de hele roostertabel, of maak een PNG/JPG ervan
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onImage(f); e.target.value = ''; }}
      />

      <div style={{ marginTop: 10 }}>
        <h3 style={{ margin: '0 0 4px' }}>Rooster als tekst plakken</h3>
        <textarea
          className="paste-text"
          rows={6}
          value={pasteText}
          placeholder="Selecteer de roostertabel op de roosterpagina, kopieer (Ctrl+C) en plak hier"
          onChange={(e) => setPasteText(e.target.value)}
        />
        <button type="button" disabled={!pasteText.trim() || busy} onClick={() => onText(pasteText)}>Rooster lezen</button>
      </div>

      {progress && (
        <>
          <p className="muted" style={{ marginBottom: 0 }}>{progress.stage}…</p>
          <div className="bar"><div style={{ width: `${Math.round(progress.progress * 100)}%` }} /></div>
          <p className="muted">De eerste keer duurt het wat langer: de taalbestanden worden gedownload en gecachet.</p>
        </>
      )}

      {error && <div className="note err">{error}</div>}

      {imageUrl && !busy && (
        <details style={{ marginTop: 10 }}>
          <summary>Screenshot tonen</summary>
          <img className="preview" src={imageUrl} alt="rooster screenshot" />
        </details>
      )}
    </section>
  );
}
