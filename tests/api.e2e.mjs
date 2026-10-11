import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const B = process.env.API ?? 'http://localhost:4000/api';
const STORE = process.env.STORAGE ?? '/tmp/nx-storage';
const RDB = process.env.REDIS_DB ?? '0';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };

class Client {
  cookie = '';
  async req(method, path, { json, form, headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let body;
    if (json) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
    if (form) body = form;
    const r = await fetch(B + path, { method, headers: h, body, redirect: 'manual' });
    const sc = r.headers.get('set-cookie');
    if (sc) { const c = sc.split(';')[0]; this.cookie = c.endsWith('=') ? '' : c; }
    const ct = r.headers.get('content-type') ?? '';
    return { status: r.status, headers: r.headers, json: ct.includes('json') ? await r.json() : null, buf: ct.includes('json') ? null : Buffer.from(await r.arrayBuffer()) };
  }
}
const upload = (c, tool, files, options) => {
  const f = new FormData();
  f.append('tool', tool);
  if (options !== undefined) f.append('options', JSON.stringify(options));
  for (const [name, buf, type] of files) f.append('file', new Blob([buf], { type: type ?? 'application/octet-stream' }), name);
  return c.req('POST', '/jobs', { form: f });
};
const storageFiles = () => readdirSync(`${STORE}/inputs`).length;
const psql = (q) => execSync(`PGPASSWORD=nexora psql -h localhost -U nexora -d nexora -Atc "${q}"`).toString().trim();

// ---- Tools / health / unauth
const anon = new Client();
let r = await anon.req('GET', '/tools');
ok('GET /tools returns 14 tools', r.json?.data?.tools?.length === 14, JSON.stringify(r.json)?.slice(0, 120));
ok('tools payload has no zod internals/secrets', !JSON.stringify(r.json).includes('_def'));
r = await upload(anon, 'pdf-to-jpg', [['a.pdf', PDF]]);
ok('unauthenticated upload -> 401', r.status === 401 && r.json.error.code === 'UNAUTHORIZED', r.status);
r = await anon.req('GET', '/jobs'); ok('unauthenticated list -> 401', r.status === 401);
r = await anon.req('GET', '/me'); ok('unauthenticated /me -> 401', r.status === 401);

// ---- Auth
const A = new Client(), Bc = new Client();
r = await A.req('POST', '/auth/register', { json: { email: 'a@test.dev', password: 'short', name: 'A' } });
ok('register weak password -> 400', r.status === 400 && r.json.error.code === 'VALIDATION_ERROR', JSON.stringify(r.json));
r = await A.req('POST', '/auth/register', { json: { email: 'not-an-email', password: 'longenoughpw1', name: 'A' } });
ok('register bad email -> 400', r.status === 400);
r = await A.req('POST', '/auth/register', { json: { email: 'A@Test.dev', password: 'correct horse battery', name: 'Alice' } });
ok('register OK -> 201 + session cookie', r.status === 201 && A.cookie.startsWith('nexora_session='), r.status);
ok('register never returns password hash', !JSON.stringify(r.json).includes('passwordHash') && !JSON.stringify(r.json).includes('scrypt'));
const setCookie = r.headers.get('set-cookie');
ok('cookie is HttpOnly + SameSite=Lax', /HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie), setCookie);
r = await new Client().req('POST', '/auth/register', { json: { email: 'a@test.dev', password: 'another long pass', name: 'Dup' } });
ok('duplicate email (case-insensitive) -> 409', r.status === 409 && r.json.error.code === 'EMAIL_TAKEN', r.status);
ok('password stored hashed (scrypt), not plaintext', psql(`select \\"passwordHash\\" from \\"User\\" where email='a@test.dev'`).startsWith('scrypt$') && !psql(`select \\"passwordHash\\" from \\"User\\" where email='a@test.dev'`).includes('correct horse'));
r = await A.req('GET', '/me'); ok('/me returns own profile', r.status === 200 && r.json.data.user.email === 'a@test.dev');
r = await Bc.req('POST', '/auth/register', { json: { email: 'b@test.dev', password: 'bobs long password', name: 'Bob' } });
ok('second user registered', r.status === 201);
const bad = new Client();
r = await bad.req('POST', '/auth/login', { json: { email: 'a@test.dev', password: 'wrong password!' } });
ok('login wrong password -> 401', r.status === 401 && r.json.error.code === 'INVALID_CREDENTIALS');
r = await bad.req('POST', '/auth/login', { json: { email: 'nobody@test.dev', password: 'wrong password!' } });
ok('login unknown email -> same 401 (no enumeration)', r.status === 401 && r.json.error.code === 'INVALID_CREDENTIALS');
r = await bad.req('POST', '/auth/login', { json: { email: 'a@test.dev', password: 'correct horse battery' } });
ok('login OK', r.status === 200 && bad.cookie !== '');
r = await bad.req('POST', '/auth/logout'); ok('logout clears cookie', r.status === 200 && bad.cookie === '');
r = await bad.req('GET', '/me'); ok('after logout /me -> 401', r.status === 401);
const forged = new Client(); forged.cookie = 'nexora_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad';
r = await forged.req('GET', '/me'); ok('forged session token rejected', r.status === 401);

// ---- Uploads: validation
const before = storageFiles();
r = await upload(A, 'pdf-to-jpg', [['doc.pdf', PDF, 'application/pdf']]);
ok('valid PDF upload -> 201 QUEUED', r.status === 201 && r.json.data.job.status === 'QUEUED', JSON.stringify(r.json));
const jobA = r.json?.data?.job;
ok('job has input file with sanitised name + expiry', jobA?.files?.[0]?.filename === 'doc.pdf' && new Date(jobA.expiresAt) > new Date());
const key = psql(`select \\"storageKey\\" from \\"File\\" where \\"jobId\\"='${jobA.id}'`);
ok('storage key is random, filename not used', /^inputs\/[0-9a-f-]{36}\.bin$/.test(key) && existsSync(STORE + '/' + key), key);
ok('job present in Redis/BullMQ queue', execSync(`redis-cli -n ${RDB} keys "bull:nexora-pdf:*"`).toString().includes(jobA.id) || execSync(`redis-cli -n ${RDB} exists bull:nexora-pdf:${jobA.id}`).toString().trim() === '1');
ok('usage event recorded', psql(`select count(*) from \\"UsageEvent\\" where kind='job.created'`) === '1');

const expectErr = async (name, p, status, code) => { const x = await p; ok(name, x.status === status && x.json?.error?.code === code, `${x.status} ${JSON.stringify(x.json)}`); return x; };
await expectErr('PNG bytes disguised as .pdf -> 415', upload(A, 'pdf-to-jpg', [['evil.pdf', PNG]]), 415, 'UNSUPPORTED_FILE');
await expectErr('text file named .pdf -> 415', upload(A, 'pdf-to-jpg', [['x.pdf', Buffer.from('hello world, not a pdf')]]), 415, 'UNSUPPORTED_FILE');
await expectErr('PDF bytes named .exe -> 415', upload(A, 'pdf-to-jpg', [['run.exe', PDF]]), 415, 'UNSUPPORTED_FILE');
await expectErr('JPG sent to PNG-only tool -> 415', upload(A, 'png-to-pdf', [['p.jpg', JPG]]), 415, 'UNSUPPORTED_FILE');
await expectErr('empty file -> 400', upload(A, 'pdf-to-jpg', [['empty.pdf', Buffer.alloc(0)]]), 400, 'EMPTY_UPLOAD');
await expectErr('no files -> 400', upload(A, 'pdf-to-jpg', []), 400, 'EMPTY_UPLOAD');
await expectErr('unknown tool -> 400', upload(A, 'hack-the-planet', [['a.pdf', PDF]]), 400, 'VALIDATION_ERROR');
await expectErr('merge with 1 file -> 400', upload(A, 'merge-pdf', [['a.pdf', PDF]]), 400, 'TOO_FEW_FILES');
await expectErr('2 files to single-file tool -> 400', upload(A, 'pdf-to-jpg', [['a.pdf', PDF], ['b.pdf', PDF]]), 400, 'TOO_MANY_FILES');
await expectErr('rotate angle 45 -> 400', upload(A, 'rotate-pdf', [['a.pdf', PDF]], { angle: 45 }), 400, 'INVALID_OPTIONS');
await expectErr('page range injection "../x" -> 400', upload(A, 'extract-pdf-pages', [['a.pdf', PDF]], { pages: '../x' }), 400, 'INVALID_OPTIONS');
await expectErr('missing required option -> 400', upload(A, 'delete-pdf-pages', [['a.pdf', PDF]], {}), 400, 'INVALID_OPTIONS');
const big = Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024, 1)]);
await expectErr('2 MB file with 1 MB limit -> 413', upload(A, 'pdf-to-jpg', [['big.pdf', big]]), 413, 'FILE_TOO_LARGE');
r = await upload(A, 'merge-pdf', [['../../etc/passwd.pdf', PDF], ['b.pdf', PDF]]);
ok('path-traversal filename accepted but sanitised', r.status === 201 && r.json.data.job.files[0].filename === 'passwd.pdf', JSON.stringify(r.json).slice(0, 200));
ok('merge upload keeps order via position', r.json.data.job.files.map((f) => f.position).join() === '0,1');
const jobMerge = r.json.data.job;
r = await upload(A, 'jpg-to-png', [['ok.jpg', JPG], ['ok2.jpeg', JPG]]);
ok('image tool accepts .jpg and .jpeg', r.status === 201);
r = await upload(A, 'png-to-jpg', [['t.png', PNG]], { quality: 80 });
ok('png-to-jpg with options -> 201', r.status === 201 && r.json.data.job.options.quality === 80);
const expected = before + 1 + 2 + 2 + 1;
ok('failed uploads left no orphan files on disk', storageFiles() === expected, `have ${storageFiles()}, expected ${expected}`);
ok('no Job rows created for rejected uploads', psql(`select count(*) from \\"Job\\"`) === '4', psql(`select count(*) from \\"Job\\"`));

// ---- Authorization between users
r = await A.req('GET', '/jobs'); ok('A lists own jobs (4)', r.json.data.total === 4 && r.json.data.jobs.length === 4);
r = await Bc.req('GET', '/jobs'); ok('B sees none of A\'s jobs', r.json.data.total === 0);
await expectErr('B cannot read A\'s job (404)', Bc.req('GET', `/jobs/${jobA.id}`), 404, 'JOB_NOT_FOUND');
await expectErr('B cannot cancel A\'s job (404)', Bc.req('POST', `/jobs/${jobA.id}/cancel`), 404, 'JOB_NOT_FOUND');
await expectErr('invalid job id -> 400', A.req('GET', '/jobs/not-a-uuid'), 400, 'VALIDATION_ERROR');
r = await A.req('GET', `/jobs/${jobA.id}`); ok('A can read own job', r.status === 200);

// ---- Cancel
r = await A.req('POST', `/jobs/${jobA.id}/cancel`);
ok('A cancels own QUEUED job', r.status === 200 && r.json.data.job.status === 'CANCELLED', JSON.stringify(r.json));
await expectErr('cancelling again -> 409', A.req('POST', `/jobs/${jobA.id}/cancel`), 409, 'JOB_NOT_CANCELLABLE');

// ---- Downloads (simulate a finished worker by inserting an OUTPUT file)
const outKey = 'outputs/11111111-2222-3333-4444-555555555555.pdf';
writeFileSync(STORE + '/' + outKey, PDF);
const fid = '99999999-aaaa-bbbb-cccc-dddddddddddd';
psql(`insert into \\"File\\" (id,\\"jobId\\",filename,\\"storageKey\\",\\"mimeType\\",size,type,\\"expiresAt\\") values ('${fid}','${jobMerge.id}','my \\"report\\" é.pdf','${outKey}','application/pdf',${PDF.length},'OUTPUT', now()+interval '1 hour')`);
r = await A.req('GET', `/files/${fid}/download`);
ok('owner downloads output', r.status === 200 && r.buf.equals(PDF), r.status);
ok('download headers: attachment + nosniff + no-store', /attachment/.test(r.headers.get('content-disposition')) && r.headers.get('x-content-type-options') === 'nosniff' && /no-store/.test(r.headers.get('cache-control')), r.headers.get('content-disposition'));
ok('content-disposition has no raw quote injection', !/filename="[^"]*"[^;]*"/.test(r.headers.get('content-disposition')), r.headers.get('content-disposition'));
await expectErr('other user download -> 404', Bc.req('GET', `/files/${fid}/download`), 404, 'FILE_NOT_FOUND');
await expectErr('anonymous download -> 401', anon.req('GET', `/files/${fid}/download`), 401, 'UNAUTHORIZED');
const inId = psql(`select id from \\"File\\" where \\"jobId\\"='${jobMerge.id}' and type='INPUT' limit 1`);
await expectErr('input files are not downloadable -> 404', A.req('GET', `/files/${inId}/download`), 404, 'FILE_NOT_FOUND');
psql(`update \\"File\\" set \\"expiresAt\\"=now()-interval '1 minute' where id='${fid}'`);
await expectErr('expired file -> 410', A.req('GET', `/files/${fid}/download`), 410, 'FILE_EXPIRED');
psql(`update \\"File\\" set \\"expiresAt\\"=now()+interval '1 hour', \\"storageKey\\"='outputs/../../etc/passwd' where id='${fid}'`);
r = await A.req('GET', `/files/${fid}/download`);
ok('tampered storage key (path traversal) is refused', r.status >= 400 && !r.buf?.toString().includes('root:'), r.status);

// ---- Admin / role checks, CSRF, password change
const admin = new Client();
r = await admin.req('POST', '/auth/login', { json: { email: 'admin@test.dev', password: 'adminpassword123' } });
ok('bootstrap admin can log in with ADMIN role', r.status === 200 && r.json.data.user.role === 'ADMIN', JSON.stringify(r.json));
r = await admin.req('GET', `/jobs/${jobMerge.id}`); ok('admin can view any job', r.status === 200);
r = await A.req('POST', '/jobs/' + jobA.id + '/cancel', { headers: { origin: 'https://evil.example' } });
ok('cross-origin state-changing request -> 403', r.status === 403, r.status);
r = await A.req('POST', '/me/password', { json: { currentPassword: 'nope nope nope', newPassword: 'brand new password 1' } });
ok('password change with wrong current -> 401', r.status === 401);
const oldSession = A.cookie;
r = await A.req('POST', '/me/password', { json: { currentPassword: 'correct horse battery', newPassword: 'brand new password 1' } });
ok('password change OK', r.status === 200);
const stale = new Client(); stale.cookie = oldSession;
r = await stale.req('GET', '/me'); ok('old session invalidated after password change', r.status === 401);
r = await A.req('GET', '/me'); ok('current session re-issued and valid', r.status === 200);
r = await new Client().req('POST', '/auth/login', { json: { email: 'a@test.dev', password: 'brand new password 1' } });
ok('login with new password', r.status === 200);
psql(`update \\"User\\" set \\"disabledAt\\"=now() where email='b@test.dev'`);
r = await Bc.req('GET', '/me'); ok('disabling an account kills its live session', r.status === 401);
r = await new Client().req('POST', '/auth/login', { json: { email: 'b@test.dev', password: 'bobs long password' } });
ok('disabled account cannot log in', r.status === 403 && r.json.error.code === 'ACCOUNT_DISABLED');

// ---- Rate limiting (auth limit is 15/min in this run)
let limited = 0, first = -1;
for (let i = 0; i < 25; i++) { const x = await new Client().req('POST', '/auth/login', { json: { email: 'flood@test.dev', password: 'whatever whatever' } }); if (x.status === 429) { limited++; if (first < 0) first = i; } }
ok('login flood gets rate limited (429)', limited > 0, `limited=${limited}`);
r = await new Client().req('POST', '/auth/login', { json: { email: 'flood@test.dev', password: 'x' } });
ok('429 uses standard error envelope', r.status === 429 && r.json?.error?.code === 'RATE_LIMITED', JSON.stringify(r.json));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
