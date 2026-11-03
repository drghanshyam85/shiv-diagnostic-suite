// Theme is applied before first paint; public patient links skip the full boot.
import { boot as fullBoot } from './bootstrap';
import { lsGet } from './utils';

export function applyTheme(theme) {
  const t = theme || lsGet('ssdc-theme', 'light');
  const host = document.documentElement.getAttribute('data-theme');
  const dark = t === 'dark' || (t === 'system' && (host === 'dark' || host === 'light' ? host === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches));
  document.documentElement.classList.toggle('dark', dark);
}

export async function boot() {
  applyTheme();
  const h = location.hash || '';
  if (/^#\/(v|p)\//.test(h)) return { publicView: true };
  return fullBoot();
}
