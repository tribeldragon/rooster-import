/**
 * Pulled out on its own so it's unit-testable without a browser or the rest of the
 * Microsoft-login import chain: on GitHub Pages `baseUrl` is `/rooster-import/`, on
 * localhost it's `/`, and redirect.html always lives at the base.
 */
export function buildRedirectUri(origin: string, baseUrl: string): string {
  return `${origin}${baseUrl}redirect.html`;
}
