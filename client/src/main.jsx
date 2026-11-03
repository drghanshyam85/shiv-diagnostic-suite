import { createRoot } from 'react-dom/client';
import { App } from './App';
import { boot } from './core/boot-wrapper';

const root = createRoot(document.getElementById('root'));
root.render(<div className="flex h-full items-center justify-center text-sm text-slate-500">Starting Shiv Sonography Clinic Suite…</div>);

boot()
  .then((info) => root.render(<App info={info} />))
  .catch((e) => {
    console.error(e);
    root.render(<div style={{ padding: 24, fontFamily: 'system-ui' }}><h2>Could not start the application</h2><pre style={{ whiteSpace: 'pre-wrap' }}>{String(e && e.stack || e)}</pre></div>);
  });
