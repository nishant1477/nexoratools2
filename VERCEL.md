# Deploying NexoraTools: web on Vercel, backend in Docker

Vercel can only run the Next.js app. The API, worker, Postgres, Redis and file storage need long-running
processes, Ghostscript/poppler and a persistent disk (and Vercel Functions cap request bodies at 4.5 MB), so they
run from `docker-compose.backend.yml` on any server with Docker.

## 1. Backend (server with Docker, ports 80/443 open, DNS record e.g. api.example.com -> server)
```bash
ENV_TEMPLATE=.env.backend.example sh scripts/init-env.sh you@example.com
# edit .env: API_DOMAIN=api.example.com, WEB_ORIGIN=https://<your-vercel-domain>
docker compose -f docker-compose.backend.yml up -d --build
curl https://api.example.com/api/health
```
Runs postgres, redis, migrate, api, worker and Caddy (automatic HTTPS, proxies only `/api/*`).
`WEB_ORIGIN` must equal the exact origin users open; the API rejects other Origins.

## 2. Vercel
1. Import the repo; set **Root Directory** to `apps/web` (keep "Include source files outside of the Root Directory" on).
2. Add env var `API_INTERNAL_URL=https://api.example.com`. The build fails if it is missing.
3. Deploy. `/api/*` is rewritten to the backend, so the browser stays same-origin (cookies and Origin check work).

## Caveats
- Do not add a root `vercel.json` with `services`: the API is not suited to Vercel Functions.
- Preview URLs differ from `WEB_ORIGIN`, so login/uploads are blocked there.
- Caddy trusts `X-Forwarded-For` from any source (Vercel IPs are not a fixed range) so rate limits see real client IPs;
  someone hitting the API domain directly could spoof it.
- Untested: 20-50 MB uploads through the Vercel rewrite, the Host header Vercel sends to Caddy, and the Docker build itself.
