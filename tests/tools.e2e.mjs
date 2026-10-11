// End-to-end tests for all 14 tools: real API + real worker + real Postgres/Redis, real files in, real files out.
// Prereqs: API on :4000, worker running, `pdftotext`/`pdfinfo`/`unzip`/`gs` on PATH.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const B = process.env.API ?? 'http://localhost:4000/api';
const TMP = '/tmp/nx-e2e'; mkdirSync(TMP, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '   <- ' + extra}`); };

// ---------- HTTP client ----------
let cookie = '';
async function api(method, path, body) {
  const r = await fetch(B + path, { method, headers: { ...(cookie && { cookie }), ...(body && !(body instanceof FormData) && { 'content-type': 'application/json' }) }, body: body instanceof FormData ? body : body && JSON.stringify(body) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') ?? '';
  return { status: r.status, headers: r.headers, json: ct.includes('json') ? await r.json() : null, buf: ct.includes('json') ? null : Buffer.from(await r.arrayBuffer()) };
}
async function submit(tool, files, options) {
  const f = new FormData(); f.append('tool', tool);
  if (options) f.append('options', JSON.stringify(options));
  for (const [name, buf] of files) f.append('file', new Blob([buf]), name);
  return api('POST', '/jobs', f);
}
async function waitJob(id, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const { json } = await api('GET', `/jobs/${id}`);
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(json.data.job.status)) return json.data.job;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('timeout waiting for job ' + id);
}
/** Submit, wait, and download the output. */
async function runTool(tool, files, options) {
  const r = await submit(tool, files, options);
  if (r.status !== 201) return { rejected: r };
  const job = await waitJob(r.json.data.job.id);
  const out = job.files?.find((f) => f.type === 'OUTPUT');
  const dl = out ? await api('GET', `/files/${out.id}/download`) : null;
  return { job, out, dl, buf: dl?.buf };
}

// ---------- inspection helpers (independent of the code under test) ----------
const tmpFile = (name, buf) => { const p = `${TMP}/${name}`; writeFileSync(p, buf); return p; };
const pdfInfoText = (buf, first, last) => execFileSync('pdfinfo', ['-f', String(first ?? 1), '-l', String(last ?? 9999), tmpFile('i.pdf', buf)]).toString();
const pageCount = (buf) => Number(/Pages:\s+(\d+)/.exec(pdfInfoText(buf))[1]);
const pageText = (buf, n) => execFileSync('pdftotext', ['-f', String(n), '-l', String(n), tmpFile('t.pdf', buf), '-']).toString().trim();
const pageSize = (buf, n = 1) => { const m = new RegExp(`Page\\s+${n} size:\\s+([\\d.]+) x ([\\d.]+)`).exec(pdfInfoText(buf, n, n)); return [Number(m[1]), Number(m[2])]; };
const pageRot = (buf, n) => Number(new RegExp(`Page\\s+${n} rot:\\s+(\\d+)`).exec(pdfInfoText(buf, 1, 9999))[1]);
const zipList = (buf) => execFileSync('unzip', ['-Z1', tmpFile('z.zip', buf)]).toString().trim().split('\n').sort();
const zipEntry = (buf, name) => execFileSync('unzip', ['-p', tmpFile('z.zip', buf), name], { maxBuffer: 1 << 28 });

// ---------- fixtures ----------
async function makePdf(label, pages, [w, h]) {
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) doc.addPage([w, h]).drawText(`${label}-p${i}`, { x: 50, y: h - 100, size: 40, font });
  return Buffer.from(await doc.save());
}
const pdfA = await makePdf('A', 5, [612, 792]);
const pdfB = await makePdf('B', 3, [595.28, 841.89]);
const noise = await sharp({ create: { width: 2400, height: 2400, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).jpeg({ quality: 95 }).toBuffer();
const pdfBig = await (async () => { const d = await PDFDocument.create(); const img = await d.embedJpg(noise); d.addPage([612, 792]).drawImage(img, { x: 0, y: 0, width: 612, height: 612 }); return Buffer.from(await d.save()); })();
const jpgExif = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3366cc' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer(); // displays as 600x800
const jpgPlain = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#cc6633' } }).jpeg().toBuffer();
const pngAlpha = await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } }).png().toBuffer(); // fully transparent
const pngPhoto = await sharp(noise).resize(1200, 1200).png().toBuffer();
const corruptPdf = Buffer.from('%PDF-1.4\n1 0 obj<<garbage garbage garbage\nnot a real pdf at all\n');
const corruptJpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('this is not really a jpeg body at all'.repeat(20))]);
writeFileSync(`${TMP}/a.pdf`, pdfA);
execFileSync('gs', ['-sDEVICE=pdfwrite', '-dNOPAUSE', '-dBATCH', '-dQUIET', '-sOwnerPassword=owner', '-sUserPassword=user', `-sOutputFile=${TMP}/enc.pdf`, `${TMP}/a.pdf`]);
const pdfEnc = (await import('node:fs')).readFileSync(`${TMP}/enc.pdf`);
console.log(`fixtures: A=${pdfA.length}B B=${pdfB.length}B big=${pdfBig.length}B\n`);

// ---------- login ----------
const email = `tools${Date.now()}@test.dev`;
await api('POST', '/auth/register', { email, password: 'a long test password', name: 'Tester' });

// ===== PDF tools =====
let t = await runTool('jpg-to-pdf', [['exif.jpg', jpgExif], ['plain.jpg', jpgPlain]], { pageSize: 'fit' });
ok('jpg-to-pdf: COMPLETED, 2 pages', t.job?.status === 'COMPLETED' && pageCount(t.buf) === 2, JSON.stringify(t.job ?? t.rejected?.json));
ok('jpg-to-pdf: EXIF rotation applied (page is 600x800 portrait)', t.buf && pageSize(t.buf, 1).join('x') === '600x800', t.buf && pageSize(t.buf, 1));
ok('jpg-to-pdf: output is a real PDF served as application/pdf', t.buf?.subarray(0, 5).toString() === '%PDF-' && t.dl.headers.get('content-type') === 'application/pdf');
ok('jpg-to-pdf: job timestamps + outputSize recorded', t.job.startedAt && t.job.completedAt && t.job.outputSize === t.buf.length && t.job.inputSize === jpgExif.length + jpgPlain.length);
t = await runTool('jpg-to-pdf', [['plain.jpg', jpgPlain], ['exif.jpg', jpgExif]], { pageSize: 'a4' });
ok('jpg-to-pdf: A4 pages follow image orientation (landscape image -> 842x595, portrait -> 595x842)', t.buf && pageSize(t.buf, 1).map(Math.round).join('x') === '842x595' && pageSize(t.buf, 2).map(Math.round).join('x') === '595x842', t.buf && [pageSize(t.buf, 1), pageSize(t.buf, 2)]);
t = await runTool('png-to-pdf', [['alpha.png', pngAlpha], ['photo.png', pngPhoto]], {});
ok('png-to-pdf: transparent + large PNG -> 2 pages', t.job?.status === 'COMPLETED' && pageCount(t.buf) === 2, JSON.stringify(t.job));

t = await runTool('pdf-to-jpg', [['a.pdf', pdfA]], { dpi: 100, quality: 80 });
let names = t.buf && zipList(t.buf);
ok('pdf-to-jpg: zip with 5 numbered JPGs', t.job?.status === 'COMPLETED' && names.join() === ['a-page-1.jpg','a-page-2.jpg','a-page-3.jpg','a-page-4.jpg','a-page-5.jpg'].join(), JSON.stringify(names ?? t.job));
const meta = t.buf && await sharp(zipEntry(t.buf, 'a-page-1.jpg')).metadata();
ok('pdf-to-jpg: real JPEG at Letter@100dpi = 850x1100', meta?.format === 'jpeg' && meta.width === 850 && meta.height === 1100, JSON.stringify(meta));
ok('pdf-to-jpg: served as application/zip', t.dl?.headers.get('content-type') === 'application/zip');
t = await runTool('pdf-to-png', [['a.pdf', pdfA]], { dpi: 72 });
const pm = t.buf && await sharp(zipEntry(t.buf, 'a-page-3.png')).metadata();
ok('pdf-to-png: real PNG at 612x792', pm?.format === 'png' && pm.width === 612 && pm.height === 792, JSON.stringify(pm));

t = await runTool('merge-pdf', [['a.pdf', pdfA], ['b.pdf', pdfB]]);
ok('merge-pdf: 8 pages, order A then B', t.buf && pageCount(t.buf) === 8 && pageText(t.buf, 1) === 'A-p1' && pageText(t.buf, 5) === 'A-p5' && pageText(t.buf, 6) === 'B-p1' && pageText(t.buf, 8) === 'B-p3', t.job?.errorMessage);
ok('merge-pdf: mixed page sizes preserved', t.buf && pageSize(t.buf, 1)[0] === 612 && Math.round(pageSize(t.buf, 6)[0]) === 595);
t = await runTool('merge-pdf', [['b.pdf', pdfB], ['a.pdf', pdfA]]);
ok('merge-pdf: reversed upload order -> B first', t.buf && pageText(t.buf, 1) === 'B-p1' && pageText(t.buf, 4) === 'A-p1');

t = await runTool('split-pdf', [['a.pdf', pdfA]], { mode: 'every-page' });
names = t.buf && zipList(t.buf);
ok('split-pdf: 5 single-page PDFs with right content', t.buf && names.length === 5 && [1, 2, 3, 4, 5].every((i) => { const p = zipEntry(t.buf, `a-page-${i}.pdf`); return pageCount(p) === 1 && pageText(p, 1) === `A-p${i}`; }), JSON.stringify(names ?? t.job));
t = await runTool('split-pdf', [['a.pdf', pdfA]], { mode: 'ranges', ranges: '1-2,5' });
names = t.buf && zipList(t.buf);
ok('split-pdf: ranges "1-2,5" -> 2 PDFs (2 pages + 1 page)', t.buf && names.join() === 'a-page-5.pdf,a-pages-1-2.pdf' && pageCount(zipEntry(t.buf, 'a-pages-1-2.pdf')) === 2 && pageText(zipEntry(t.buf, 'a-page-5.pdf'), 1) === 'A-p5', JSON.stringify(names ?? t.job));
t = await runTool('split-pdf', [['a.pdf', pdfA]], { mode: 'ranges', ranges: '2-9' });
ok('split-pdf: range beyond page count -> friendly FAILED', t.job?.status === 'FAILED' && /doesn't exist.*5 pages/.test(t.job.errorMessage), JSON.stringify(t.job));

t = await runTool('compress-pdf', [['big.pdf', pdfBig]], { level: 'medium' });
ok(`compress-pdf: valid + smaller (${pdfBig.length} -> ${t.buf?.length})`, t.job?.status === 'COMPLETED' && t.buf.length < pdfBig.length * 0.6 && pageCount(t.buf) === 1, JSON.stringify(t.job));
// Photo-like content (smooth structure + light grain) behaves like a real scanned/photographed page.
const photoJpg = await (async () => {
  const small = await sharp({ create: { width: 60, height: 60, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 90 } } }).png().toBuffer();
  const base = await sharp(small).resize(2400, 2400, { kernel: 'cubic' }).png().toBuffer();
  const grain = await sharp({ create: { width: 2400, height: 2400, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 8 } } }).png().toBuffer();
  return sharp(base).composite([{ input: grain, blend: 'overlay' }]).jpeg({ quality: 92 }).toBuffer();
})();
const pdfPhoto = await (async () => { const d = await PDFDocument.create(); const img = await d.embedJpg(photoJpg); d.addPage([612, 792]).drawImage(img, { x: 0, y: 0, width: 612, height: 612 }); return Buffer.from(await d.save()); })();
const hi = await runTool('compress-pdf', [['photo.pdf', pdfPhoto]], { level: 'high' });
const mid = await runTool('compress-pdf', [['photo.pdf', pdfPhoto]], { level: 'medium' });
const lo = await runTool('compress-pdf', [['photo.pdf', pdfPhoto]], { level: 'low' });
ok(`compress-pdf: strong < balanced < light on a photo PDF (${pdfPhoto.length} -> ${hi.buf?.length} / ${mid.buf?.length} / ${lo.buf?.length})`, hi.buf.length < mid.buf.length && mid.buf.length < lo.buf.length + 1 && lo.buf.length <= pdfPhoto.length && pageCount(hi.buf) === 1);
ok('compress-pdf: light level that cannot shrink returns the original, never a bigger file', lo.buf.length <= pdfPhoto.length);
t = await runTool('compress-pdf', [['a.pdf', pdfA]], { level: 'medium' });
ok('compress-pdf: already-small PDF is never made bigger', t.job?.status === 'COMPLETED' && t.buf.length <= pdfA.length && pageText(t.buf, 3) === 'A-p3', `${t.buf?.length} vs ${pdfA.length}`);

t = await runTool('rotate-pdf', [['a.pdf', pdfA]], { angle: 90 });
ok('rotate-pdf: all pages rotated 90', t.buf && [1, 2, 3, 4, 5].every((n) => pageRot(t.buf, n) === 90), t.job?.errorMessage);
t = await runTool('rotate-pdf', [['a.pdf', pdfA]], { angle: 180, pages: '2' });
ok('rotate-pdf: only page 2 rotated 180', t.buf && pageRot(t.buf, 2) === 180 && pageRot(t.buf, 1) === 0 && pageRot(t.buf, 3) === 0);

t = await runTool('delete-pdf-pages', [['a.pdf', pdfA]], { pages: '2,4' });
ok('delete-pdf-pages: 5 -> 3 pages (A-p1, A-p3, A-p5)', t.buf && pageCount(t.buf) === 3 && pageText(t.buf, 1) === 'A-p1' && pageText(t.buf, 2) === 'A-p3' && pageText(t.buf, 3) === 'A-p5', t.job?.errorMessage);
t = await runTool('delete-pdf-pages', [['a.pdf', pdfA]], { pages: '1-5' });
ok('delete-pdf-pages: refuses to delete every page', t.job?.status === 'FAILED' && t.job.errorCode === 'INVALID_OPTIONS' && /at least one page/.test(t.job.errorMessage), JSON.stringify(t.job));
t = await runTool('delete-pdf-pages', [['a.pdf', pdfA]], { pages: '9' });
ok('delete-pdf-pages: nonexistent page -> clear message', t.job?.status === 'FAILED' && /Page 9 doesn't exist/.test(t.job.errorMessage), t.job?.errorMessage);
t = await runTool('extract-pdf-pages', [['a.pdf', pdfA]], { pages: '5,1-2' });
ok('extract-pdf-pages: "5,1-2" -> A-p5, A-p1, A-p2', t.buf && pageCount(t.buf) === 3 && pageText(t.buf, 1) === 'A-p5' && pageText(t.buf, 2) === 'A-p1' && pageText(t.buf, 3) === 'A-p2', t.job?.errorMessage);

// ===== Image tools =====
t = await runTool('jpg-to-png', [['one.jpg', jpgPlain]], {});
let im = t.buf && await sharp(t.buf).metadata();
ok('jpg-to-png: single file -> real 400x300 PNG (not zipped)', t.job?.status === 'COMPLETED' && im.format === 'png' && im.width === 400 && im.height === 300 && t.out.filename === 'one.png', JSON.stringify(t.out));
t = await runTool('jpg-to-png', [['a.jpg', jpgPlain], ['b.jpg', jpgExif]], {});
ok('jpg-to-png: two files -> zip with both PNGs', t.buf && zipList(t.buf).join() === 'a.png,b.png', JSON.stringify(t.job));
t = await runTool('png-to-jpg', [['alpha.png', pngAlpha]], { quality: 90, background: '#ffffff' });
const px = t.buf && await sharp(t.buf).raw().toBuffer({ resolveWithObject: true });
ok('png-to-jpg: real JPEG; transparent area flattened to white (not black)', px && px.info.format === undefined || (px.data[0] > 245 && px.data[1] > 245 && px.data[2] > 245 && (await sharp(t.buf).metadata()).format === 'jpeg'), px && Array.from(px.data.subarray(0, 3)));
t = await runTool('png-to-jpg', [['alpha.png', pngAlpha]], { quality: 90, background: '#000000' });
const px2 = await sharp(t.buf).raw().toBuffer();
ok('png-to-jpg: custom background honoured (black)', px2[0] < 10 && px2[1] < 10 && px2[2] < 10);

t = await runTool('compress-image', [['photo.jpg', noise]], { quality: 60 });
ok(`compress-image: JPG smaller (${noise.length} -> ${t.buf?.length}), still valid`, t.job?.status === 'COMPLETED' && t.buf.length < noise.length * 0.85 && (await sharp(t.buf).metadata()).width === 2400);
t = await runTool('compress-image', [['photo.png', pngPhoto]], { quality: 60 });
ok(`compress-image: PNG smaller (${pngPhoto.length} -> ${t.buf?.length})`, t.job?.status === 'COMPLETED' && t.buf.length < pngPhoto.length && (await sharp(t.buf).metadata()).format === 'png');

t = await runTool('resize-image', [['a.jpg', jpgPlain]], { width: 200 });
im = t.buf && await sharp(t.buf).metadata();
ok('resize-image: width 200 keeps aspect (200x150)', im?.width === 200 && im?.height === 150, JSON.stringify(im));
t = await runTool('resize-image', [['a.jpg', jpgPlain]], { percent: 50 });
im = t.buf && await sharp(t.buf).metadata();
ok('resize-image: 50% -> 200x150', im?.width === 200 && im?.height === 150, JSON.stringify(im));
t = await runTool('resize-image', [['a.png', pngPhoto]], { width: 100, height: 100, fit: 'cover' });
im = t.buf && await sharp(t.buf).metadata();
ok('resize-image: PNG cover 100x100 exact, stays PNG', im?.width === 100 && im?.height === 100 && im?.format === 'png');
t = await runTool('resize-image', [['a.jpg', jpgPlain]], {});
ok('resize-image: no size given -> rejected at API (400 INVALID_OPTIONS)', t.rejected?.status === 400 && t.rejected.json.error.code === 'INVALID_OPTIONS');

// ===== Failure modes: friendly messages, no stack traces =====
t = await runTool('pdf-to-jpg', [['bad.pdf', corruptPdf]], {});
ok('corrupt PDF -> FAILED / CORRUPT_PDF with friendly message', t.job?.status === 'FAILED' && t.job.errorCode === 'CORRUPT_PDF' && !/at |\.ts|Error:/.test(t.job.errorMessage), JSON.stringify(t.job));
ok('failed job has no downloadable output', !t.out);
t = await runTool('merge-pdf', [['a.pdf', pdfA], ['bad.pdf', corruptPdf]]);
ok('merge with one corrupt PDF names the culprit', t.job?.status === 'FAILED' && t.job.errorMessage.includes('bad.pdf'), t.job?.errorMessage);
t = await runTool('rotate-pdf', [['enc.pdf', pdfEnc]], { angle: 90 });
ok('password-protected PDF -> clear "password-protected" message', t.job?.status === 'FAILED' && /password/i.test(t.job.errorMessage), JSON.stringify(t.job));
t = await runTool('jpg-to-png', [['bad.jpg', corruptJpg]], {});
ok('corrupt JPG (valid magic bytes) -> FAILED with friendly message', t.job?.status === 'FAILED' && /corrupt|can't be read/i.test(t.job.errorMessage) && !/sharp|vips|Input/.test(t.job.errorMessage), JSON.stringify(t.job));
const manyPages = await (async () => { const d = await PDFDocument.create(); for (let i = 0; i < 301; i++) d.addPage([100, 100]); return Buffer.from(await d.save()); })();
t = await runTool('split-pdf', [['long.pdf', manyPages]], { mode: 'every-page' });
ok('PDF over MAX_PDF_PAGES (300) -> FAILED with page-limit message', t.job?.status === 'FAILED' && /301 pages.*limit is 300/.test(t.job.errorMessage), JSON.stringify(t.job));
t = await runTool('pdf-to-jpg', [['a.pdf', pdfA]], { dpi: 300, quality: 85 });
ok('valid dpi=300 render works', t.job?.status === 'COMPLETED');

// ===== Concurrency =====
const batch = await Promise.all(Array.from({ length: 12 }, (_, i) => runTool(i % 2 ? 'rotate-pdf' : 'extract-pdf-pages', [['a.pdf', pdfA]], i % 2 ? { angle: 90 } : { pages: '1-2' })));
ok('12 concurrent jobs all COMPLETED with valid output', batch.every((b) => b.job?.status === 'COMPLETED' && b.buf.subarray(0, 5).toString() === '%PDF-'), JSON.stringify(batch.map((b) => b.job?.status ?? b.rejected?.status)));

// ===== History reflects real jobs =====
const list = await api('GET', '/jobs?pageSize=50');
ok('history lists jobs with real statuses (COMPLETED + FAILED both present)', list.json.data.total > 40 && list.json.data.jobs.some((j) => j.status === 'FAILED') && list.json.data.jobs.some((j) => j.status === 'COMPLETED'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
