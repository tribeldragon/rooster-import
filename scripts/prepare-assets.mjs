/**
 * Copies the Tesseract worker + wasm core out of node_modules into public/, and
 * downloads the language data once. Keeps the app working without a CDN at runtime.
 * Runs automatically after `npm install`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = (p) => path.join(root, 'node_modules', p);

const coreDir = path.join(root, 'public', 'tesseract');
const langDir = path.join(root, 'public', 'tessdata');
fs.mkdirSync(coreDir, { recursive: true });
fs.mkdirSync(langDir, { recursive: true });

// 1. worker + wasm core
const copies = [[req('tesseract.js/dist/worker.min.js'), 'worker.min.js']];
for (const f of fs.readdirSync(req('tesseract.js-core'))) {
  if (/^tesseract-core.*\.(js|wasm)$/.test(f)) copies.push([req(`tesseract.js-core/${f}`), f]);
}
for (const [from, name] of copies) {
  const to = path.join(coreDir, name);
  if (!fs.existsSync(to) || fs.statSync(from).mtimeMs > fs.statSync(to).mtimeMs) {
    fs.copyFileSync(from, to);
    console.log('copied', name);
  }
}

// 2. language data (Dutch + English), ~20 MB, downloaded once
const LANGS = ['nld', 'eng'];
const BASE = 'https://tessdata.projectnaptha.com/4.0.0';
for (const lang of LANGS) {
  const dest = path.join(langDir, `${lang}.traineddata.gz`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) continue;
  try {
    process.stdout.write(`downloading ${lang}.traineddata.gz … `);
    const res = await fetch(`${BASE}/${lang}.traineddata.gz`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log('ok');
  } catch (e) {
    console.warn(`\n  kon ${lang}.traineddata.gz niet downloaden (${e.message}).`);
    console.warn('  De app valt terug op de CDN van tesseract.js; draai `npm run prepare-assets` opnieuw voor offline gebruik.');
  }
}
