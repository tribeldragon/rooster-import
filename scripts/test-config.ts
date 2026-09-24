/**
 * Regression test for deployment config: GitHub Pages serves the app from a
 * subpath (/rooster-import/) while dev runs at the root, and the Microsoft
 * redirect URI has to match wherever redirect.html actually ends up. Getting
 * this wrong is what broke Microsoft login on the GitHub Pages build (see
 * commit "Fix Microsoft redirect URI for the GitHub Pages subpath").
 *
 *   npm run test:config
 */
import { buildRedirectUri } from '../src/lib/redirectUri.ts';
import { resolveBase } from '../src/lib/base.ts';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : `\n     verwacht: ${JSON.stringify(expected)}\n     gekregen: ${JSON.stringify(actual)}`}`);
}

// --- buildRedirectUri ---

check(
  'redirect URI op localhost (base "/")',
  buildRedirectUri('http://localhost:5173', '/'),
  'http://localhost:5173/redirect.html',
);
check(
  'redirect URI op GitHub Pages subpath',
  buildRedirectUri('https://tribeldragon.github.io', '/rooster-import/'),
  'https://tribeldragon.github.io/rooster-import/redirect.html',
);
check(
  'geen dubbele/missende slash bij lege base',
  buildRedirectUri('http://localhost:5173', ''),
  'http://localhost:5173redirect.html',
);

// --- vite base path: dev vs. build moeten overeenkomen met bovenstaande URIs ---

check('vite base is root tijdens dev (serve)', resolveBase('serve'), '/');
check('vite base is /rooster-import/ bij build', resolveBase('build'), '/rooster-import/');

console.log(`\n${failures ? `${failures} test(s) MISLUKT` : 'Alle tests geslaagd'}`);
process.exit(failures ? 1 : 0);
