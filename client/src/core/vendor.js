// Lazy loader for vendored libraries. Works from the LAN server, static hosting, file:// and the
// standalone single-file build (where scripts are embedded as base64 <script type="text/x-vendor">).

const loaded = {};

function inlineSource(name) {
  const el = document.getElementById('vendor:' + name);
  if (!el) return null;
  const bin = atob(el.textContent.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function vendorUrl(name) {
  const code = inlineSource(name);
  if (code !== null) return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  return 'vendor/' + name;
}

export function loadScript(src, globalName) {
  if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
  if (loaded[src]) return loaded[src];
  const embedded = src.startsWith('vendor/') && globalName ? inlineSource(src.split('/').pop()) : null;
  if (embedded !== null) {
    // single-file builds: run the embedded library inline; a page whose policy refuses inline
    // scripts leaves the global undefined and falls through to the blob: URL below
    const el = document.createElement('script');
    el.textContent = embedded + '\n//# sourceURL=' + src.split('/').pop();
    document.head.appendChild(el);
    if (window[globalName]) return Promise.resolve(window[globalName]);
  }
  loaded[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    const name = src.split('/').pop();
    s.src = src.startsWith('vendor/') ? vendorUrl(name) : src;
    s.async = true;
    s.onload = () => resolve(globalName ? window[globalName] : true);
    s.onerror = () => { delete loaded[src]; reject(new Error('Could not load ' + name)); };
    document.head.appendChild(s);
  });
  return loaded[src];
}

export const getMammoth = () => loadScript('vendor/mammoth.browser.min.js', 'mammoth');
export const getJsPDF = () => loadScript('vendor/jspdf.umd.min.js', 'jspdf').then((m) => m.jsPDF);
export const getHtml2canvas = () => loadScript('vendor/html2canvas.min.js', 'html2canvas');

export async function getPdfjs() {
  const lib = await loadScript('vendor/pdf.min.js', 'pdfjsLib');
  if (!lib.GlobalWorkerOptions.workerSrc) {
    if (/^https?:$/.test(location.protocol) && !document.getElementById('vendor:pdf.worker.min.js')) {
      lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.js', location.href).href;
    } else {
      // file:// or single-file build: run the worker code in-page (pdf.js "fake worker")
      await loadScript('vendor/pdf.worker.min.js', 'pdfjsWorker');
      lib.GlobalWorkerOptions.workerSrc = vendorUrl('pdf.worker.min.js');
    }
  }
  return lib;
}

let wordsPromise = null;
/** English word list (~79k words, SCOWL 60) for the spell checker. */
export function getWordlist() {
  if (!wordsPromise) {
    wordsPromise = loadScript('vendor/wordlist-en.js', '__SSDC_WORDS').then((txt) => new Set(String(txt).split('\n')));
  }
  return wordsPromise;
}
