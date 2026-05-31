# Deployment Guide

Life Capital OS deploys as **three Vercel projects** (API, web, admin) backed by a
**Supabase PostgreSQL** database. All three live in this monorepo and are deployed
by setting each project's **Root Directory** in Vercel.

| Vercel project | Root Directory | URL (example) |
|----------------|----------------|---------------|
| `lcos-api`     | `apps/api`     | `https://lcos-api.vercel.app` |
| `lcos-web`     | `apps/web`     | `https://lcos-web.vercel.app` |
| `lcos-admin`   | `apps/admin`   | `https://lcos-admin.vercel.app` |

## 1. Database (Supabase)

A Supabase project (`life-capital-os`, region `ap-south-1`) backs the app. Prisma
needs two connection strings (Supabase → Project Settings → Database):

```bash
# Pooled (PgBouncer, port 6543) — used at runtime by serverless functions
DATABASE_URL="postgresql://postgres.<ref>:<PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
# Direct (port 5432) — used by `prisma migrate deploy`
DIRECT_URL="postgresql://postgres.<ref>:<PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
```

Apply the schema + seed once (from a machine with the connection strings):

```bash
cd apps/api
DATABASE_URL=... DIRECT_URL=... pnpm exec prisma migrate deploy
DATABASE_URL=... pnpm exec ts-node prisma/seed.ts
```

## 2. API project (`apps/api`)

Runs NestJS as a Vercel serverless function via `api/index.ts` (Express adapter +
`serverless-http`). Config in `apps/api/vercel.json`.

**Environment variables (Vercel → Settings → Environment Variables):**

| Var | Notes |
|-----|-------|
| `DATABASE_URL` | Supabase pooled URL (6543) |
| `DIRECT_URL` | Supabase direct URL (5432) |
| `JWT_ACCESS_SECRET` | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 32` |
| `FIELD_ENCRYPTION_KEY` | `openssl rand -hex 32` (32 bytes) |
| `CORS_ORIGINS` | `https://lcos-web.vercel.app,https://lcos-admin.vercel.app` |
| `NODE_ENV` | `production` |
| `RAZORPAY_*`, `AA_*` | sandbox defaults until live keys are added |

> Prisma generates the `rhel-openssl-3.0.x` engine for Lambda (see `schema.prisma`).

## 3. Web & Admin projects (`apps/web`, `apps/admin`)

Next.js apps. Each needs one variable pointing at the deployed API:

```bash
NEXT_PUBLIC_API_URL="https://lcos-api.vercel.app/api"
```

## 4. Order of operations

1. Provision Supabase, set `DATABASE_URL` / `DIRECT_URL`, run `migrate deploy` + seed.
2. Deploy **API**, set its env vars, note its URL.
3. Set `NEXT_PUBLIC_API_URL` on **web** + **admin**, deploy them.
4. Set `CORS_ORIGINS` on the API to the web/admin URLs; redeploy API.

## 5. Production checklist

- Rotate all secrets (don't reuse the dev seed admin password — change
  `SEED_ADMIN_PASSWORD` or reset it after first login).
- Add real Razorpay + Account Aggregator keys, set `RAZORPAY_SANDBOX=false`.
- Enable Supabase backups; restrict DB access.
- Consider a dedicated long-running host (Railway/Render/Fly) for the API if
  serverless cold-starts/connection-pooling become a constraint.
