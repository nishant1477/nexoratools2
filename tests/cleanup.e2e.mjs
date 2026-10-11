// Cleanup worker: expiry, protection of active jobs, stuck jobs, orphans, scratch dirs, history purge, lock, scheduler.
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
// Pause/resume the worker process (built: node workers/worker/dist/index.js; dev: tsx child whose cwd is workers/worker).
const signalWorker = (sig) => sh(`for p in $(pgrep -f "dist/index.js|src/index.ts"); do [ "$(cat /proc/$p/comm 2>/dev/null)" = node ] || continue; if tr '\\0' ' ' < /proc/$p/cmdline | grep -q "workers/worker/dist/index.js" || ls -l /proc/$p/cwd 2>/dev/null | grep -q "workers/worker"; then kill -${sig} $p; fi; done`);
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';

const B = 'http://localhost:4000/api', STORAGE = '/tmp/nx-storage';
let pass = 0, fail = 0, cookie = '';
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '   <- ' + x}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (q) => execFileSync('psql', ['-h', 'localhost', '-U', 'nexora', '-d', 'nexora', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'nexora' } }).toString().trim();
const sh = (c, timeout = 60000) => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'ignore'], timeout }).toString().trim(); } catch { return ''; } };
const api = async (m, p, body) => { const r = await fetch(B + p, { method: m, headers: { ...(cookie && { cookie }), ...(body && !(body instanceof FormData) && { 'content-type': 'application/json' }) }, body: body instanceof FormData ? body : body && JSON.stringify(body) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const ct = r.headers.get('content-type') ?? ''; return { status: r.status, json: ct.includes('json') ? await r.json() : null }; };
const doc = await PDFDocument.create(); doc.addPage([200, 200]); doc.addPage([200, 200]); const pdf = Buffer.from(await doc.save());
const submit = (tool = 'extract-pdf-pages', options = { pages: '1' }) => { const f = new FormData(); f.append('tool', tool); f.append('options', JSON.stringify(options)); f.append('file', new Blob([pdf]), 't.pdf'); return api('POST', '/jobs', f); };
const waitDone = async (id) => { for (let i = 0; i < 60; i++) { const j = (await api('GET', `/jobs/${id}`)).json.data.job; if (['COMPLETED', 'FAILED'].includes(j.status)) return j; await sleep(300); } throw new Error('timeout'); };
const cleanup = async () => { for (let i = 0; i < 5; i++) { const out = sh(`cd ${ROOT}/workers/worker && STORAGE_DIR=/tmp/nx-storage DATABASE_URL=postgresql://nexora:nexora@localhost:5432/nexora JOB_HISTORY_DAYS=30 LOG_LEVEL=error npx tsx --env-file=../../.env src/cleanup-cli.ts`); if (!out.includes('already running')) return out; await sleep(2000); } return ''; };
const fileRows = (jobId) => psql(`select id||'|'||"storageKey"||'|'||type||'|'||coalesce("deletedAt"::text,'') from "File" where "jobId"='${jobId}' order by type`).split('\n').filter(Boolean).map((l) => { const [id, key, type, del] = l.split('|'); return { id, key, type, deleted: del !== '' }; });
const onDisk = (key) => existsSync(`${STORAGE}/${key}`);

process.env.DATABASE_URL = 'postgresql://nexora:nexora@localhost:5432/nexora';
await api('POST', '/auth/register', { email: `cl${Date.now()}@test.dev`, password: 'a long test password', name: 'Cleaner' });

// ---- 1. expired files of a finished job are deleted; unexpired ones are not
let r = await submit(); const jExp = await waitDone(r.json.data.job.id);
r = await submit(); const jKeep = await waitDone(r.json.data.job.id);
ok('two completed jobs with input+output files on disk', jExp.status === 'COMPLETED' && jKeep.status === 'COMPLETED' && fileRows(jExp.id).every((f) => onDisk(f.key)));
const expRows = fileRows(jExp.id), outExp = expRows.find((f) => f.type === 'OUTPUT');
psql(`update "File" set "expiresAt"=now()-interval '2 minutes' where "jobId"='${jExp.id}'; update "Job" set "expiresAt"=now()-interval '2 minutes' where id='${jExp.id}'`);
await cleanup();
ok('expired job: bytes deleted from disk (input + output)', expRows.every((f) => !onDisk(f.key)), expRows.map((f) => onDisk(f.key)).join());
ok('expired job: File rows marked deletedAt, kept for history', fileRows(jExp.id).every((f) => f.deleted));
ok('expired job: COMPLETED -> EXPIRED', psql(`select status from "Job" where id='${jExp.id}'`) === 'EXPIRED');
r = await api('GET', `/files/${outExp.id}/download`); ok('downloading an expired file -> 410 FILE_EXPIRED', r.status === 410 && r.json.error.code === 'FILE_EXPIRED', JSON.stringify(r.json));
r = await api('GET', `/jobs/${jExp.id}`); ok('expired job still visible in history with EXPIRED status', r.json.data.job.status === 'EXPIRED');
ok('unexpired job untouched (files on disk, still COMPLETED)', fileRows(jKeep.id).every((f) => onDisk(f.key) && !f.deleted) && psql(`select status from "Job" where id='${jKeep.id}'`) === 'COMPLETED');

// ---- 2. active jobs are never touched; stuck jobs are failed then collected
signalWorker('STOP');
r = await submit(); const jProc = r.json.data.job.id;   // stays QUEUED because the worker is paused
r = await submit(); const jStale = r.json.data.job.id;
r = await submit(); const jStuck = r.json.data.job.id;
psql(`update "Job" set status='PROCESSING', "startedAt"=now() where id='${jProc}'; update "File" set "expiresAt"=now()-interval '5 minutes' where "jobId"='${jProc}'`);
psql(`update "Job" set "expiresAt"=now()-interval '5 minutes' where id='${jStale}'; update "File" set "expiresAt"=now()-interval '5 minutes' where "jobId"='${jStale}'`);
psql(`update "Job" set status='PROCESSING', "startedAt"=now()-interval '1 hour' where id='${jStuck}'; update "File" set "expiresAt"=now()-interval '5 minutes' where "jobId"='${jStuck}'`);
const procFiles = fileRows(jProc), stuckFiles = fileRows(jStuck), staleFiles = fileRows(jStale);
await cleanup(); await sleep(500);
ok('PROCESSING job with expired files is NOT touched (files kept)', procFiles.every((f) => onDisk(f.key)) && psql(`select status from "Job" where id='${jProc}'`) === 'PROCESSING' && fileRows(jProc).every((f) => !f.deleted));
ok('stuck PROCESSING job (worker died) -> FAILED / WORKER_FAILURE, files collected', psql(`select status||'/'||"errorCode" from "Job" where id='${jStuck}'`) === 'FAILED/WORKER_FAILURE' && stuckFiles.every((f) => !onDisk(f.key)));
ok('stale QUEUED job past expiry -> EXPIRED and removed from queue', psql(`select status from "Job" where id='${jStale}'`) === 'EXPIRED' && staleFiles.every((f) => !onDisk(f.key)) && sh(`redis-cli exists bull:nexora-pdf:${jStale}`) === '0');
signalWorker('CONT');
psql(`update "Job" set status='CANCELLED' where id='${jProc}'`); // tidy: finish the simulated job

// ---- 3. orphans and scratch dirs
const oldOrphan = `${STORAGE}/inputs/${randomUUID()}.bin`, newOrphan = `${STORAGE}/inputs/${randomUUID()}.bin`, outOrphan = `${STORAGE}/outputs/${randomUUID()}.pdf`;
for (const f of [oldOrphan, newOrphan, outOrphan]) writeFileSync(f, 'orphan');
const twoHoursAgo = new Date(Date.now() - 2 * 3600_000); utimesSync(oldOrphan, twoHoursAgo, twoHoursAgo); utimesSync(outOrphan, twoHoursAgo, twoHoursAgo);
const oldTmp = `${STORAGE}/tmp/${randomUUID()}`, newTmp = `${STORAGE}/tmp/${randomUUID()}`;
mkdirSync(oldTmp); mkdirSync(newTmp); writeFileSync(`${oldTmp}/x`, '1'); utimesSync(oldTmp, twoHoursAgo, twoHoursAgo);
await cleanup(); await sleep(300);
ok('orphan upload older than grace period deleted (inputs + outputs)', !existsSync(oldOrphan) && !existsSync(outOrphan));
ok('fresh orphan kept (could be an upload in flight)', existsSync(newOrphan));
ok('stale scratch dir removed, fresh one kept', !existsSync(oldTmp) && existsSync(newTmp));
ok('known (DB-tracked) files are never mistaken for orphans', fileRows(jKeep.id).every((f) => onDisk(f.key)));

// ---- 4. history purge
r = await submit(); const jOld = await waitDone(r.json.data.job.id); const oldRows = fileRows(jOld.id);
r = await submit(); const jRecent = await waitDone(r.json.data.job.id);
psql(`update "Job" set "expiresAt"=now()-interval '40 days', status='EXPIRED' where id='${jOld.id}'; update "File" set "expiresAt"=now()-interval '40 days' where "jobId"='${jOld.id}'`);
psql(`update "Job" set "expiresAt"=now()-interval '1 day', status='EXPIRED' where id='${jRecent.id}'; update "File" set "expiresAt"=now()-interval '1 day' where "jobId"='${jRecent.id}'`);
await cleanup(); await sleep(300);
ok('job older than JOB_HISTORY_DAYS (30) purged with its file rows + bytes', psql(`select count(*) from "Job" where id='${jOld.id}'`) === '0' && psql(`select count(*) from "File" where "jobId"='${jOld.id}'`) === '0' && oldRows.every((f) => !onDisk(f.key)));
ok('1-day-old expired job kept in history', psql(`select count(*) from "Job" where id='${jRecent.id}'`) === '1');

// ---- 5. idempotent, lock, scheduler
const again = await cleanup(); const parsed = again ? JSON.parse(again) : null;
ok('re-running is a no-op (nothing left to delete)', parsed && parsed.filesDeleted === 0 && parsed.orphansDeleted === 0 && parsed.jobsPurged === 0, again);
sh('redis-cli set nexora:cleanup:lock 999 EX 60');
const locked = sh(`cd ${ROOT}/workers/worker && STORAGE_DIR=/tmp/nx-storage DATABASE_URL=postgresql://nexora:nexora@localhost:5432/nexora JOB_HISTORY_DAYS=30 LOG_LEVEL=error npx tsx --env-file=../../.env src/cleanup-cli.ts`);
ok('a second cleanup while one holds the lock is skipped', locked.includes('already running'), locked);
sh('redis-cli del nexora:cleanup:lock');
const last0 = JSON.parse(sh('redis-cli get nexora:cleanup:last') || '{"at":""}').at;
let moved = false; for (let i = 0; i < 90 && !moved; i++) { await sleep(1000); const l = JSON.parse(sh('redis-cli get nexora:cleanup:last') || '{"at":""}').at; moved = l && l !== last0; }
ok('worker scheduler runs cleanup on its own (CLEANUP_INTERVAL_MINUTES=1)', moved);

// ---- 6. nothing active lost
ok('no stray QUEUED/PROCESSING jobs left behind by the tests', psql(`select count(*) from "Job" where status in ('QUEUED','PROCESSING')`) === '0', psql(`select id||' '||status from "Job" where status in ('QUEUED','PROCESSING')`));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
