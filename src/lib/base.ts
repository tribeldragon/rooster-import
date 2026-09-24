/**
 * Pulled out of vite.config.ts so it's unit-testable in plain Node (that config file
 * also touches `__dirname`, which only exists under Vite's own config loader).
 */
export function resolveBase(command: 'build' | 'serve'): string {
  return command === 'build' ? '/rooster-import/' : '/';
}
