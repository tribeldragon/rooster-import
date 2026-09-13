/**
 * Browser-side OCR: preprocess the screenshot, then run Tesseract twice —
 * once over the whole table (activities) and once over the narrow left
 * column (dates), which OCRs much better when it is isolated.
 */
import { createWorker } from 'tesseract.js';
import { fuzzyIndex, type OcrWord } from './parse';

export interface Progress { stage: string; progress: number }

/** Upscaling is what makes small UI screenshots readable for Tesseract. */
const TARGET_WIDTH = 2600;
const MAX_SCALE = 4;

export function scaleFor(width: number): number {
  return Math.max(1, Math.min(MAX_SCALE, Math.round((TARGET_WIDTH / width) * 2) / 2));
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Afbeelding kon niet worden geladen.'));
    img.src = src;
  });
}

export function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Bestand kon niet worden gelezen.'));
    fr.readAsDataURL(file);
  });
}

interface Crop { left: number; top: number; width: number; height: number }

/** Greyscale + contrast stretch + clean upscale; returns a canvas for Tesseract. */
export function preprocess(img: HTMLImageElement, scale: number, crop?: Crop): HTMLCanvasElement {
  const c: Crop = crop ?? { left: 0, top: 0, width: img.naturalWidth, height: img.naturalHeight };
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(c.width * scale);
  canvas.height = Math.round(c.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, c.left, c.top, c.width, c.height, 0, 0, canvas.width, canvas.height);

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const v = Math.max(0, Math.min(255, g * 1.4 - 40)); // contrast stretch
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

type AnyWorker = Awaited<ReturnType<typeof createWorker>>;

/** Recognize a canvas and return word boxes mapped back to original image pixels. */
async function words(worker: AnyWorker, canvas: HTMLCanvasElement, scale: number, offsetX = 0, offsetY = 0): Promise<OcrWord[]> {
  const { data } = await worker.recognize(canvas, {}, { blocks: true } as never);
  const out: OcrWord[] = [];
  const blocks = (data as unknown as { blocks?: any[] }).blocks ?? [];
  for (const b of blocks)
    for (const p of b.paragraphs ?? [])
      for (const l of p.lines ?? [])
        for (const w of l.words ?? [])
          out.push({
            text: w.text,
            conf: Math.round(w.confidence),
            x0: Math.round(w.bbox.x0 / scale) + offsetX,
            y0: Math.round(w.bbox.y0 / scale) + offsetY,
            x1: Math.round(w.bbox.x1 / scale) + offsetX,
            y1: Math.round(w.bbox.y1 / scale) + offsetY,
          });
  return out;
}

export interface OcrResult {
  fullWords: OcrWord[];
  leftWords: OcrWord[];
  width: number;
  height: number;
}

/** Local assets (see scripts/prepare-assets.mjs); falls back to the tesseract.js CDN. */
async function assetPaths(): Promise<{ workerPath?: string; corePath?: string; langPath?: string }> {
  // A ranged GET works on every static server; HEAD is not always answered.
  const has = async (url: string) => {
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
      return res.ok || res.status === 206;
    } catch { return false; }
  };
  const [worker, lang] = await Promise.all([
    has('/tesseract/worker.min.js'),
    has('/tessdata/nld.traineddata.gz'),
  ]);
  return {
    ...(worker ? { workerPath: '/tesseract/worker.min.js', corePath: '/tesseract/' } : {}),
    ...(lang ? { langPath: '/tessdata' } : {}),
  };
}

/** Nothing in tesseract.js rejects when a CDN asset fails to load, so guard it. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function runOcr(dataUrl: string, onProgress: (p: Progress) => void): Promise<OcrResult> {
  const img = await loadImage(dataUrl);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const scale = scaleFor(width);

  onProgress({ stage: 'Taalbestanden laden', progress: 0.02 });
  const paths = await assetPaths();
  const worker = await withTimeout(
    createWorker(['nld', 'eng'], 1, {
      ...paths,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') onProgress({ stage: 'Tekst herkennen', progress: 0.1 + m.progress * 0.55 });
        else if (m.status.includes('loading') || m.status.includes('initializ')) onProgress({ stage: 'Taalbestanden laden', progress: 0.02 });
      },
    }),
    180_000,
    'De OCR-motor kon niet worden geladen. Draai `npm run prepare-assets` voor lokale bestanden, of controleer je internetverbinding.',
  );

  try {
    onProgress({ stage: 'Afbeelding voorbereiden', progress: 0.06 });
    const fullCanvas = preprocess(img, scale);
    const fullWords = await withTimeout(words(worker, fullCanvas, scale), 300_000, 'OCR duurde te lang.');

    // Column 2 starts at the "Activiteiten" header; fall back to a fixed ratio.
    const header = fullWords.find((w) => fuzzyIndex(w.text, ['activiteiten'], 3) === 0);
    const splitX = header ? header.x0 - 8 : Math.round(width * 0.594);

    onProgress({ stage: 'Datums herkennen', progress: 0.7 });
    const leftCanvas = preprocess(img, scale, { left: 0, top: 0, width: Math.max(40, splitX), height });
    const leftWords = await withTimeout(words(worker, leftCanvas, scale), 300_000, 'OCR duurde te lang.');

    onProgress({ stage: 'Klaar', progress: 1 });
    return { fullWords, leftWords, width, height };
  } finally {
    await worker.terminate();
  }
}
