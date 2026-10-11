// Job lifecycle edge cases: cancel while processing, cancel while queued (worker paused), cleanup of scratch space.
import { execFileSync, execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { PDFDocument, rgb } from 'pdf-lib';

const B = 'http://localhost:4000/api', STORAGE = '/tmp/nx-storage';
let pass = 0, fail = 0, cookie = '';
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '   <- ' + x}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (m, p, body) => {
  const r = await fetch(B + p, { method: m, headers: { ...(cookie && { cookie }), ...(body && !(body instanceof FormData) && { 'content-type': 'application/json' }) }, body: body instanceof FormData ? body : body && JSON.stringify(body) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, json: await r.json() };
};
const submit = (tool, buf, options) => { const f = new FormData(); f.append('tool', tool); f.append('options', JSON.stringify(options)); f.append('file', new Blob([buf]), 'heavy.pdf'); return api('POST', '/jobs', f); };
const status = async (id) => (await api('GET', `/jobs/${id}`)).json.data.job;
const sh = (c) => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
// execFileSync (no shell) so SQL quoting can't break the command.
const psql = (q) => execFileSync('psql', ['-h', 'localhost', '-U', 'nexora', '-d', 'nexora', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'nexora' } }).toString().trim();
// Finds the worker process (built: `node workers/worker/dist/index.js`; dev: the tsx child whose cwd is workers/worker).
const workerPid = () => sh(`for p in $(pgrep -f "dist/index.js|src/index.ts"); do [ "$(cat /proc/$p/comm 2>/dev/null)" = node ] || continue; if tr '\\0' ' ' < /proc/$p/cmdline | grep -q "workers/worker/dist/index.js" || ls -l /proc/$p/cwd 2>/dev/null | grep -q "workers/worker"; then echo $p; fi; done`).split('\n').filter(Boolean).pop();

// A deliberately slow document: 200 pages of dense vector art rendered at 300 DPI.
const doc = await PDFDocument.create();
for (let i = 0; i < 200; i++) { const pg = doc.addPage([612, 792]); for (let k = 0; k < 400; k++) pg.drawRectangle({ x: (k * 13) % 560, y: (k * 29) % 740, width: 40, height: 40, color: rgb((k % 7) / 7, (k % 5) / 5, (k % 3) / 3), opacity: 0.5 }); }
const heavy = Buffer.from(await doc.save());

await api('POST', '/auth/register', { email: `life${Date.now()}@test.dev`, password: 'a long test password', name: 'Life' });

// ---- A: cancel while processing
let r = await submit('pdf-to-png', heavy, { dpi: 300 });
const jobA = r.json.data.job.id;
let st; for (let i = 0; i < 40; i++) { st = await status(jobA); if (st.status === 'PROCESSING') break; await sleep(250); }
ok('heavy job reaches PROCESSING', st.status === 'PROCESSING', st.status);
await sleep(1500);
ok('pdftoppm is actually running', sh('pgrep -x pdftoppm') !== '');
const tmpDirs = () => readdirSync(`${STORAGE}/tmp`);
ok('scratch dir exists while processing', tmpDirs().includes(jobA));
r = await api('POST', `/jobs/${jobA}/cancel`);
ok('cancel accepted -> CANCELLED', r.status === 200 && r.json.data.job.status === 'CANCELLED');
let gone = false; for (let i = 0; i < 20; i++) { if (sh('pgrep -x pdftoppm') === '') { gone = true; break; } await sleep(500); }
ok('worker stops the renderer within ~10s of cancel (no wasted CPU)', gone);
await sleep(1000);
st = await status(jobA);
ok('job stays CANCELLED (not overwritten to COMPLETED/FAILED)', st.status === 'CANCELLED', st.status);
const outRows = psql(`select count(*) from "File" where "jobId"='${jobA}' and type='OUTPUT'`);
ok('no output file rows for cancelled job', outRows === '0', outRows);
ok('scratch dir removed after cancel', !tmpDirs().includes(jobA), tmpDirs().join());
const onDisk = readdirSync(`${STORAGE}/outputs`).length, inDb = Number(psql(`select count(*) from "File" where type='OUTPUT' and "deletedAt" is null`));
ok('no orphaned output files on disk (disk matches DB)', onDisk === inDb, `disk=${onDisk} db=${inDb}`);

// ---- B: cancel while queued (worker paused)
const wp = workerPid();
ok('found worker pid', !!wp, wp);
sh(`kill -STOP ${wp}`);
r = await submit('pdf-to-png', heavy, { dpi: 72 });
const jobB = r.json.data.job.id; await sleep(500);
ok('job sits QUEUED while worker is paused', (await status(jobB)).status === 'QUEUED');
r = await api('POST', `/jobs/${jobB}/cancel`);
ok('cancel queued job -> CANCELLED', r.json.data.job.status === 'CANCELLED');
sh(`kill -CONT ${wp}`); await sleep(4000);
st = await status(jobB);
ok('resumed worker never runs the cancelled job (startedAt null, still CANCELLED)', st.status === 'CANCELLED' && st.startedAt === null, JSON.stringify(st));

// ---- C: worker keeps serving after all that
r = await submit('pdf-to-png', heavy.subarray(0, 0), { dpi: 72 });
const small = await PDFDocument.create(); small.addPage([200, 200]);
r = await submit('extract-pdf-pages', Buffer.from(await small.save()), { pages: '1' });
let s2; for (let i = 0; i < 40; i++) { s2 = await status(r.json.data.job.id); if (s2.status === 'COMPLETED') break; await sleep(250); }
ok('worker still healthy: next job completes', s2.status === 'COMPLETED', s2.status);

// ---- D: heartbeat visible to the admin dashboard
ok('worker heartbeat key present in Redis', sh('redis-cli --scan --pattern "nexora:worker:*"') !== '');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
