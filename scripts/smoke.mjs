#!/usr/bin/env node
// Post-deploy smoke test against a running stack (no dependencies, Node >= 20):
//   node scripts/smoke.mjs [baseUrl]        default: PUBLIC_URL or http://localhost:8080
// Registers a throw-away user, converts a generated image to PDF through the real queue + worker, downloads and
// verifies the result. Exits non-zero on any failure. Leaves one test user behind (see README to remove).
const base = (process.argv[2] ?? process.env.PUBLIC_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const origin = new URL(base).origin;
let cookie = '';
const step = (m) => console.log(`- ${m}`);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

async function api(method, path, body) {
  const headers = { origin };
  if (cookie) headers.cookie = cookie;
  if (body && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}/api${path}`, { method, headers, body: body instanceof FormData ? body : body && JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return res;
}

// 8x8 JPEG
const jpeg = Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJAAnHX/2Q==', 'base64');

step(`health ${base}/api/health`);
const h = await (await fetch(`${base}/api/health`)).json().catch(() => null);
if (!h?.ok || !h.data.database || !h.data.redis) fail(`unhealthy: ${JSON.stringify(h)}`);

step('register throw-away user');
const email = `smoke-${Date.now()}@example.com`;
let r = await api('POST', '/auth/register', { email, password: `smoke-${Date.now()}-pw`, name: 'Smoke Test' });
if (r.status !== 201) fail(`register -> ${r.status} ${await r.text()}`);

step('upload image, create jpg-to-pdf job');
const fd = new FormData();
fd.append('tool', 'jpg-to-pdf');
fd.append('options', '{}');
fd.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'smoke.jpg');
r = await api('POST', '/jobs', fd);
const created = await r.json();
if (r.status !== 201) fail(`create job -> ${r.status} ${JSON.stringify(created)}`);
const id = created.data.job.id;

step('wait for the worker');
let job;
for (let i = 0; i < 60; i++) {
  job = (await (await api('GET', `/jobs/${id}`)).json()).data.job;
  if (['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(job.status)) break;
  await new Promise((res) => setTimeout(res, 1000));
}
if (job.status !== 'COMPLETED') fail(`job ended as ${job.status}: ${job.errorMessage ?? 'still running after 60 s - is the worker up?'}`);

step('download and verify output');
const out = job.files.find((f) => f.type === 'OUTPUT');
if (!out) fail('completed job has no output file');
r = await api('GET', `/files/${out.id}/download`);
const bytes = Buffer.from(await r.arrayBuffer());
if (r.status !== 200 || bytes.subarray(0, 5).toString() !== '%PDF-') fail(`download -> ${r.status}, not a PDF`);

step('anonymous access to the file is refused');
const anon = await fetch(`${base}/api/files/${out.id}/download`);
if (anon.status !== 401 && anon.status !== 404) fail(`anonymous download returned ${anon.status}`);

await api('POST', '/auth/logout');
console.log(`OK - ${base} is serving, queueing and processing jobs.`);
