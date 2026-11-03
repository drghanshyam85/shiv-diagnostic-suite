# Shiv Sonography and Diagnostic Center — Clinic Suite

Clinic software for **Shiv Sonography and Diagnostic Center**, Opp. SDH Hospital Gate No. 2, Jobner Road, Phulera, Jaipur 303338.
It covers the front desk, PC-PNDT compliance, ultrasound reporting, the pathology lab, accounts and patient communication, and it runs:

* **on the clinic network (recommended):** one PC runs the server and every other PC, tablet and phone on the clinic Wi-Fi opens it in a browser, with live sync between them;
* **as a single HTML file:** `dist/Shiv-Diagnostic-Suite-Standalone.html` runs offline on one computer (double-click it);
* **on a cloud host:** Render, Railway, Docker or any Node.js host, with a persistent disk or PostgreSQL.

---

## 1. Modules

| Area | What it does |
|---|---|
| **Dashboard** | Today's patients, collections split into **cash, UPI and card**, bills, report progress and pending Form F. Shows the live queue (token and patient name per department), a 14-day trend, a **"needs attention"** list (reports to sign, results to verify, samples, Form F, unbilled visits, unsent reports, failed or undelivered messages, cash/UPI not reconciled, doctor statements awaiting approval, dues), **recent & returning patients** with one-click access to every past bill, report, lab result and Form F, and system health. |
| **Patient Registration** | A **find-or-scan** bar at the top: type a mobile / name / Reg ID, or scan a patient card / token slip QR or an **Aadhaar QR** (old XML and Secure QR) with a USB / Bluetooth scanner or the camera — a returning patient's details **fill in automatically**, an Aadhaar QR fills name, gender, age, guardian and address. The form is grouped (Identity · Contact & family · Address · Referral) in keyboard order with required fields marked. The **referring doctor** is suggested from past visits (this patient's doctor, then the most common doctor for the village). Gender shows as **Male / Female / Other**. **Quick-select** buttons for frequent tests and packages; the **pregnancy panel** does the LMP ⇄ GA ⇄ EDD calculations. Saving gives modality tokens (USG-01, LAB-01, T-01) and a token slip with a QR for the next visit. |
| **Live Queue & Tokens** | Waiting → In scan/sample → Completed for each modality on every workstation and "Call the next patient". Staff screens (Dashboard and Live Queue) show each patient's **token and name only**; waiting times can be switched back on in Settings → LAN & workstation → Waiting hall display. The waiting-hall **TV display** shows the called token with the **patient's full name** in large type, and for **each test room** every waiting patient's name, token, **how many are ahead** and an **estimated wait** worked out from the average procedure time (measured from the last 14 days, or set per room in Settings). Voice announcements in English and Hindi; names can be hidden for privacy (Esc exits). The TV shows **only Ultrasound / Sonography** by default — other departments' queues, calls and announcements stay off it (tick more departments in Settings → LAN & workstation → Waiting hall display); the staff Live Queue page always shows every department. |
| **Billing Desk** | Cash / UPI / card / split / due bills. Quick-add packages and frequent tests, **price tiers** (standard, emergency/STAT, B2B — chosen automatically for partner doctors or at night when enabled), a clear split-payment panel with "rest" buttons, summary cards for today, automatic tax and net totals (GST nil by default — diagnostic services are exempt), and print / send-receipt toggles at checkout. Discounts and refunds are permission-gated. Prints on A4, A4 dual copy, A5, 1/3 A4 slip or 80 mm thermal, optionally on your own **letterhead image**. Bills carry a UPI QR, preparation guidelines, a Google review QR and a **patient web receipt** link. Also includes the dues ledger. |
| **PC-PNDT Form F** | Auto-filled from registration and from the patient's **previous Form F**, with **live statutory completeness** (missing mandatory items highlighted, "go to next missing field"), an annual S.No. register, Hindi labels, a customisable layout and a print/PDF register. The printed **Registration No.** is the clinic's sequential serial number (never the patient ID), indication **17** is ticked on every new form, and printing gives exactly two clean A4 pages (text fitted per page, no split items). **Strict Form F lock**: an obstetric report can't be signed until its Form F is final. |
| **USG Reporting (SonoReport Ultra Pro)** | Word-style ribbon editor with templates for each test, a macro palette, **inline search**: type `//` (or press Ctrl+Space) where you are writing to find and insert a macro or template without leaving the text. The worklist (left) and tools panel (right) are **resizable and collapsible** — drag the dividers, double-click to fold them into slim rails, and "Page width" zoom follows. **Voice dictation** fills biometry by voice ("BPD 50 mm", "AFI 12 cm") and calculates GA, EDD and Hadlock EFW; an **automatic impression** draft, medical spell-check, reference tables and Gemini Copilot (Gemini 3.8 Flash, 3.1 Pro, 4 Argon). The **Images** tab reads **DICOM natively** (single images and cine loops; uncompressed, RLE, JPEG baseline, deflated; checks the patient name / ID), **sorts images automatically** by organ in report order (or by capture time), copies them to the patient's **cloud folder**, and shows new scans from the server's **cloud inbox folder**. Also has an antenatal checklist, versions, Sign & Lock, and PDF / Word / Google Docs export. |
| **Templates & Macros** | Full-width editors (Template Studio fills the screen; an "A4 page" view is one click away; the macro editor can hide its preview). Macro engine with trigger words and CSV/Excel/Word import (Data Hub) that scales past 1,00,000 entries. Templates take **patient placeholders** (`{{Patient_Name}}`, `{{Age_Sex}}`, `{{Ref_Doctor}}`, `{{LMP}}` …), **nested macros** (`{{>trigger}}`) and **calculated fields** (`{{GA_USG}}`, `{{EDD_USG}}`, `{{EFW}}` …) that update from the biometry. |
| **Medical Dictionary** | Terms, **normal reference ranges** (low / high / unit / population) and **auto-text** that expands from a trigger. Fuzzy search with category filters, and **batch import** from Excel, CSV, JSON or pasted cells; export uses the same columns. |
| **Pathology Lab** | Worklist with **barcode scanning** (USB/Bluetooth scanner or the camera) that finds and collects the sample, an automatic "sample collected" message to the patient, templated panels with "fill normals", result entry with H/L flags and critical values, and technician → pathologist verification, including **batch signing**. Lab reports carry **two signatures** (Yogesh, RPMC 7596, and Dr. Rishabh Kumar, RMC 37949/26174). |
| **Dispatch Center** | Sends USG, pathology and biochemistry reports and invoices by WhatsApp, SMS or e-mail as PDF, Word or Google Docs, either combined or as separate files. Other parts: upload, convert and download centre with bulk ZIP; e-mail inbox importer with a smart parser and 1-click forward; message templates with placeholders (Hindi included); auto-send rules (on signing, on upload, on e-mail import, on sample collection, 6 PM batch); a live log with **delivery status** (sent → delivered → read, or failed) from provider receipts, **failure alerts** on every workstation, template filter, CSV export and 1-click resend. |
| **Tariff Directory** | Rate list with standard, emergency, B2B and CGHS rates, TAT and preparation notes; ★ **pin** frequent tests. Prints an A4 rate card for any tier and gives patient estimates that can go straight to billing. |
| **Daily Cash Book** | Per-staff or consolidated day book covering opening float, cash/UPI by department, dues collected and expenses, with a **denomination counter**, **cash vs digital reconciliation** (physical count, UPI / card statement totals), automatic **exception detection** (mode mismatches, over-collection, refunds, receipts without UTR, stale counts, high discounts) with highlighted rows and alerts, and a one-click **daily audit pack** (ZIP: A4 day book PDF, registers, payments, reconciliation, money audit trail and a SHA-256 manifest). Printable A4, CSV, and a WhatsApp summary. |
| **Accounts & Doctor Sharing** | Revenue analytics, per-doctor sharing at **modality-specific percentages** (USG, Lab, X-Ray, ECG/Other) under a configurable discount rule, payout breakdown by modality, a **6-month centre retention vs payouts** chart, monthly statements with audit/owner approval, PDFs, WhatsApp, and bulk export. |
| **Cloud Sync & Backup** | Google Drive and OneDrive folder mirror (`/Shiv_Ultrasonography_Diagnostic_Center/YYYY-MM-DD/<PatientID>_<Name>/` with report PDF + Word + scan images and the original DICOM files), Google Cloud (Firestore + Storage), and JSON backup and restore. An **image inbox folder** on the server PC (a Google Drive / OneDrive / Dropbox sync folder or the console's network share) is watched: new JPEG / PNG / DICOM files are matched to the patient (DICOM patient ID or name, Reg ID or token in the file name) and appear in the report's Images tab on every workstation. Every upload is **checksum-verified** against what the cloud reports (MD5 / QuickXorHash), a daily **integrity audit** re-checks the copies in every connected cloud and re-uploads damaged or missing ones, and the page shows how many clouds hold each file. |
| **Admin Console** | Permission matrix for 5 roles (Full / Draft / Read / Blocked), staff and registration numbers, PNG signatures, password resets, compliance locks, **session timeouts**, live audit trail with CSV export, and **Go live: remove demo data**. |
| **Voice dictation (everywhere)** | One dictation session for the whole app: press **F8** (or the top-bar mic) and keep talking while you move between Dashboard, Registration, Billing, Pathology and Reporting. Words go to the box with the cursor; spoken commands switch modules ("go to billing"), move between boxes ("next field"), fill a box by its label ("set mobile to 98290 12345", "age 45", "gender female", "haemoglobin 12.5"), save, print and search patients. It stays on after a reload (if the microphone is allowed) and stops when the workstation locks. |
| **Automation & webhooks** | The clinic server turns every saved change into events (`visit.created`, `invoice.paid`, `report.signed`, `lab.verified`, `dispatch.failed` …). Built-in **automations** keep the modules in step without anyone clicking: a bill links itself to the visit, a started report moves the patient to In Scan, a signed report or verified lab report marks the test Completed, and a visit closes itself when every test is done and the bill is paid. **Outgoing webhooks** send events (HMAC-signed, retried for 21 hours) to other systems; the **incoming webhook** accepts signed payments (UPI / card gateways), queue updates and analyzer results. Settings → Automation shows it all live. See [docs/AUTOMATION.md](docs/AUTOMATION.md). |
| **Settings** | Clinic profile and logo, billing / UPI / patient links, tax and receipt preferences, automatic price tiers, print and letterhead defaults with **letterhead templates** (your own letterhead image or HTML, separately for USG reports, lab reports and invoices), AI & Gemini, server integrations and delivery receipts, LAN & workstation with a **stable server address**, backup and storage, and light / dark / system theme. |

---

## 2. Install on the clinic PC (Windows)

1. Install **Node.js 22 LTS (22.13 or newer) or 24 LTS** from <https://nodejs.org> (the "LTS" button, default options).
2. Unzip this folder somewhere permanent, for example `C:\SSDC\shiv-diagnostic-suite`.
3. Double-click **`start-windows.bat`**. The first run installs the server components (internet needed once). The window then shows:
   ```
   Local       : http://localhost:3000
   LAN (Wi-Fi) : http://192.168.1.20:3000
   ```
4. On this PC open <http://localhost:3000> in **Chrome or Edge**. On other devices, open the LAN address, or scan the QR code in the server window or under **LAN Connect** in the app.
5. If other devices can't connect, right-click **`allow-lan-firewall-windows.bat`** and choose **Run as administrator**. This opens port 3000 on *private* networks; make sure Windows marks the clinic Wi-Fi as a **Private** network.

Linux / macOS: run `./start.sh`.

**Keep the server easy to find.** The server announces a stable name, **<http://shiv-clinic.local:3000>**, that keeps working when the router gives the PC a new IP (Windows 10/11, Mac, iPhone/iPad and most Android phones open `.local` names). Change the name, pick the preferred address or bind to it under **Settings → LAN & workstation → Stable server address**. That card also shows the PC's MAC address so you can **reserve its IP** in the Wi-Fi router (DHCP reservation). If the IP changes anyway, every workstation is told.

**Start automatically with Windows.** Press `Win + R`, type `shell:startup`, and put a shortcut to `start-windows.bat` in that folder. Alternatively, use Task Scheduler with "At log on" and "Run whether user is logged on or not".

### Default sign-in

All seeded staff use the password **`1234`**. The app asks each person to change it. Change them before going live (Admin Console → Staff & credentials).

| Staff | Role |
|---|---|
| Dr. Ghanshyam Kumawat (MBBS, DMRD · RMC 34378/15533) | Radiologist — Super Admin |
| Dr. Rishabh Kumar (MBBS, MD · RMC 37949/26174) | Consultant Pathologist |
| Yogesh (RPMC 7596) | Lab Technician |
| Staff 1 - Morning Desk, Staff 2 - Evening Desk | Front desk & billing |
| NWR Empanelment Auditor | View-only auditor |

### Go-live checklist

1. **Settings → Clinic profile**: check the name, address, phones, the PC-PNDT registration line and the doctors' details. Upload the logo.
2. **Settings → Billing & payments**: enter the **UPI ID**. The UPI QR on bills stays hidden until you do.
3. **Tariff Directory**: replace the sample rates with your rate list. Verify the CGHS column against the current CGHS (Jaipur, non-NABL) rates.
4. **Admin Console → Staff**: set your own passwords, upload signature PNGs and add staff.
5. **Admin Console → Compliance**: keep the Form F lock and dual-signatory mode on. Turn **off the Dev role switcher**.
6. **Admin Console → Compliance → Go live: remove demo data**: removes the sample patients, bills and reports from every workstation. Bill numbers restart at `SSDC-<year>-0001`, patient IDs at `SSDC-P-000001`, and tokens at 01. Clinic settings, rates, doctors, staff, templates and macros are kept. For a brand-new install with no samples at all, start the server once with `DEMO_DATA=false` (see `.env.example`).
7. **Cloud Sync & Backup**: connect Google Drive / OneDrive, or at least download a JSON backup every day.

---

## 3. Standalone single-file version

`dist/Shiv-Diagnostic-Suite-Standalone.html` (about 7 MB) contains the whole app: fonts, the PDF and Word libraries and the spell-check list. Copy it to any computer and double-click it (Chrome or Edge).

Limits of the standalone file:

* Data lives in that browser's storage on that computer only. There's no multi-device sync, so use **Cloud Sync & Backup → Download full backup** regularly.
* Messages go through WhatsApp / SMS / e-mail **deep links** (wa.me, sms:, mailto: or Gmail compose). The WhatsApp/SMS APIs, SMTP, IMAP and cloud mirroring need the server.
* Patient web links can't be opened by patients, because the file isn't on a web server.

Rebuild it with `npm run build:all`.

---

## 4. Integrations (Settings → Integrations, administrator only)

Secrets are stored only on the clinic server and are shown masked. Use **Dispatch Center → Integrations** to send test messages.

| Channel | Setup |
|---|---|
| **E-mail (SMTP)** | Gmail: turn on 2-Step Verification, create an **App password**, then use host `smtp.gmail.com`, port `465`, SSL on. |
| **E-mail inbox (IMAP)** | Gmail: enable IMAP and use an app password, host `imap.gmail.com`, port `993`. In Dispatch Center → E-mail importer, **Sync inbox** imports PDF/Word/image attachments, matches them to patients and forwards with 1 click. |
| **WhatsApp — deep links** (default) | No setup. Opens WhatsApp / WhatsApp Web with the message and a secure download link; staff press Send. |
| **WhatsApp — Meta Cloud API** | Meta Business account with a WhatsApp number, *Phone number ID* and a **permanent System-User token**. Free-form messages and documents only reach patients who messaged the clinic in the last 24 h. For everyone else, create and get approval for a **Utility template** (document header + body placeholders, for example `{{1}}` patient, `{{2}}` test, `{{3}}` link). Then enter its name, language and placeholder order (`Patient_Name,Test_Name,Secure_Download_Link`). |
| **WhatsApp — UltraMsg / Wati / webhook** | Instance ID + token, or endpoint + token, or your own HTTPS webhook (HMAC-SHA256 signed). |
| **SMS** | **Fast2SMS** (Quick route, or the **DLT** route with your DLT-registered sender ID, template ID and the variable order for the `{#var#}` slots, as TRAI requires), **Twilio** or **TextLocal**. |
| **Gemini** | Server key here, or a personal key in Settings → AI & Gemini (Google AI Studio → *Get API key*). Model names are editable because Google renames them. AI text is always a draft for the doctor and is never signed automatically. |
| **Google Drive / Google login** | Google Cloud Console → OAuth client (Web). Redirect URI `http://localhost:3000/api/cloud/google/callback`. Google accepts only `https://` or `localhost` redirects, so **connect from the server PC** at <http://localhost:3000>. |
| **OneDrive** | Azure portal → App registration → Web redirect `http://localhost:3000/api/cloud/microsoft/callback`, plus a client secret. |
| **Google Cloud (Firestore + Storage)** | Service-account JSON key with Datastore User and Storage Object Admin roles, plus a bucket name (Cloud Sync → Connect service account). |
| **Delivery receipts** (sent → delivered → read) | **WhatsApp Cloud API**: Meta app → WhatsApp → Configuration → Webhook. Callback URL `https://<public address>/api/webhooks/whatsapp`, the *Verify token* from Settings → Integrations → Delivery receipts, subscribe to **messages**, and enter the app secret so every receipt's signature is checked. **Other gateways** (SMS delivery reports, BSPs): POST `{channel, id, status, error}` to `/api/webhooks/dispatch-status?token=<status token>`. The server must be reachable from the internet (public base URL). Failed deliveries alert every workstation and appear on the dashboard. |

The default "deep link" modes need no accounts at all. Everything except the APIs works without internet.

### Patient links

Bills and reports include a secure, expiring download link (default 7 days, configurable in Dispatch Center → Auto-send rules). Patients can only open these links if the server is reachable from the internet. Put a public HTTPS address in **Settings → Billing & payments → Public base URL**, for example a cloud deployment, a Cloudflare Tunnel or a router port-forward with HTTPS. Without one, links work on the clinic Wi-Fi only, and the PDF attachment remains the main delivery.

---

## 5. Cloud / server deployment

* **Render**: `render.yaml` is included (web service plus a 5 GB persistent disk at `/var/data`, `DEMO_DATA=false`).
* **Railway / Heroku-style**: `Procfile` (`web: node --no-warnings server.js`). Set `DATA_DIR` to a mounted volume.
* **Docker**:
  ```bash
  docker build -t ssdc-suite .
  ```
  ```bash
  docker run -d -p 3000:3000 -v ssdc-data:/data --name ssdc ssdc-suite
  ```
* **PostgreSQL** (optional, instead of the built-in SQLite):
  ```bash
  npm install pg
  ```
  Then set `DATABASE_URL=postgres://…`.

Always serve over **HTTPS** when the app is reachable from the internet. Login cookies are HTTP-only and marked `Secure` behind HTTPS proxies.

### Environment variables

See `.env.example`. You can copy it to `.env` next to `server.js`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listening address (0.0.0.0 makes it reachable on the LAN). Without `HOST`, Settings → LAN & workstation can bind to the preferred address (falls back to all interfaces if that address is missing at start-up) |
| `DATA_DIR` | `./data` | Database (`ssdc.sqlite`), uploaded files and the session secret. **Back this folder up.** |
| `JWT_SECRET` | auto-generated in `DATA_DIR/.jwt-secret` | Session signing key |
| `DEMO_DATA` | `true` | `false` = first run without sample patients and bills |
| `DATABASE_URL` | — | PostgreSQL instead of SQLite |
| `GEMINI_API_KEY`, `SMTP_USER`, `SMTP_PASS` | — | Optional fallbacks (Settings → Integrations takes precedence) |
| `SOFFICE_PATH` | auto-detected | LibreOffice, for server-side Word → PDF conversion (otherwise the browser converts) |

---

## 6. Data, backup and security

* Work is saved automatically in the browser (IndexedDB) within seconds and synced to the server. If the network drops, workstations keep working and sync when it returns.
* **Back up** the `data` folder, or use Cloud Sync & Backup → *Download full backup (JSON)*. Restore is in the same place. Staff passwords are never exported.
* Permissions are enforced **on the server** for every change, not only hidden in the screen. Signed reports are locked, and only the Super Admin can unlock one, with a written reason.
* **Session timeouts** (Admin Console → Compliance → Session timeouts): a workstation locks after 15 minutes without activity (5 on the Admin Console and Settings), hiding patient data until the same password is entered; open work is kept. It signs out after 60 minutes locked, and a session lasts at most one working day (14 h). Changes to staff, roles, credentials, integrations, report unlocks and audit exports ask for the password again after 15 minutes. The waiting-hall TV never locks; dictation counts as activity.
* The audit trail records sign-ins, locks and unlocks, failed passwords, edits, signs, prints, exports, dispatches, delivery failures, patient identity edits and deletions, cash counts, reconciliation and admin changes (Admin Console → Live audit trail, CSV export).
* Aadhaar numbers are masked on printed copies. The PC-PNDT foetal-sex wording check blocks signing.

---

## 7. Development

```bash
npm install
```
```bash
npm run build
```
```bash
npm run dev
```

`npm run build` bundles React and Tailwind into `public/`. `npm run dev` runs the server with auto-restart. `npm run build:all` also writes the standalone HTML and the online-demo page (`dist/artifact/`, the same app as a page fragment for hosted viewers, with an online-demo notice).

```
server.js                 Express + Socket.io entry (LAN discovery, API, static files)
server/                   db (SQLite / JSON / PostgreSQL), RBAC, routes, messaging, IMAP, cloud engines
shared/                   permissions matrix, seed data (tests, doctors, staff, settings), demo cleanup
client/src/core/          local-first store, sync, auth, print/PDF/Word engines, AI, speech, spell-check
client/src/modules/       one folder per screen (billing, formf, reporting, lab, dispatch, accounts …)
scripts/                  build.js (bundle) · build-standalone.js (single HTML file)
public/                   built app served by the server
```

---

## 8. Notes and limitations

* The brief mentioned "Sea Sonography" once; it's treated as a typo for **Shiv** Sonography everywhere.
* The seeded rates, referring doctors, expenses and patients are **samples** for exploring the app. Replace the rates, verify CGHS rates against the official current list, and remove the demo data before going live.
* WhatsApp Cloud API, SMS gateways, SMTP/IMAP, Google/Microsoft OAuth and Gemini each need your own accounts and credentials. They were built to the providers' documented APIs but can only be fully checked once those credentials are entered (use the test buttons).
* **NotebookLM, the Gemini app, Gems / Spark and Microsoft 365 Copilot have no public API for this.** The Copilot panel opens the Google tools in a new tab with the report on the clipboard. The ribbon's *Copilot* tab is powered by Gemini, with an offline expander when there's no key. To use Microsoft 365 Copilot, export the report to Word.
* The Copilot offers **Gemini 3.8 Flash** (`gemini-3.8-flash`, default), **Gemini 3.1 Pro** (`gemini-3.1-pro-preview`) and **Gemini 4 Argon** (`gemini-4-argon`). Gemini 2.5 Flash / Flash-Lite are no longer offered; a saved choice moves to 3.8 Flash. Google renames preview models from time to time — Settings → AI & Gemini also lists, live, every model your key can use.
* Voice dictation and the USG export-folder watch need **Chrome or Edge** (cameras and microphones also need `http://localhost` or HTTPS; other workstations can use the Gemini transcription engine). DICOM: uncompressed, RLE, JPEG baseline and deflated files open in the browser; JPEG-LS, JPEG lossless, JPEG 2000 and video DICOM can't be decoded by browsers — choose "DICOM uncompressed / RLE / JPEG" export on the console.
* The image inbox watches a folder **on the server PC**. For Google Drive / OneDrive / Dropbox, install the provider's desktop sync app on that PC and point the inbox at the synced folder (the app's own Drive connection can only see files it created).
* Printing: in the browser print dialog choose the matching paper, with margins "None" or "Default". The app suppresses browser headers and footers.
* **GST**: diagnostic services by a clinical establishment are exempt, so bills show "GST: nil" by default. Set a rate in Settings → Billing only on your tax adviser's advice.
* The stable `.local` name uses mDNS (UDP port 5353). `allow-lan-firewall-windows.bat` opens it on private networks; some older Android phones can't resolve `.local` names — use the IP address or the QR code there.
* Delivery receipts and the cloud integrity checks depend on what each provider reports. Google Docs conversions carry no checksum, so they are checked by presence only.
