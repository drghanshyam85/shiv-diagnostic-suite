#!/usr/bin/env node
/*
 * Single-file builds (run `npm run build` first, or `npm run build:all`):
 *   dist/Shiv-Diagnostic-Suite-Standalone.html  the whole suite in ONE html file — double-click to run
 *                                               offline from a desktop or USB stick (file://)
 *   dist/artifact/shiv-clinic-suite.html        the same app as a page fragment for hosted viewers
 *                                               (no <html>/<head>/<body>; adds the online-demo notice)
 * Both run in standalone mode: everything is saved in that browser's IndexedDB.
 *
 * Scripts are embedded base64 (type="text/x-vendor" / "text/x-app") so no library text can break
 * out of its <script> element. The boot loader below and core/vendor.js run them as inline scripts,
 * falling back to blob: URLs where a page policy refuses inline code.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pub = path.join(root, 'public');
const outDir = path.join(root, 'dist');
const read = (p) => fs.readFileSync(path.join(pub, p));

if (!fs.existsSync(path.join(pub, 'assets/app.js'))) {
  console.error('public/assets/app.js not found — run "npm run build" first.');
  process.exit(1);
}

let css = read('assets/app.css').toString('utf8');
css = css.replace(/url\((['"]?)fonts\/([\w.-]+\.woff2)\1\)/g, (m, q, f) => {
  const p = path.join(pub, 'assets/fonts', f);
  return fs.existsSync(p) ? `url(data:font/woff2;base64,${fs.readFileSync(p).toString('base64')})` : m;
});
css = css.replace(/<\/style/gi, '<\\/style');

const vendors = fs.readdirSync(path.join(pub, 'vendor'))
  .filter((f) => f.endsWith('.js'))
  .sort()
  .map((f) => `<script type="text/x-vendor" id="vendor:${f}">${read('vendor/' + f).toString('base64')}</script>`)
  .join('\n');

const app = read('assets/app.js').toString('base64');
const favicon = 'data:image/svg+xml;base64,' + read('assets/favicon.svg').toString('base64');
const pkg = require('../package.json');
const stamp = new Date().toISOString().slice(0, 10);

const boot = (flags) => `<script>
(function () {
  window.__SSDC_STANDALONE = true;${flags}
  var b = atob(document.getElementById('ssdc-app').textContent.trim());
  var u = new Uint8Array(b.length);
  for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  var code = 'window.__SSDC_APP_RAN = 1;\\n' + new TextDecoder().decode(u) + '\\n//# sourceURL=ssdc-app.js';
  var s = document.createElement('script');
  s.textContent = code;
  document.body.appendChild(s);
  if (!window.__SSDC_APP_RAN) {
    var x = document.createElement('script');
    x.src = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    x.onerror = function () { document.getElementById('root').textContent = 'The clinic suite could not start in this browser. Please open it in Google Chrome or Microsoft Edge.'; };
    document.body.appendChild(x);
  }
})();
</script>`;

const body = (flags) => `<div id="root"><p style="padding:24px;font:14px system-ui,sans-serif;color:#475569">Starting the Shiv Sonography clinic suite…</p></div>
<div id="print-root"></div>
<noscript>Please enable JavaScript to use the clinic suite.</noscript>
${vendors}
<script type="text/x-app" id="ssdc-app">${app}</script>
${boot(flags)}`;

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f172a">
<meta name="generator" content="SSDC Suite ${pkg.version} standalone build ${stamp}">
<title>Shiv Sonography &amp; Diagnostic Center – Clinic Suite (Standalone)</title>
<link rel="icon" href="${favicon}" type="image/svg+xml">
<style>${css}</style>
</head>
<body>
${body('')}
</body>
</html>
`;

// hosted page fragment: the host supplies doctype/head/body; the title must sit in the first 8 KB
const artifact = `<title>Shiv Sonography Clinic Suite</title>
<meta name="description" content="Shiv Sonography and Diagnostic Center clinic suite — online demo with sample data.">
<meta name="generator" content="SSDC Suite ${pkg.version} online demo build ${stamp}">
<style>${css}</style>
${body('\n  window.__SSDC_DEMO_LINK = true;')}
`;

fs.mkdirSync(path.join(outDir, 'artifact'), { recursive: true });
const out1 = path.join(outDir, 'Shiv-Diagnostic-Suite-Standalone.html');
const out2 = path.join(outDir, 'artifact', 'shiv-clinic-suite.html');
fs.writeFileSync(out1, standalone);
fs.writeFileSync(out2, artifact);
const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(1) + ' MB';
console.log('Standalone build → ' + path.relative(root, out1) + ' (' + mb(out1) + ')');
console.log('Online demo page → ' + path.relative(root, out2) + ' (' + mb(out2) + ')');
