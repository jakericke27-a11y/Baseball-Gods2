/** Boot: one App on the page; if the page is updated while open, the year picks up where it was. */
import { App, type Screen } from './app';
import { streakCss } from './sprites';
import type { SaveData } from './state';

interface Hot {
  snapshot?: (fn: () => unknown) => void;
  ready?: (fn: (data: unknown) => void) => void;
  data?: unknown;
}

function boot() {
  const style = document.createElement('style');
  style.textContent = streakCss();
  document.head.appendChild(style);
  const app = new App(document.getElementById('app')!, document.getElementById('park') as HTMLCanvasElement);
  const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;
  hot?.snapshot?.(() => app.snapshot());
  const start = (data: unknown) => {
    const d = (data && typeof data === 'object' ? data : {}) as { save?: SaveData; screen?: Screen };
    void app.start(d.save ? d : undefined);
  };
  if (hot?.ready) hot.ready(start);
  else start(hot?.data ?? {});
  (window as unknown as { __bg?: App }).__bg = app; // for the smoke test
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
