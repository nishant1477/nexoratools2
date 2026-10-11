// Real-browser tests: headless Chromium drives the production Next.js build against the live API + worker.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';

const WEB = process.env.WEB ?? 'http://localhost:3000';
const DIR = '/tmp/nx-ui', SHOTS = '/tmp/shots';
mkdirSync(DIR, { recursive: true }); mkdirSync(SHOTS, { recursive: true });
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '   <- ' + x}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function step(name, fn) { try { await fn(); } catch (e) { fail++; console.log(`FAIL  ${name}   <- threw: ${String(e.message).split('\n')[0]}`); } }

// ---------- fixtures ----------
async function pdf(label, pages) { const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); for (let i = 1; i <= pages; i++) d.addPage([300, 300]).drawText(`${label}-p${i}`, { x: 20, y: 150, size: 30, font: f }); return Buffer.from(await d.save()); }
writeFileSync(`${DIR}/a.pdf`, await pdf('A', 3));
writeFileSync(`${DIR}/b.pdf`, await pdf('B', 2));
writeFileSync(`${DIR}/corrupt.pdf`, '%PDF-1.4\n1 0 obj<<garbage garbage garbage not a real pdf\n');
writeFileSync(`${DIR}/notes.txt`, 'just text');
writeFileSync(`${DIR}/photo.jpg`, await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3366cc' } }).jpeg().toBuffer());
// ~10 MB valid PDF: one page holding an incompressible noise image
{ const raw = (await import('node:crypto')).randomBytes(1800 * 1800 * 3); const png = await sharp(raw, { raw: { width: 1800, height: 1800, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  const d = await PDFDocument.create(); const img = await d.embedPng(png); d.addPage([612, 792]).drawImage(img, { x: 0, y: 0, width: 612, height: 612 }); writeFileSync(`${DIR}/big.pdf`, Buffer.from(await d.save({ useObjectStreams: false }))); }
const text = (file, n) => execFileSync('pdftotext', ['-f', String(n), '-l', String(n), file, '-']).toString().trim();
const pages = (file) => Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [file]).toString())[1]);

// ---------- browser ----------
const browser = await puppeteer.launch({ args: [...chromium.args.filter((a) => a !== '--single-process' && a !== '--no-zygote'), '--lang=en-US'], executablePath: await chromium.executablePath(), headless: 'shell' });
const consoleErrors = [];
async function newPage(ctx, { w = 1280, h = 900, mobile = false } = {}) {
  const p = await ctx.newPage();
  await p.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/status of (401|403|409)/.test(m.text())) consoleErrors.push(`${p.url()} :: ${m.text()}`); });
  return p;
}
const go = async (p, path) => { await p.goto(WEB + path, { waitUntil: 'networkidle0' }); };
const clickText = async (p, sel, re) => { const hs = await p.$$(sel); for (const h of hs) { const t = await h.evaluate((e) => e.textContent ?? ''); if (new RegExp(re, 'i').test(t)) { await h.click(); return true; } } throw new Error(`no ${sel} matching ${re}`); };
const clear = async (p, sel) => { await p.$eval(sel, (e) => { e.focus(); e.select(); }); await p.keyboard.press('Backspace'); };
const bodyText = (p) => p.evaluate(() => document.body.innerText);
const waitText = (p, re, timeout = 60000) => p.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), { timeout }, re.source ?? re).catch(async (e) => { throw new Error(`${e.message} waiting for ${re} at ${p.url()}; page says: ${(await p.evaluate(() => document.body.innerText)).slice(0, 220).replace(/\n+/g, ' | ')}`); });
const shot = (p, name) => p.screenshot({ path: `${SHOTS}/${name}.png` });
const fetchB64 = (p, url) => p.evaluate(async (u) => { const r = await fetch(u, { credentials: 'same-origin' }); const buf = new Uint8Array(await r.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192)); return { status: r.status, type: r.headers.get('content-type'), disp: r.headers.get('content-disposition'), b64: btoa(s) }; }, url);
const axe = async (p, label) => { await p.evaluate(axeSource); const r = await p.evaluate(async () => (await window.axe.run({ runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations.map((v) => `${v.id}(${v.nodes.length}): ${v.nodes[0].target.join(' ')} ${v.nodes[0].failureSummary?.split('\n')[1] ?? ''}`)); ok(`a11y (axe wcag2aa): ${label}`, r.length === 0, r.join(' | ')); };

const stamp = Date.now(), email = `ui${stamp}@test.dev`, password = 'a long browser password';
const anonCtx = await browser.createBrowserContext();

// =============== Home (anonymous) ===============
const home = await newPage(anonCtx);
await step('home', async () => {
  await go(home, '/');
  ok('home: title + tagline', (await home.title()).includes('NexoraTools') && (await home.$eval('h1', (e) => e.textContent)) === 'Simple tools for your files.');
  const names = await home.$$eval('article h3', (els) => els.map((e) => e.textContent));
  ok('home: popular + categorised tool cards render (every tool appears)', ['Merge PDF', 'Split PDF', 'Compress PDF', 'PDF to JPG', 'JPG to PNG', 'Image resizer'].every((n) => names.includes(n)), names.join());
  ok('home: each real tool card has an "Open tool" button', (await home.$$('a[aria-label^="Open tool"]')).length >= 14);
  ok('home: planned tools are labelled Planned and have no button', await home.$$eval('article[aria-label$="(planned)"]', (els) => els.length > 0 && els.every((e) => !e.querySelector('a,button') && /Planned/.test(e.textContent))));
  ok('home: retention shown from real server config', /after 60 minutes/.test(await bodyText(home)));
  ok('desktop: hamburger menu button is hidden at 1280px, full nav visible', !(await home.$eval('button[aria-label="Open menu"]', (e) => e.offsetParent !== null)) && (await home.$eval('nav[aria-label="Main"]', (e) => e.offsetParent !== null)));
  await shot(home, 'home-desktop');
  await home.type('input[aria-label="Search tools"]', 'merge');
  const found = await home.$$eval('article h3', (els) => els.map((e) => e.textContent));
  ok('home: search "merge" narrows to Merge PDF', found.length === 1 && found[0] === 'Merge PDF', found.join());
  await home.$eval('input[aria-label="Search tools"]', (e) => { e.value = ''; });
  await clear(home, 'input[aria-label="Search tools"]'); await home.type('input[aria-label="Search tools"]', 'zzzz');
  ok('home: empty search shows a helpful message', /No tools match/.test(await bodyText(home)));
  await home.$eval('input[aria-label="Search tools"]', (e) => { e.focus(); e.select(); }); await home.keyboard.press('Backspace');
  await clickText(home, '[role=tab]', '^Image Tools$'); await sleep(150);
  const imgs = await home.$$eval('article h3', (els) => els.map((e) => e.textContent));
  ok('home: Image Tools tab shows only image tools', imgs.length === 4 && imgs.includes('Image resizer'), imgs.join());
  await axe(home, 'home (light)');
  await home.evaluate(() => document.querySelector('button[aria-label^="Switch to dark"]').click());
  await sleep(200);
  ok('theme: toggle switches to dark', (await home.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await shot(home, 'home-dark'); await axe(home, 'home (dark)');
  await home.reload({ waitUntil: 'networkidle0' });
  ok('theme: choice persists across reload', (await home.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await home.evaluate(() => document.querySelector('button[aria-label^="Switch to light"]').click());
});

// =============== Mobile ===============
const mob = await newPage(anonCtx, { w: 390, h: 844, mobile: true });
await step('mobile', async () => {
  await go(mob, '/');
  ok('mobile: no horizontal scrolling', await mob.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await mob.evaluate(() => document.documentElement.scrollWidth));
  ok('mobile: desktop nav hidden, menu button shown', (await mob.$eval('button[aria-label="Open menu"]', (e) => e.offsetParent !== null)) && !(await mob.$eval('nav[aria-label="Main"]', (e) => e.offsetParent !== null)));
  await shot(mob, 'home-mobile');
  await mob.click('button[aria-label="Open menu"]');
  ok('mobile: menu opens with links + auth buttons', /Developers/.test(await mob.$eval('#mobile-nav', (e) => e.innerText)) && /Create account/.test(await mob.$eval('#mobile-nav', (e) => e.innerText)));
  await shot(mob, 'mobile-menu');
  await go(mob, '/tools/merge-pdf');
  ok('mobile: tool page has no horizontal scroll', await mob.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  const btn = await mob.$('button.btn-primary'); const box = await btn.boundingBox();
  ok('mobile: primary button is a comfortable touch target (>=44px)', box.height >= 44, box.height);
});

// =============== Anonymous tool flow -> sign-in keeps the file ===============
const flow = await newPage(anonCtx);
await step('anon tool', async () => {
  await go(flow, '/tools/compress-pdf');
  await (await flow.$('input[type=file]')).uploadFile(`${DIR}/a.pdf`);
  await waitText(flow, /a\.pdf/);
  ok('tool: file appears with name and size', /a\.pdf/.test(await bodyText(flow)) && /\d+(\.\d+)? KB/.test(await bodyText(flow)));
  ok('tool: anonymous user is told to sign in; button says so', /Create a free account or sign in/.test(await bodyText(flow)) && /Sign in to continue/.test(await bodyText(flow)));
  await clickText(flow, 'button', 'Sign in to continue');
  await flow.waitForFunction(() => location.pathname === '/login');
  ok('tool: redirected to login with return path', flow.url().includes('next=%2Ftools%2Fcompress-pdf'), flow.url());
  await flow.click('main a[href^="/register"]'); await flow.waitForSelector('#name');
  await flow.type('#name', 'Ula Tester'); await flow.type('#email', email); await flow.type('#password', password);
  await clickText(flow, 'button[type=submit]', 'Create account');
  await flow.waitForFunction(() => location.pathname === '/tools/compress-pdf', { timeout: 15000 }).catch(async (e) => { throw new Error(`${e.message} (url=${flow.url()}; page: ${(await bodyText(flow)).slice(0, 160).replace(/\n/g, ' | ')})`); });
  await waitText(flow, /a\.pdf/);
  ok('register -> back on the tool with the file still selected', /a\.pdf/.test(await bodyText(flow)) && /Compress PDF/.test(await bodyText(flow)));
});

// =============== Auth form validation ===============
const auth = await newPage(await browser.createBrowserContext());
await step('auth validation', async () => {
  await go(auth, '/register');
  await clickText(auth, 'button[type=submit]', 'Create account');
  const t = await bodyText(auth);
  ok('register: empty form shows field errors', /Enter your name/.test(t) && /valid email/.test(t) && /Enter your password/.test(t));
  await auth.type('#name', 'X'); await auth.type('#email', 'x@y.zz'); await auth.type('#password', 'short');
  await clickText(auth, 'button[type=submit]', 'Create account');
  ok('register: short password rejected client-side', /at least 10 characters/i.test(await bodyText(auth)) && auth.url().endsWith('/register'));
  await shot(auth, 'register-errors'); await axe(auth, 'register page (with errors)');
  await go(auth, '/register');
  await auth.type('#name', 'Dup'); await auth.type('#email', email); await auth.type('#password', password);
  await clickText(auth, 'button[type=submit]', 'Create account');
  await waitText(auth, /already exists/);
  ok('register: duplicate email -> server message on the email field', /already exists/.test(await bodyText(auth)));
  await go(auth, '/login');
  await auth.type('#email', email); await auth.type('#password', 'definitely wrong password');
  await clickText(auth, 'button[type=submit]', 'Sign in');
  await waitText(auth, /Incorrect email or password/);
  ok('login: wrong password -> friendly error, stays on page', auth.url().includes('/login'));
  await clear(auth, '#password'); await auth.type('#password', password);
  await clickText(auth, 'button[type=submit]', 'Sign in');
  await auth.waitForFunction(() => location.pathname === '/dashboard', { timeout: 15000 });
  ok('login: success -> dashboard', /Hello, Ula/.test(await bodyText(auth)));
  ok('guest redirect: protected page bounces anonymous users to login', await (async () => { const g = await newPage(await browser.createBrowserContext()); await g.goto(WEB + '/history', { waitUntil: 'networkidle0' }); const u = g.url(); await g.close(); return u.includes('/login?next=%2Fhistory'); })());
});

// =============== Signed-in tool runs ===============
const ctx = await browser.createBrowserContext();
const app = await newPage(ctx);
await app.goto(WEB + '/login', { waitUntil: 'networkidle0' });
await app.type('#email', email); await app.type('#password', password); await clickText(app, 'button[type=submit]', 'Sign in');
await app.waitForFunction(() => location.pathname === '/dashboard');

await step('merge', async () => {
  await go(app, '/tools/merge-pdf');
  const input = await app.$('input[type=file]');
  await input.uploadFile(`${DIR}/a.pdf`, `${DIR}/b.pdf`);
  await waitText(app, /position 2 of 2/);
  ok('merge: two files listed in upload order', (await app.$$eval('ul[aria-label="Selected files"] li p.truncate', (e) => e.map((x) => x.textContent))).join() === 'a.pdf,b.pdf');
  await app.click('button[aria-label="Move b.pdf up"]');
  ok('merge: reorder with arrow button', (await app.$$eval('ul[aria-label="Selected files"] li p.truncate', (e) => e.map((x) => x.textContent))).join() === 'b.pdf,a.pdf');
  await shot(app, 'tool-merge-files');
  await clickText(app, 'button', '^Merge PDFs$');
  await waitText(app, /Conversion complete/);
  await shot(app, 'tool-merge-done');
  const href = await app.$eval('a[download]', (a) => a.getAttribute('href'));
  const dl = await fetchB64(app, href); writeFileSync(`${DIR}/merged.pdf`, Buffer.from(dl.b64, 'base64'));
  ok('merge: download is a real PDF with the reordered pages (B then A)', dl.status === 200 && dl.type === 'application/pdf' && pages(`${DIR}/merged.pdf`) === 5 && text(`${DIR}/merged.pdf`, 1) === 'B-p1' && text(`${DIR}/merged.pdf`, 3) === 'A-p1', `${dl.status} ${dl.type}`);
  ok('merge: served as attachment', /attachment/.test(dl.disp));
  await axe(app, 'tool page (result state)');
  await clickText(app, 'button', 'Start over');
  ok('merge: "Start over" returns to an empty form', /Upload your PDF files/.test(await bodyText(app)));
});

await step('validation', async () => {
  await go(app, '/tools/pdf-to-jpg');
  await (await app.$('input[type=file]')).uploadFile(`${DIR}/notes.txt`);
  await waitText(app, /isn't a PDF file/);
  ok('tool: wrong file type rejected with a clear message', /"notes\.txt" isn't a PDF file/.test(await bodyText(app)));
  await go(app, '/tools/delete-pdf-pages');
  await (await app.$('input[type=file]')).uploadFile(`${DIR}/a.pdf`);
  await waitText(app, /Pages to delete/);
  await clickText(app, 'button', '^Delete pages$');
  ok('tool: required option missing -> field error, nothing uploaded', /Required|Use a format|String must contain/i.test(await bodyText(app)) && !/Uploading/.test(await bodyText(app)), (await bodyText(app)).slice(-300));
  await app.type('#opt-pages', '9');
  await clickText(app, 'button', '^Delete pages$');
  await waitText(app, /Processing failed/);
  ok("tool: server-side failure shown plainly (\"Page 9 doesn't exist\"), no stack trace", /Page 9 doesn't exist/.test(await bodyText(app)) && !/\bat \w+.*\.(ts|js):\d+/.test(await bodyText(app)));
  await shot(app, 'tool-error');
  await go(app, '/tools/pdf-to-jpg');
  await (await app.$('input[type=file]')).uploadFile(`${DIR}/corrupt.pdf`);
  await waitText(app, /corrupt\.pdf/); await clickText(app, 'button', '^Convert to JPG$');
  await waitText(app, /Processing failed/);
  ok('tool: corrupt PDF -> friendly worker error', /corrupt, encrypted or unreadable/.test(await bodyText(app)), (await bodyText(app)).slice(-250));
});

await step('options', async () => {
  await go(app, '/tools/rotate-pdf');
  await (await app.$('input[type=file]')).uploadFile(`${DIR}/a.pdf`);
  await waitText(app, /Rotate clockwise by/);
  await app.select('#opt-angle', '180'); await app.type('#opt-pages', '2');
  await clickText(app, 'button', '^Rotate PDF$'); await waitText(app, /Conversion complete/);
  const href = await app.$eval('a[download]', (a) => a.getAttribute('href')); const dl = await fetchB64(app, href); writeFileSync(`${DIR}/rot.pdf`, Buffer.from(dl.b64, 'base64'));
  const info = execFileSync('pdfinfo', ['-f', '1', '-l', '3', `${DIR}/rot.pdf`]).toString();
  ok('rotate: options from the form reach the worker (page 2 rotated 180, page 1 untouched)', /Page\s+2 rot:\s+180/.test(info) && /Page\s+1 rot:\s+0/.test(info));
  await go(app, '/tools/png-to-jpg');
  ok('image tool page loads with accepted type hint', /PNG/.test(await bodyText(app)));
  await go(app, '/tools/jpg-to-png');
  await (await app.$('input[type=file]')).uploadFile(`${DIR}/photo.jpg`);
  await waitText(app, /photo\.jpg/); await clickText(app, 'button', '^Convert to PNG$'); await waitText(app, /Conversion complete/);
  const d2 = await fetchB64(app, await app.$eval('a[download]', (a) => a.getAttribute('href')));
  const meta = await sharp(Buffer.from(d2.b64, 'base64')).metadata();
  ok('jpg-to-png via the UI yields a real 800x600 PNG', d2.type === 'image/png' && meta.format === 'png' && meta.width === 800 && meta.height === 600);
});

await step('hero', async () => {
  await go(app, '/');
  await (await app.$('input[type=file]')).uploadFile(`${DIR}/a.pdf`);
  await waitText(app, /What do you want to do with it/);
  const opts = await app.$$eval('li > button.btn', (b) => b.map((x) => x.textContent.trim()));
  ok('hero: dropping a PDF offers PDF tools only', opts.includes('Merge PDF') && opts.includes('Compress PDF') && !opts.includes('JPG to PNG'), opts.join());
  await shot(app, 'home-hero-options');
  await clickText(app, 'li > button.btn', '^Split PDF$');
  await app.waitForFunction(() => location.pathname === '/tools/split-pdf');
  await waitText(app, /a\.pdf/);
  ok('hero: chosen tool opens with the dropped file already selected', /a\.pdf/.test(await bodyText(app)));
  await go(app, '/');
  await (await app.$('input[type=file]')).uploadFile(`${DIR}/notes.txt`);
  await waitText(app, /none of the tools can open it/);
  ok('hero: unsupported file gets an honest message', true);
});

await step('progress', async () => {
  await go(app, '/tools/compress-pdf');
  const cdp = await app.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: -1, uploadThroughput: 2 * 1024 * 1024 });
  await (await app.$('input[type=file]')).uploadFile(`${DIR}/big.pdf`);
  await waitText(app, /big\.pdf/);
  await app.evaluate(() => { window.__seen = []; setInterval(() => { const m = /Uploading… (\d+)%/.exec(document.body.innerText); if (m) window.__seen.push(Number(m[1])); }, 150); });
  await clickText(app, 'button', '^Compress PDF$');
  await waitText(app, /Conversion complete|Processing failed/, 90000);
  const seen = await app.evaluate(() => window.__seen);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  ok('upload progress is real: 10 MB at 2 MB/s showed several rising percentages', new Set(seen.filter((n) => n > 0 && n < 100)).size >= 4 && seen.every((n, i) => i === 0 || n >= seen[i - 1]), JSON.stringify(seen.slice(0, 20)));
  ok('large upload completed through the proxy', /Conversion complete/.test(await bodyText(app)));
});

await step('dashboard+history', async () => {
  await go(app, '/dashboard');
  const t = await bodyText(app);
  ok('dashboard: real numbers (conversions, stored, processed)', /Conversions/.test(t) && /Stored right now/.test(t) && /Recent jobs/.test(t) && !/Hello, undefined/.test(t));
  const n = Number(await app.evaluate(() => { const stats = [...document.querySelectorAll('p.font-display')].map((e) => e.textContent); return stats[0]; }));
  const api = await app.evaluate(async () => (await (await fetch('/api/me/usage')).json()).data.totalConversions);
  ok('dashboard: conversions stat equals the API value', n === api, `${n} vs ${api}`);
  await shot(app, 'dashboard'); await axe(app, 'dashboard');
  await go(app, '/history');
  const rows = await app.$$eval('table.ledger tbody tr', (r) => r.length);
  ok('history: lists the jobs with tool, status and download', rows >= 6 && /Completed/.test(await bodyText(app)) && (await app.$$('table.ledger a[download]')).length >= 3, rows);
  ok('history: failed jobs show why', /Page 9 doesn't exist|corrupt, encrypted/.test(await bodyText(app)));
  await app.select('#f-status', 'FAILED');
  await app.waitForFunction(() => [...document.querySelectorAll('table.ledger tbody tr')].every((r) => /Failed/.test(r.textContent)) && document.querySelectorAll('table.ledger tbody tr').length > 0);
  ok('history: status filter works', true);
  await app.select('#f-status', ''); await app.select('#f-tool', 'merge-pdf');
  await app.waitForFunction(() => { const r = [...document.querySelectorAll('table.ledger tbody tr')]; return r.length > 0 && r.every((x) => /Merge PDF/.test(x.textContent)); });
  ok('history: tool filter works', true);
  await app.select('#f-tool', 'compress-image');
  await waitText(app, /No jobs match those filters/);
  ok('history: empty filter result has an empty state', true);
  await shot(app, 'history'); await axe(app, 'history');
});

await step('api keys', async () => {
  await go(app, '/api-keys');
  await clickText(app, 'button[type=submit]', 'Create key');
  ok('keys: empty name -> field error', /Give the key a name/.test(await bodyText(app)));
  await app.type('#key-name', 'Browser test key'); await clickText(app, 'button[type=submit]', 'Create key');
  await app.waitForSelector('[data-testid=new-key]');
  const secret = await app.$eval('[data-testid=new-key]', (e) => e.textContent);
  ok('keys: new key shown once with a warning', /^nx_live_/.test(secret) && /only this once/.test(await bodyText(app)));
  await shot(app, 'api-keys');
  const viaKey = await fetch(`${WEB}/api/v1/tools`, { headers: { authorization: `Bearer ${secret}` } });
  ok('keys: the key works against the public API (through the web proxy)', viaKey.status === 200);
  await clickText(app, 'button', "I've saved it");
  ok('keys: after dismissing, the raw key is nowhere on the page', !(await bodyText(app)).includes(secret) && /nx_live_\w{4}…/.test(await bodyText(app)));
  await clickText(app, 'button', '^Revoke$'); await clickText(app, 'button', '^Revoke “Browser test key”$');
  await waitText(app, /No active keys/);
  ok('keys: revoke (with confirmation) -> key stops working', (await fetch(`${WEB}/api/v1/tools`, { headers: { authorization: `Bearer ${secret}` } })).status === 401);
  await axe(app, 'api keys');
});

await step('account', async () => {
  await go(app, '/account');
  ok('account: profile shows real details', /Ula Tester/.test(await bodyText(app)) && new RegExp(email.replace('.', '\\.')).test(await bodyText(app)));
  await app.type('#cur', password); await app.type('#new', 'short');
  await clickText(app, 'button[type=submit]', 'Change password');
  ok('account: short new password rejected', /at least 10 characters/.test(await bodyText(app)));
  await clear(app, '#new'); await app.type('#new', 'another long password');
  await clickText(app, 'button[type=submit]', 'Change password'); await waitText(app, /Password changed/);
  ok('account: password change succeeds and keeps this session', /Password changed/.test(await bodyText(app)));
  await app.reload({ waitUntil: 'networkidle0' });
  ok('account: still signed in after change', /Ula Tester/.test(await bodyText(app)));
  await shot(app, 'account');
  await app.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Sign out/.test(b.textContent)).click());
  await app.waitForFunction(() => location.pathname === '/');
  await go(app, '/dashboard'); await app.waitForFunction(() => location.pathname === '/login');
  ok('sign out: session ends, protected pages bounce to login', true);
});

// =============== Admin ===============
await step('admin', async () => {
  const user = await newPage(await browser.createBrowserContext());
  await go(user, '/login'); await user.type('#email', email); await user.type('#password', 'another long password'); await clickText(user, 'button[type=submit]', 'Sign in');
  await user.waitForFunction(() => location.pathname === '/dashboard');
  await go(user, '/admin');
  ok('admin: regular user sees "Administrators only"', /Administrators only/.test(await bodyText(user)));
  const raw = await user.evaluate(async () => (await fetch('/api/admin/stats')).status);
  ok('admin: API refuses the regular user too (403)', raw === 403);
  await user.evaluate(() => document.querySelector('header')); 
  ok('admin: no Admin link in the user menu', !(await user.evaluate(() => [...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/admin'))));

  const ad = await newPage(await browser.createBrowserContext());
  await go(ad, '/login'); await ad.type('#email', 'admin@test.dev'); await ad.type('#password', 'adminpassword123'); await clickText(ad, 'button[type=submit]', 'Sign in');
  await ad.waitForFunction(() => location.pathname === '/dashboard');
  await go(ad, '/admin');
  await waitText(ad, /Jobs by status/);
  const apiStats = await ad.evaluate(async () => (await (await fetch('/api/admin/stats')).json()).data);
  const t = await bodyText(ad);
  ok('admin overview: totals shown match the API', new RegExp(`Users\\s+${apiStats.users.total}\\b`).test(t) && new RegExp(`Jobs\\s+${apiStats.jobs.total}\\b`).test(t) && new RegExp(`Failed\\s+${apiStats.jobs.byStatus.FAILED}\\b`).test(t), t.slice(0, 300));
  await shot(ad, 'admin-overview'); await axe(ad, 'admin overview');

  await go(ad, '/admin/users');
  await ad.type('#u-search', `ui${stamp}`);
  await ad.waitForFunction(() => document.querySelectorAll('table.ledger tbody tr').length === 1);
  ok('admin users: search narrows to the test user, showing job count and storage', /Ula Tester/.test(await bodyText(ad)));
  await clickText(ad, 'button', '^Disable$'); await clickText(ad, 'button', '^Disable Ula$');
  await ad.waitForFunction(() => document.querySelector('table.ledger tbody tr')?.textContent.includes('Disabled'));
  const me = await user.evaluate(async () => (await fetch('/api/me')).status);
  ok('admin users: disabling in the UI takes effect immediately for that user (their API session is dead)', me === 401, me);
  await shot(ad, 'admin-users');
  await clickText(ad, 'a', '^Ula Tester$'); await waitText(ad, /Recent jobs/);
  ok('admin user detail: usage, keys and recent jobs', /API keys/.test(await bodyText(ad)) && /Recent jobs/.test(await bodyText(ad)) && /account disabled/.test(await bodyText(ad)));
  await go(ad, '/admin/users'); await ad.type('#u-search', `ui${stamp}`); await ad.waitForFunction(() => document.querySelectorAll('table.ledger tbody tr').length === 1);
  await clickText(ad, 'button', '^Enable$'); await clickText(ad, 'button', '^Enable Ula$');
  await ad.waitForFunction(() => /Active/.test(document.querySelector('table.ledger tbody tr')?.textContent ?? ''));
  ok('admin users: re-enable works', true);

  await go(ad, '/admin/jobs');
  await ad.waitForSelector('table.ledger');
  await ad.select('#j-status', 'FAILED'); await clickText(ad, 'button', 'Apply filters');
  await ad.waitForFunction(() => { const r = [...document.querySelectorAll('table.ledger tbody tr')]; return r.length > 0 && r.every((x) => /Failed/.test(x.textContent)); });
  ok('admin jobs: filter by status shows failed jobs with error text and owner', /Page 9|corrupt/.test(await bodyText(ad)) && /@test\.dev/.test(await bodyText(ad)));
  await shot(ad, 'admin-jobs'); await axe(ad, 'admin jobs');

  await go(ad, '/admin/system'); await waitText(ad, /Last cleanup/);
  const sys = await bodyText(ad);
  ok('admin system: DB, Redis, queues, worker and storage panels with live data', /Database/.test(sys) && /Redis/.test(sys) && /Queues/.test(sys) && /pdf \+ image/.test(sys) && /Disk free/.test(sys), sys.slice(0, 400));
  ok('admin system: no secrets rendered', !/nexora:nexora|dev-only-secret|adminpassword123/.test(sys));
  await shot(ad, 'admin-system'); await axe(ad, 'admin system');
  await go(ad, '/admin/audit'); await waitText(ad, /Disabled a user/);
  ok('admin audit: shows the disable/enable actions just performed', /Disabled a user/.test(await bodyText(ad)) && /Enabled a user/.test(await bodyText(ad)));
});

ok('no unexpected console errors or page exceptions during the whole run', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' || '));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
