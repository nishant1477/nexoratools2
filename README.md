# NexoraTools

**Simple tools for your files.** NexoraTools is a self-hosted PDF and image utility platform: upload files, a background worker processes them, you download the result. It has user accounts, job history, an admin dashboard, API keys with a public REST API, automatic cleanup of temporary files, and a one-command Docker Compose deployment.

It is an original product (own name, UI and code) built around a familiar idea; it does not reuse anyone else's branding, assets or source.

- [Implemented tools](#implemented-tools)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Quick start with Docker](#quick-start-with-docker)
- [Local development (without Docker for the app)](#local-development)
- [Environment variables](#environment-variables)
- [Database & migrations](#database--migrations)
- [Workers & storage](#worker-configuration)
- [Production deployment](#production-deployment)
- [Public API](#public-api-keys)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)
- [Adding a new tool](#adding-a-new-tool)
- [Verification status & known limitations](#verification-status--known-limitations)

## Implemented tools

All 14 tools do real processing through the same queue and worker pipeline.

| Category | Tool | Engine | Options |
|---|---|---|---|
| PDF | JPG → PDF, PNG → PDF | pdf-lib + sharp | page size (fit / A4 / Letter), several images → one PDF |
| PDF | PDF → JPG, PDF → PNG | poppler `pdftoppm` | DPI, JPG quality; multi-page → ZIP |
| PDF | Merge PDF | pdf-lib | upload order = page order (reorder in UI) |
| PDF | Split PDF | pdf-lib | every page, or ranges (`1-3,4-6` → one PDF per range); ZIP output |
| PDF | Compress PDF | Ghostscript | low / medium / high presets |
| PDF | Rotate PDF | pdf-lib | 90 / 180 / 270, all pages or a range |
| PDF | Delete pages, Extract pages | pdf-lib | page ranges |
| Image | JPG → PNG, PNG → JPG | sharp | JPG quality, flatten background colour |
| Image | Image compressor | sharp | quality |
| Image | Image resizer | sharp | width / height, or scale by percent |

Also: accounts, history, dashboard with real usage numbers, admin area (overview, users, jobs, audit log, system status), API keys, per-key rate limiting, light/dark theme, mobile navigation. Roadmap tools (OCR, Word/Excel conversions, watermarks, …) are **not** implemented; the architecture is prepared for them (see [Adding a new tool](#adding-a-new-tool)).

## Architecture

```
Browser ──► Nginx ──┬──► web   (Next.js, standalone)        UI only
                    └──► api   (Fastify)  ──► PostgreSQL     users, jobs, files, keys, audit, usage
                              │          └──► Redis/BullMQ   queues  nexora-pdf, nexora-image
                              ▼
                      shared STORAGE_DIR  ◄──── worker(s)     pdf-lib · sharp · Ghostscript · poppler
```

Flow of a job: multipart upload → API validates (size, extension **and** magic bytes, page count/readability) → input stored under a random name → `Job` row (QUEUED) → BullMQ → worker atomically claims it (PROCESSING), re-validates options, runs the tool, writes outputs (zipped if several) → COMPLETED / FAILED → user downloads through an authorised endpoint → cleanup deletes expired files.

Job states: `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`, `EXPIRED`, `CANCELLED`. Cancelling a processing job aborts the underlying process.

```
nexora-tools/
├── apps/
│   ├── api/                 Fastify API (routes/, plugins/, lib/)
│   └── web/                 Next.js app (src/app pages, src/components, src/lib)
├── workers/worker/          BullMQ consumers, generic runner, cleanup, tools/ (processors)
├── packages/
│   ├── shared/              tool registry (metadata + zod options), error codes, API types
│   ├── config/              env schema (zod), Storage (safe path handling)
│   └── database/            Prisma schema, migrations, client factory
├── docker/                  Dockerfile.{api,worker,web}, nginx.conf.template
├── docker-compose.yml       production-style stack   (docker-compose.dev.yml: expose DB/Redis for dev)
├── scripts/                 init-env.sh, run-tests.sh, smoke.mjs
├── tests/                   end-to-end suites
├── storage/                 default local storage dir (git-ignored)
└── .env.example
```

One worker package serves both queues (`WORKER_KINDS=pdf,image`); you can run separate containers per kind to scale or isolate them (e.g. `WORKER_KINDS=pdf` on a locked-down host).

## Requirements

- **Docker path:** Docker Engine 24+ with the Compose plugin v2.
- **Local dev path:** Node.js ≥ 20 (22 recommended), PostgreSQL 14+, Redis 6+, Ghostscript (`gs`), poppler-utils (`pdftoppm`, `pdfinfo`). On Debian/Ubuntu: `sudo apt install ghostscript poppler-utils`.

## Quick start with Docker

```bash
git clone <your repo> nexora-tools && cd nexora-tools

# 1. Create .env with generated secrets (optionally bootstrap an admin: pass an email)
sh scripts/init-env.sh you@example.com        # prints the generated admin password once

# 2. Build and start everything
docker compose up -d --build

# 3. Watch it come up (migrate exits 0, others become healthy)
docker compose ps
docker compose logs -f api worker

# 4. Open http://localhost:8080  (PUBLIC_URL / HTTP_PORT in .env)
node scripts/smoke.mjs http://localhost:8080   # optional end-to-end check (leaves one throw-away smoke-test user; remove it in Admin → Users by disabling it, or via psql)
```

Services: `postgres`, `redis`, `migrate` (one-shot `prisma migrate deploy`), `api`, `worker`, `web`, `nginx` (the only published port). `api` and `worker` share the `storage` volume. Health checks exist for postgres, redis, api, web, worker (liveness file) and nginx.

Everyday commands:

```bash
docker compose down                 # stop (data kept in volumes)
docker compose down -v              # stop AND delete database, queue and stored files
docker compose up -d --build api worker web   # redeploy after code changes
docker compose up -d --scale worker=3         # more workers
docker compose logs -f worker
docker compose exec api node -e "console.log(process.env.FILE_RETENTION_MINUTES)"
```

## Local development

```bash
sh scripts/init-env.sh                                  # .env with secrets
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis   # DB + Redis on localhost only
npm ci
npm run db:generate                                     # generate Prisma client
npm run db:deploy                                       # apply migrations (db:migrate for new ones in dev)
npm run build:packages                                  # shared/config/database must be built once (and after edits)
npm run dev:api        # http://localhost:4000
npm run dev:worker
npm run dev:web        # http://localhost:3000   (proxies /api to :4000)
```

Other commands: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run start:api`, `npm run start:worker`, `npm run cleanup:once` (run a cleanup pass now).

> Prisma note: the client runs in Prisma 6's engine-less mode (`engineType = "client"` with `@prisma/adapter-pg`, a preview feature in v6). `prisma migrate` still downloads the schema engine from `binaries.prisma.sh` the first time; hosts that block that domain cannot run migrations.

## Environment variables

`.env.example` is the reference (every variable is commented). Required: `JWT_SECRET` (≥ 32 chars) and `POSTGRES_PASSWORD`; `scripts/init-env.sh` generates both.

| Variable | Default | Purpose |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:8080` | Browser-facing URL; becomes the API's allowed `Origin` (CSRF check) |
| `HTTP_PORT` | `8080` | Host port nginx listens on |
| `NGINX_MAX_BODY_MB` | `500` | Max total request body at nginx |
| `POSTGRES_USER/DB/PASSWORD` | `nexora` / `nexora` / – | Database credentials (Compose builds `DATABASE_URL` from them) |
| `DATABASE_URL`, `REDIS_URL` | localhost | Only for running outside Compose |
| `JWT_SECRET` | – | Session signing key. Rotating it logs everyone out |
| `COOKIE_SECURE` | `false` | **Set `true` when serving HTTPS** |
| `TRUST_PROXY` | `false` (Compose: `true`) | Trust `X-Forwarded-*` from nginx (real client IPs for rate limits) |
| `SESSION_COOKIE_NAME`, `SESSION_TTL_HOURS` | `nexora_session`, `168` | Session cookie |
| `STORAGE_DIR` | `./storage` (Compose: `/data/storage`) | **Must be the same directory for API and workers** |
| `FILE_RETENTION_MINUTES` | `60` | Lifetime of inputs/outputs (`expiresAt`) |
| `CLEANUP_ENABLED`, `CLEANUP_INTERVAL_MINUTES` | `true`, `5` | Cleanup scheduler inside workers |
| `JOB_HISTORY_DAYS` | `30` | History rows are purged this long after files expire |
| `MAX_UPLOAD_MB` | `50` | Per-file limit |
| `MAX_FILES_PER_JOB`, `MAX_ACTIVE_JOBS_PER_USER` | `50`, `10` | Job limits |
| `UPLOAD_RATE_LIMIT` / `_WINDOW_SECONDS` | `30` / `60` | Uploads per window (per user/IP; per key for the public API) |
| `API_RATE_LIMIT` / `_WINDOW_SECONDS` | `300` / `60` | General API requests per window |
| `AUTH_RATE_LIMIT` / `_WINDOW_SECONDS` | `10` / `60` | Login/register attempts per window |
| `API_KEYS_PER_USER` | `10` | Active keys per user |
| `WORKER_KINDS` | `pdf,image` | Queues a worker process serves |
| `WORKER_CONCURRENCY` | `2` | Parallel jobs per worker process |
| `JOB_TIMEOUT_SECONDS` | `300` | Hard timeout per job (process is killed) |
| `MAX_PDF_PAGES` | `300` | Reject larger PDFs |
| `GHOSTSCRIPT_BIN`, `PDFTOPPM_BIN` | `gs`, `pdftoppm` | Binary names/paths |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | empty | Bootstrap an admin on API start if the email doesn't exist |
| `LOG_LEVEL` | `info` | pino level |

Secrets are never hard-coded; Compose refuses to start if `JWT_SECRET` or `POSTGRES_PASSWORD` is missing. The admin UI shows system health, never secrets.

## Database & migrations

Schema: `packages/database/prisma/schema.prisma` (User, Job, File, ApiKey, UsageEvent, AuditLog). Migrations live in `packages/database/prisma/migrations/`.

```bash
npm run db:deploy      # apply pending migrations (what Compose's `migrate` service does)
npm run db:migrate     # dev: create + apply a new migration after editing schema.prisma
npm run db:generate    # regenerate the client
docker compose run --rm migrate          # re-run migrations in Docker
docker compose exec postgres psql -U nexora -d nexora
```

Not implemented yet but prepared by the schema/permissions layout: subscriptions, teams, notifications (`User.plan` and `UsageEvent` exist as hooks).

## Worker configuration

- Each worker process runs `WORKER_CONCURRENCY` jobs at once; scale with `--scale worker=N` or by running containers with different `WORKER_KINDS`.
- Jobs are claimed atomically (QUEUED → PROCESSING), options are re-validated in the worker, each job has `JOB_TIMEOUT_SECONDS`, and a cancel request stops the running process within ~1.5 s.
- A worker that dies mid-job leaves the row PROCESSING; the cleanup pass marks such stuck jobs FAILED (`WORKER_FAILURE`) and collects their files.
- Workers publish a heartbeat to Redis (shown in Admin → System) and touch a liveness file (used by the container health check).

### Storage configuration

Files live under `STORAGE_DIR` as `inputs/<uuid>.<ext>` and `outputs/<uuid>.<ext>` with random names; the original filename is stored only as sanitised metadata. `tmp/<jobId>` is per-job scratch space removed after processing. **The API and every worker must mount the same directory** (a Docker volume, or a shared/NFS path across machines). Keep it outside any web root; nothing in it is served statically — downloads go through `GET /api/files/:id/download` with an ownership check.

## Production deployment

1. Provision a VPS with Docker; point a DNS name at it.
2. `sh scripts/init-env.sh admin@yourdomain.com`, then edit `.env`: `PUBLIC_URL=https://tools.yourdomain.com`, `COOKIE_SECURE=true`, tune limits/retention.
3. **TLS.** Either terminate TLS in a load balancer / Caddy / Traefik in front of the `nginx` service (forward to its port; keep `PUBLIC_URL` as the https address), or add a `listen 443 ssl` server block with your certificates to `docker/nginx.conf.template` and mount them into the nginx service. Add `Strict-Transport-Security` once HTTPS works.
4. `docker compose up -d --build`, then `node scripts/smoke.mjs https://tools.yourdomain.com`.
5. Back up the `pgdata` volume (`pg_dump`). Redis and `storage` hold only transient data.
6. Don't publish Postgres/Redis ports; only nginx is exposed by `docker-compose.yml`.
7. Upgrading: `git pull && docker compose up -d --build` — `migrate` runs before `api`/`worker` restart.

Scaling: add workers (`--scale worker=N`); for multiple hosts put `storage` on shared storage and point everything at one Postgres/Redis (the API holds no per-process state besides in-flight uploads).

## Public API (API keys)

Create keys in the UI (**API keys**) — the secret (`nx_live_…`) is shown once; only a SHA-256 hash is stored. Revoke at any time; last-used time and usage are tracked. Rate limits apply per key.

```bash
curl -H "Authorization: Bearer nx_live_…" https://host/api/v1/tools
curl -H "Authorization: Bearer nx_live_…" -F tool=compress-image -F 'options={"quality":70}' -F file=@photo.jpg https://host/api/v1/jobs
curl -H "Authorization: Bearer nx_live_…" https://host/api/v1/jobs/<id>
curl -H "Authorization: Bearer nx_live_…" -o out.jpg https://host/api/v1/files/<fileId>/download
```

The in-app **Developers** page documents the endpoints and lists the tools exposed through the API (`publicApi: true` in the registry).

Internal (cookie-session) endpoints: `POST /api/auth/{register,login,logout}`, `GET /api/me`, `POST /api/me/password`, `GET /api/me/usage`, `GET /api/tools`, `POST/GET /api/jobs`, `GET /api/jobs/:id`, `POST /api/jobs/:id/cancel`, `GET /api/files/:id/download`, `GET/POST/DELETE /api/keys`, and admin: `GET /api/admin/{stats,users,users/:id,jobs,system,audit}`, `PATCH /api/admin/users/:id`. All responses use `{ ok: true, data }` / `{ ok: false, error: { code, message } }`.

## Testing

```bash
npm ci && npm run build
scripts/run-tests.sh --reset-db        # all suites; starts/stops API, worker and web itself
scripts/run-tests.sh api tools         # selected suites: api tools lifecycle keys-admin cleanup key-ratelimit ui
npm run typecheck && npm run lint
node scripts/smoke.mjs http://localhost:8080   # against a running stack
```

`run-tests.sh` needs Postgres + Redis running, `psql`, `redis-cli`, Ghostscript and poppler. **It is destructive**: the suites assume `postgresql://nexora:nexora@localhost:5432/nexora` and `STORAGE_DIR=/tmp/nx-storage`, and `--reset-db` drops that database's schema. Use a throw-away database. The `ui` suite drives headless Chromium (bundled via `@sparticuz/chromium`) and runs accessibility checks with axe.

Suites: `api` (auth, authorization, validation, uploads, errors, rate limit), `tools` (all 14 tools with real output checks, concurrency), `lifecycle` (cancel while processing / queued), `keys-admin` (API keys, usage, admin), `cleanup` (expiry, active-job protection, stuck jobs, orphans, locking), `key-ratelimit`, `ui` (browser flows, responsive layout, accessibility).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `docker compose` says `POSTGRES_PASSWORD missing` | Run `sh scripts/init-env.sh` (or fill `.env`) |
| API exits: `JWT_SECRET` too short | Needs ≥ 32 chars |
| Login works but you're "signed out" / POSTs get 403 | `PUBLIC_URL` must exactly equal the URL in the browser; with HTTPS set `COOKIE_SECURE=true` |
| Jobs stay QUEUED | Worker not running/healthy (`docker compose logs worker`; Admin → System shows workers & queue depth) or Redis down |
| Job fails: input file not found | API and worker don't share `STORAGE_DIR` |
| Compress/convert PDF fails | `gs`/`pdftoppm` missing (non-Docker runs); check `GHOSTSCRIPT_BIN`/`PDFTOPPM_BIN` |
| "This PDF seems to be corrupt" | File is damaged, encrypted, or has data after `%%EOF` (rejected deliberately) |
| `413` from nginx on big uploads | Raise `NGINX_MAX_BODY_MB` (and `MAX_UPLOAD_MB` for per-file) |
| `429 RATE_LIMITED` | Raise `*_RATE_LIMIT` or wait out the window |
| Migrations can't download engine | Host blocks `binaries.prisma.sh`; allow it for the `migrate` build/run |
| Port 8080 in use | Change `HTTP_PORT` |
| Disk filling up | Lower `FILE_RETENTION_MINUTES`; check cleanup in Admin → System |

## Security notes

- **Uploads are untrusted.** Extension *and* magic-byte sniffing must agree; size, file-count and page-count limits; PDFs must parse; random storage names; uploaded files are never executed; storage is outside the app/web directories.
- **Paths:** storage keys must match a strict pattern and resolve inside `STORAGE_DIR` (traversal-safe); original filenames are sanitised metadata only.
- **Downloads** require a session or API key and ownership (or admin); expired files return `410`.
- **Auth:** scrypt password hashing, signed httpOnly SameSite=Lax session cookie with server-side revocation (`tokenVersion`, bumped on password change/disable), CSRF defence via Origin check on state-changing cookie requests, login rate limiting, constant-shape errors. Admin routes have a separate role check. API keys are stored hashed.
- **Rate limits** (Redis-backed) on auth, uploads and API; per key for `/api/v1`.
- **Headers:** helmet on the API, nosniff / frame-deny / referrer-policy on web and nginx.
- **Run Ghostscript/poppler in a contained environment.** PDF renderers have a long vulnerability history. The compose file runs the worker as a non-root user with all Linux capabilities dropped and `no-new-privileges`; for public deployments additionally consider a dedicated host/VM or gVisor/Firecracker for workers, a read-only root filesystem, and a network policy that blocks outbound access from the worker. Keep images updated.
- Set `COOKIE_SECURE=true` over HTTPS, keep `.env` out of git (it is git-ignored), and rotate `JWT_SECRET`/DB password if exposed.

## Adding a new tool

Adding a tool never touches upload, queue, job or download code. Example: a hypothetical `grayscale-image`.

1. **Metadata + validation** — add an entry to `TOOLS` in `packages/shared/src/tools.ts`:
   ```ts
   {
     id: 'grayscale-image', name: 'Grayscale', description: 'Turn images black and white.',
     category: 'image', icon: 'Image', worker: 'image', accepts: ['jpg', 'png'],
     minFiles: 1, maxFiles: 20, output: 'same', publicApi: true,
     options: z.object({ contrast: z.coerce.number().min(0.5).max(2).default(1) }),
     optionFields: [{ key: 'contrast', label: 'Contrast', type: 'number', min: 0.5, max: 2 }],
   }
   ```
   `accepts` (file kinds), `minFiles/maxFiles`, `orderMatters`, `output`, `worker` (queue) and the zod `options` schema drive API validation *and* the generated options form on the tool page.
2. **Processor** — in `workers/worker/src/tools/image.ts` (or `pdf.ts`, or a new file):
   ```ts
   export const grayscaleImage = defineProcessor('grayscale-image', async (ctx) =>
     Promise.all(ctx.inputs.map(async (f) => {
       const out = path.join(ctx.workDir, `${randomUUID()}.${f.kind === 'png' ? 'png' : 'jpg'}`);
       await sharp(f.path).grayscale().linear(ctx.options.contrast).toFile(out);
       return { path: out, filename: f.filename, mimeType: f.kind === 'png' ? 'image/png' : 'image/jpeg' };
     })));
   ```
   `ctx.options` is typed from the zod schema, `ctx.signal` aborts on timeout/cancel (pass it to spawned processes via `lib/exec.ts`). Multiple outputs are zipped automatically.
3. **Register** it in the `all` array in `workers/worker/src/tools/index.ts`.
4. **Icon (optional)** — `icon` is a lucide name; add it to the map in `apps/web/src/components/ToolIcon.tsx` if it isn't there yet.
5. `npm run typecheck`, rebuild, restart the worker and API. The tool appears on the home page, in search, on `/tools/<id>`, in history, in admin filters and (if `publicApi`) in `/api/v1`.

For a new *file type* (e.g. DOCX, HEIC) add it to `FILE_KINDS` and the content sniffer in `apps/api/src/lib/sniff.ts`. For a new queue (e.g. `ocr` with Tesseract), add it to `QUEUE_NAMES`/`WorkerKind` in `packages/shared/src/api.ts` and run a worker with `WORKER_KINDS=ocr` in an image that has the needed binaries.

## Verification status & known limitations

What was actually run (Linux sandbox, Node 22, PostgreSQL 16, Redis 7, Ghostscript, poppler, headless Chromium): install, typecheck (0 errors), lint (0 problems), migration applied to a real database, production build, all end-to-end suites (api 72, tools 45, lifecycle 15, keys-admin 70, cleanup 20, key-ratelimit 3, ui 83 checks), a pruned production-style install (`npm ci --omit=dev`) of API and worker started and processing jobs, the Next.js standalone server, and nginx (rendered from `docker/nginx.conf.template`) proxying all of it, including a 45 MB upload and a clean rejection of 60 MB, plus `scripts/smoke.mjs` through nginx.

**Not verified — be aware:**

- **The Docker images and `docker compose up` were never run.** The sandbox has no Docker daemon. The Dockerfiles pass `hadolint`, `docker compose config` validates, and each Dockerfile's steps were reproduced by hand (production install, Prisma client generation, copying build output, health-check commands), but a real `docker compose build/up` may still surface problems (e.g. an apt package name, a file permission, `prisma migrate deploy` fetching its engine inside the image). Treat the first run as a test and report/fix what appears.
- Only headless Chromium was tested for the UI; no Firefox/Safari, no real phones (responsive layout is checked with emulated viewports).
- The `JOB_TIMEOUT_SECONDS` kill path is implemented but has no dedicated test (cancel-while-processing, which uses the same abort mechanism, is tested).
- Tested on a single machine; multi-host scaling over shared storage is designed for but untested.
- PDFs with junk after the end-of-file marker, encrypted PDFs and password-protected PDFs are rejected as unreadable instead of being repaired/decrypted.
- Prisma's engine-less client is a **preview feature in Prisma 6**; plan to move to Prisma 7 where it is stable. `prisma migrate` needs network access to `binaries.prisma.sh`.
- Ghostscript/poppler process untrusted PDFs: see the isolation advice above. No antivirus scanning is included.
- No email flows (password reset, verification), no billing/plans enforcement, teams or notifications yet. The `plan` field and usage events exist only as groundwork.
- TLS is not configured out of the box (documented above); nginx serves plain HTTP on the published port.
- Roadmap tools (OCR, Office conversions, watermarks, page numbers, protect/unlock/sign, HTML/TXT/CSV → PDF, WebP/HEIC, background removal, batch, teams, paid plans) are not implemented.
