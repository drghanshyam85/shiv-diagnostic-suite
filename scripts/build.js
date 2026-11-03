#!/usr/bin/env node
/* Build: React app bundle (esbuild) + Tailwind CSS + vendored libraries & fonts → public/ */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const pub = path.join(root, 'public');
const assets = path.join(pub, 'assets');
const fonts = path.join(assets, 'fonts');
const vendor = path.join(pub, 'vendor');
const nm = (p) => path.join(root, 'node_modules', p);

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

async function main() {
  [assets, fonts, vendor].forEach((d) => fs.mkdirSync(d, { recursive: true }));
  const t0 = Date.now();

  await esbuild.build({
    entryPoints: [path.join(root, 'client/src/main.jsx')],
    bundle: true,
    minify: !process.env.DEV,
    sourcemap: !!process.env.DEV,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100', 'edge100', 'firefox102', 'safari15'],
    jsx: 'automatic',
    outfile: path.join(assets, 'app.js'),
    define: { 'process.env.NODE_ENV': process.env.DEV ? '"development"' : '"production"', global: 'globalThis' },
    legalComments: 'none',
    logLevel: 'warning',
    charset: 'utf8'
  });

  execSync(`npx tailwindcss -c tailwind.config.js -i client/src/styles.css -o public/assets/app.css ${process.env.DEV ? '' : '--minify'}`, { cwd: root, stdio: 'pipe' });

  const fontMap = {
    'inter-400.woff2': '@fontsource/inter/files/inter-latin-400-normal.woff2',
    'inter-500.woff2': '@fontsource/inter/files/inter-latin-500-normal.woff2',
    'inter-600.woff2': '@fontsource/inter/files/inter-latin-600-normal.woff2',
    'inter-700.woff2': '@fontsource/inter/files/inter-latin-700-normal.woff2',
    'jakarta-600.woff2': '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-600-normal.woff2',
    'jakarta-700.woff2': '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff2',
    'jakarta-800.woff2': '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-800-normal.woff2',
    'deva-400.woff2': '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff2',
    'deva-600.woff2': '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-600-normal.woff2'
  };
  for (const [to, from] of Object.entries(fontMap)) if (fs.existsSync(nm(from))) copy(nm(from), path.join(fonts, to));

  const vendorMap = {
    'mammoth.browser.min.js': 'mammoth/mammoth.browser.min.js',
    'pdf.min.js': 'pdfjs-dist/build/pdf.min.js',
    'pdf.worker.min.js': 'pdfjs-dist/build/pdf.worker.min.js',
    'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js',
    'html2canvas.min.js': 'html2canvas/dist/html2canvas.min.js'
  };
  for (const [to, from] of Object.entries(vendorMap)) if (fs.existsSync(nm(from))) copy(nm(from), path.join(vendor, to));

  // English word list (SCOWL size 60, US + UK spellings) for the spell checker
  const words = new Set();
  for (const v of ['english', 'american', 'british']) {
    for (const n of [10, 20, 35, 40, 50, 55, 60]) {
      const f = nm(`wordlist-english/${v}-words-${n}.json`);
      if (fs.existsSync(f)) JSON.parse(fs.readFileSync(f, 'utf8')).forEach((w) => words.add(w.toLowerCase()));
    }
  }
  fs.writeFileSync(path.join(vendor, 'wordlist-en.js'), 'window.__SSDC_WORDS=' + JSON.stringify(Array.from(words).sort().join('\n')) + ';');

  fs.writeFileSync(path.join(assets, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0284c7"/><stop offset="1" stop-color="#0d9488"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/><g fill="none" stroke="#fff" stroke-linecap="round" stroke-width="3.6"><path d="M20 16h12v15a6 6 0 0 1-12 0z"/><path d="M15 44a13 13 0 0 0 22 0"/><path d="M39 16c4 2.6 6.5 7 6.5 12"/></g></svg>');
  fs.writeFileSync(path.join(pub, 'manifest.webmanifest'), JSON.stringify({
    name: 'Shiv Sonography & Diagnostic Center', short_name: 'SSDC Suite', start_url: './', display: 'standalone', background_color: '#0f172a', theme_color: '#0f172a',
    icons: [{ src: 'assets/favicon.svg', sizes: 'any', type: 'image/svg+xml' }]
  }, null, 2));

  fs.writeFileSync(path.join(pub, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f172a">
<meta name="description" content="Shiv Sonography and Diagnostic Center – registration, billing, PC-PNDT Form F, USG reporting, pathology, accounts and dispatch.">
<title>Shiv Sonography &amp; Diagnostic Center – Clinic Suite</title>
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="manifest.webmanifest">
<link rel="stylesheet" href="assets/app.css">
</head>
<body>
<div id="root"></div>
<div id="print-root"></div>
<script src="assets/app.js"></script>
</body>
</html>
`);
  const size = (f) => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
  console.log(`Built in ${Date.now() - t0} ms — app.js ${size(path.join(assets, 'app.js'))}, app.css ${size(path.join(assets, 'app.css'))}, words ${words.size}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
