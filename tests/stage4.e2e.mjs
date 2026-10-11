// Stage 4: API keys + public v1 API, admin dashboard endpoints, usage numbers.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const B = process.env.API ?? 'http://localhost:4000/api';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '   <- ' + x}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (q) => execFileSync('psql', ['-h', 'localhost', '-U', 'nexora', '-d', 'nexora', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'nexora' } }).toString().trim();

class Client {
  cookie = '';
  async req(method, path, { json, form, headers = {} } = {}) {
    const h = { ...headers }; if (this.cookie) h.cookie = this.cookie;
    let body; if (json) { h['content-type'] = 'application/json'; body = JSON.stringify(json); } if (form) body = form;
    const r = await fetch(B + path, { method, headers: h, body });
    const sc = r.headers.get('set-cookie'); if (sc) { const c = sc.split(';')[0]; this.cookie = c.endsWith('=') ? '' : c; }
    const ct = r.headers.get('content-type') ?? '';
    return { status: r.status, headers: r.headers, json: ct.includes('json') ? await r.json() : null, buf: ct.includes('json') ? null : Buffer.from(await r.arrayBuffer()), text: null };
  }
}
const withKey = (key, extra = {}) => ({ headers: { authorization: `Bearer ${key}`, ...extra } });
const upload = (tool, files, options) => { const f = new FormData(); f.append('tool', tool); if (options) f.append('options', JSON.stringify(options)); for (const [n, b] of files) f.append('file', new Blob([b]), n); return f; };
async function mk(label, pages) { const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); for (let i = 1; i <= pages; i++) d.addPage([300, 300]).drawText(`${label}-p${i}`, { x: 20, y: 150, size: 30, font: f }); return Buffer.from(await d.save()); }
const pdfX = await mk('X', 2), pdfY = await mk('Y', 1);
const pdfText = (buf, n) => { require_fs.writeFileSync('/tmp/s4.pdf', buf); return execFileSync('pdftotext', ['-f', String(n), '-l', String(n), '/tmp/s4.pdf', '-']).toString().trim(); };
import * as require_fs from 'node:fs';

const stamp = Date.now();
const A = new Client(), Bc = new Client(), admin = new Client(), anon = new Client();
await A.req('POST', '/auth/register', { json: { email: `alice${stamp}@test.dev`, password: 'alice long password', name: 'Alice' } });
await Bc.req('POST', '/auth/register', { json: { email: `bob${stamp}@test.dev`, password: 'bobs long password', name: 'Bob' } });
let r = await admin.req('POST', '/auth/login', { json: { email: 'admin@test.dev', password: 'adminpassword123' } });
ok('admin login', r.status === 200 && r.json.data.user.role === 'ADMIN');
const aliceId = (await A.req('GET', '/me')).json.data.user.id, bobId = (await Bc.req('GET', '/me')).json.data.user.id;

// ================= API keys =================
r = await anon.req('POST', '/keys', { json: { name: 'x' } }); ok('anonymous cannot create keys -> 401', r.status === 401);
r = await A.req('POST', '/keys', { json: { name: '' } }); ok('empty key name -> 400', r.status === 400);
r = await A.req('POST', '/keys', { json: { name: 'CI server' } });
const secret = r.json.data.secret, keyA = r.json.data.key;
ok('create key -> 201, secret shown once, nx_live_ prefix', r.status === 201 && secret.startsWith('nx_live_') && secret.length >= 40 && !('keyHash' in keyA) && !JSON.stringify(keyA).includes(secret));
r = await A.req('GET', '/keys');
ok('list never reveals the secret or hash', r.status === 200 && r.json.data.keys.length === 1 && !JSON.stringify(r.json).includes(secret) && !/keyHash/.test(JSON.stringify(r.json)) && r.json.data.keys[0].prefix === secret.slice(0, 12));
const sha = createHash('sha256').update(secret).digest('hex');
ok('DB stores only the SHA-256 of the key, never the raw key', psql(`select count(*) from "ApiKey" where "keyHash"='${sha}'`) === '1' && psql(`select count(*) from "ApiKey" where "keyHash"='${secret}' or "keyPrefix"='${secret}'`) === '0');
ok('creating a key is audit-logged', psql(`select count(*) from "AuditLog" where action='apikey.created' and "targetId"='${keyA.id}'`) === '1');

r = await anon.req('GET', '/v1/tools'); ok('v1 without key -> 401', r.status === 401 && r.json.error.code === 'UNAUTHORIZED');
r = await anon.req('GET', '/v1/tools', withKey('nx_live_totallywrongkey1234567890abcdef')); ok('v1 wrong key -> 401', r.status === 401);
r = await A.req('GET', '/v1/tools'); ok('v1 ignores browser cookies (session alone -> 401)', r.status === 401);
r = await anon.req('GET', '/v1/tools', withKey(secret));
ok('v1 tools: public subset (has pdf-to-jpg, hides split-pdf)', r.status === 200 && r.json.data.tools.some((t) => t.id === 'pdf-to-jpg') && !r.json.data.tools.some((t) => t.id === 'split-pdf'), r.json.data?.tools?.map((t) => t.id).join());

r = await anon.req('POST', '/v1/jobs', { form: upload('merge-pdf', [['x.pdf', pdfX], ['y.pdf', pdfY]]), ...withKey(secret) });
ok('v1 create merge job -> 201 QUEUED', r.status === 201 && r.json.data.job.status === 'QUEUED', JSON.stringify(r.json));
const v1Job = r.json.data.job.id;
let job; for (let i = 0; i < 60; i++) { job = (await anon.req('GET', `/v1/jobs/${v1Job}`, withKey(secret))).json.data.job; if (['COMPLETED', 'FAILED'].includes(job.status)) break; await sleep(300); }
ok('v1 job is processed by the real worker -> COMPLETED', job.status === 'COMPLETED', JSON.stringify(job));
const out = job.files.find((f) => f.type === 'OUTPUT');
r = await anon.req('GET', `/v1/files/${out.id}/download`, withKey(secret));
ok('v1 download returns the merged PDF (X-p1, X-p2, Y-p1)', r.status === 200 && pdfText(r.buf, 1) === 'X-p1' && pdfText(r.buf, 3) === 'Y-p1');
r = await anon.req('POST', '/v1/jobs', { form: upload('extract-pdf-pages', [['x.pdf', pdfX]], { pages: '2' }), headers: { 'x-api-key': secret } });
ok('X-API-Key header also works', r.status === 201);
r = await anon.req('POST', '/v1/jobs', { form: upload('split-pdf', [['x.pdf', pdfX]]), ...withKey(secret) });
ok('non-public tool via v1 -> 403', r.status === 403 && r.json.error.code === 'FORBIDDEN', JSON.stringify(r.json));
r = await anon.req('POST', '/v1/jobs', { form: upload('merge-pdf', [['x.pdf', Buffer.from('not a pdf at all')], ['y.pdf', pdfY]]), ...withKey(secret) });
ok('v1 validation still enforced (fake PDF -> 415)', r.status === 415);
ok('job row records which key created it', psql(`select "apiKeyId" from "Job" where id='${v1Job}'`) === keyA.id);
ok('usage events recorded for the key (api.request + job.created)', Number(psql(`select count(*) from "UsageEvent" where "apiKeyId"='${keyA.id}' and kind='api.request'`)) >= 5 && psql(`select count(*) from "UsageEvent" where "apiKeyId"='${keyA.id}' and kind='job.created'`) === '2');
ok('lastUsedAt updated', psql(`select "lastUsedAt" is not null from "ApiKey" where id='${keyA.id}'`) === 't');
r = await A.req('GET', '/keys'); ok('key list shows request count', r.json.data.keys[0].requests >= 5 && r.json.data.keys[0].lastUsedAt, JSON.stringify(r.json.data.keys[0]));

// cross-user isolation
r = await Bc.req('POST', '/keys', { json: { name: 'bob key' } }); const bobSecret = r.json.data.secret;
r = await anon.req('GET', `/v1/jobs/${v1Job}`, withKey(bobSecret)); ok("Bob's key can't see Alice's job (404)", r.status === 404);
r = await anon.req('GET', `/v1/files/${out.id}/download`, withKey(bobSecret)); ok("Bob's key can't download Alice's file (404)", r.status === 404);
r = await Bc.req('DELETE', `/keys/${keyA.id}`); ok("Bob can't revoke Alice's key (404)", r.status === 404);
r = await anon.req('GET', '/v1/tools', withKey(secret)); ok("...and Alice's key still works", r.status === 200);

// key cap
let created = 1; for (let i = 0; i < 12; i++) { const x = await A.req('POST', '/keys', { json: { name: `k${i}` } }); if (x.status === 201) created++; else { ok('11th active key refused with a clear message (cap = 10)', x.status === 403 && /at most 10/.test(x.json.error.message) && created === 10, `created=${created} ${JSON.stringify(x.json)}`); break; } }

// revoke
r = await A.req('DELETE', `/keys/${keyA.id}`); ok('revoke key -> 200', r.status === 200);
r = await anon.req('GET', '/v1/tools', withKey(secret)); ok('revoked key stops working immediately (401)', r.status === 401);
r = await A.req('DELETE', `/keys/${keyA.id}`); ok('revoking twice -> 404', r.status === 404);
r = await A.req('GET', '/keys'); ok('revoked key listed with revokedAt', r.json.data.keys.find((k) => k.id === keyA.id)?.revokedAt);

// ================= Admin =================
const adminPaths = ['/admin/stats', '/admin/users', `/admin/users/${aliceId}`, '/admin/jobs', '/admin/system', '/admin/audit'];
for (const p of adminPaths) { const a = await anon.req('GET', p); const u = await A.req('GET', p); ok(`${p}: anonymous 401, regular user 403`, a.status === 401 && u.status === 403, `${a.status}/${u.status}`); }
r = await A.req('PATCH', `/admin/users/${bobId}`, { json: { disabled: true } }); ok('regular user cannot disable accounts (403)', r.status === 403);

r = await admin.req('GET', '/admin/stats'); const st = r.json.data;
const dbn = (q) => Number(psql(q));
ok('stats: user & job totals match the database', st.users.total === dbn('select count(*) from "User"') && st.jobs.total === dbn('select count(*) from "Job"') && st.jobs.byStatus.COMPLETED === dbn(`select count(*) from "Job" where status='COMPLETED'`), JSON.stringify(st));
ok('stats: storage bytes match DB sum', st.storage.bytesInUse === dbn(`select coalesce(sum(size),0) from "File" where "deletedAt" is null`));
ok('stats: active API keys count matches', st.activeApiKeys === dbn(`select count(*) from "ApiKey" where "revokedAt" is null`));

r = await admin.req('GET', `/admin/users?search=ALICE${stamp}`); ok('user search is case-insensitive', r.json.data.total === 1 && r.json.data.users[0].id === aliceId);
ok('user list shows job count + storage, no secrets', r.json.data.users[0].jobCount === 2 && typeof r.json.data.users[0].storageBytes === 'number' && !/passwordHash|scrypt|tokenVersion/.test(JSON.stringify(r.json)));
r = await admin.req('GET', '/admin/users?pageSize=2&page=1'); ok('user pagination', r.json.data.users.length <= 2 && r.json.data.total >= 3);
r = await admin.req('GET', `/admin/users/${aliceId}`);
ok('user detail: usage, key prefixes only, recent jobs', r.status === 200 && r.json.data.usage.jobsByStatus.COMPLETED >= 1 && r.json.data.apiKeys.length >= 1 && r.json.data.recentJobs.length >= 1 && !/nx_live_[A-Za-z0-9_-]{20,}|keyHash|passwordHash/.test(JSON.stringify(r.json)));
r = await admin.req('GET', '/admin/users/not-a-uuid'); ok('invalid user id -> 400', r.status === 400);

// jobs filters
await Bc.req('POST', '/jobs', { form: upload('merge-pdf', [['x.pdf', pdfX], ['bad.pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('junk junk junk junk')])]]) });
await sleep(3500);
r = await admin.req('GET', '/admin/jobs?status=FAILED'); ok('jobs filter by status', r.json.data.jobs.length >= 1 && r.json.data.jobs.every((j) => j.status === 'FAILED'));
ok('failed job exposes error info + owner email', r.json.data.jobs[0].errorMessage && r.json.data.jobs[0].user.email.startsWith('bob'), JSON.stringify(r.json.data.jobs[0]));
r = await admin.req('GET', '/admin/jobs?tool=extract-pdf-pages'); ok('jobs filter by tool', r.json.data.jobs.length >= 1 && r.json.data.jobs.every((j) => j.tool === 'extract-pdf-pages'));
r = await admin.req('GET', `/admin/jobs?q=alice${stamp}`); ok('jobs search by user email', r.json.data.total >= 2 && r.json.data.jobs.every((j) => j.user.email.includes('alice')));
r = await admin.req('GET', `/admin/jobs?q=${v1Job}`); ok('jobs search by job id; flagged as API-key job', r.json.data.total === 1 && r.json.data.jobs[0].viaApiKey === true);
r = await admin.req('GET', `/admin/jobs?userId=${bobId}&status=COMPLETED`); ok('combined filters (user + status)', r.status === 200 && r.json.data.jobs.every((j) => j.user.id === bobId && j.status === 'COMPLETED'));
r = await admin.req('GET', `/admin/jobs?from=${new Date(Date.now() + 86400000).toISOString()}`); ok('date filter excludes everything in the future', r.json.data.total === 0);
r = await admin.req('GET', '/admin/jobs?status=BOGUS'); ok('invalid filter value -> 400', r.status === 400);

// system
r = await admin.req('GET', '/admin/system'); const sys = r.json.data; const sysText = JSON.stringify(r.json);
ok('system: database + redis healthy with latency', sys.database.ok && sys.redis.ok && typeof sys.database.latencyMs === 'number' && sys.redis.usedMemory, JSON.stringify([sys.database, sys.redis]));
ok('system: queue counts for pdf and image', ['waiting', 'active', 'failed'].every((k) => k in sys.queues.pdf) && 'waiting' in sys.queues.image, JSON.stringify(sys.queues));
ok('system: live worker seen via heartbeat', sys.workers.count >= 1 && sys.workers.items[0].kinds.includes('pdf') && sys.workers.items[0].lastSeenMsAgo < 30000, JSON.stringify(sys.workers));
ok('system: storage usage + disk space', sys.storage.ok && sys.storage.disk.totalBytes > 0 && sys.storage.disk.freeBytes > 0);
ok('system: no secrets or connection strings leaked', !/nexora:nexora|dev-only-secret|adminpassword123|JWT_SECRET|DATABASE_URL|REDIS_URL/.test(sysText));

// disable / enable
r = await admin.req('PATCH', `/admin/users/${bobId}`, { json: { disabled: true } }); ok('admin disables Bob', r.status === 200 && r.json.data.user.disabled === true);
r = await Bc.req('GET', '/me'); ok("Bob's live session dies immediately", r.status === 401);
r = await anon.req('GET', '/v1/tools', withKey(bobSecret)); ok("Bob's API key stops working while disabled", r.status === 401);
r = await new Client().req('POST', '/auth/login', { json: { email: `bob${stamp}@test.dev`, password: 'bobs long password' } }); ok('disabled Bob cannot log in (403)', r.status === 403 && r.json.error.code === 'ACCOUNT_DISABLED');
r = await admin.req('GET', '/admin/users?status=disabled'); ok('users filter: disabled', r.json.data.users.some((u) => u.id === bobId) && r.json.data.users.every((u) => u.disabled));
r = await admin.req('PATCH', `/admin/users/${bobId}`, { json: { disabled: false } }); ok('admin re-enables Bob', r.status === 200 && r.json.data.user.disabled === false);
r = await anon.req('GET', '/v1/tools', withKey(bobSecret)); ok("Bob's API key works again after re-enable", r.status === 200);
const adminId = (await admin.req('GET', '/me')).json.data.user.id;
r = await admin.req('PATCH', `/admin/users/${adminId}`, { json: { disabled: true } }); ok('admin cannot disable themselves (403)', r.status === 403);
r = await admin.req('GET', '/admin/audit'); const acts = r.json.data.events.map((e) => e.action);
ok('audit log records disable/enable/key events with actor', ['user.disabled', 'user.enabled', 'apikey.created', 'apikey.revoked'].every((a) => acts.includes(a)) && r.json.data.events.find((e) => e.action === 'user.disabled').actor === 'admin@test.dev', acts.join());

// usage
r = await A.req('GET', '/me/usage'); const u = r.json.data;
ok('me/usage: counts match database', u.totalJobs === dbn(`select count(*) from "Job" where "userId"='${aliceId}'`) && u.totalConversions === dbn(`select count(*) from "Job" where "userId"='${aliceId}' and status in ('COMPLETED','EXPIRED')`) && u.storage.bytesInUse === dbn(`select coalesce(sum(f.size),0) from "File" f join "Job" j on j.id=f."jobId" where j."userId"='${aliceId}' and f."deletedAt" is null`), JSON.stringify(u));
ok('me/usage: top tools + active key count (10 created, 1 revoked = 9)', u.topTools[0].count >= 1 && u.activeApiKeys === 9, JSON.stringify([u.topTools, u.activeApiKeys]));
r = await anon.req('GET', '/me/usage'); ok('me/usage requires login', r.status === 401);

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
