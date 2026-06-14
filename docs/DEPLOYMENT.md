# Deployment Guide

Life Capital OS deploys as **three Vercel projects** (API, web, admin) backed by a
**Supabase PostgreSQL** database. All three live in this monorepo and are deployed
by setting each project's **Root Directory** in Vercel.

| Vercel project | Root Directory | URL (example) |
|----------------|----------------|---------------|
| `lcos-api`     | `apps/api`     | `https://lcos-api.vercel.app` |
| `lcos-web`     | `apps/web`     | `https://lcos-web.vercel.app` |
| `lcos-admin`   | `apps/admin`   | `https://lcos-admin.vercel.app` |

## 1. Database (Supabase) — ALREADY PROVISIONED

A Supabase project **`life-capital-os`** (project ref **`tnpvdggerstntcranwvc`**,
region `ap-south-1`) backs the app. The schema is **already migrated and seeded**
(17 tables, 3 plans, 5 feature flags, a SUPERADMIN + demo user, demo balance sheet),
and **RLS is enabled (deny-all)** so the public PostgREST API is locked down — the
app reaches Postgres only via Prisma's database role.

Connection strings (Supabase → Project Settings → Database; `<PASSWORD>` is the DB
password set at project creation, or reset it there):

```bash
# Pooled (PgBouncer, 6543) — runtime DATABASE_URL for serverless
DATABASE_URL="postgresql://postgres.tnpvdggerstntcranwvc:<PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
# Direct (5432) — DIRECT_URL for `prisma migrate deploy`
DIRECT_URL="postgresql://postgres.tnpvdggerstntcranwvc:<PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
```

> Re-running migrations is only needed for future schema changes:
> `cd apps/api && pnpm exec prisma migrate deploy`

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
| `CORS_ORIGINS` | `https://lcos-web.vercel.app` |
| `NODE_ENV` | `production` |
| `RAZORPAY_*`, `AA_*` | sandbox defaults until live keys are added |

> Prisma generates the `rhel-openssl-3.0.x` engine for Lambda (see `schema.prisma`).

## 3. Web project (`apps/web`)

Next.js app — also hosts the admin panel at `/admin` for admin roles. Needs one
variable pointing at the deployed API:

```bash
NEXT_PUBLIC_API_URL="https://lcos-api.vercel.app/api"
```

## 4. Order of operations

1. Provision Supabase, set `DATABASE_URL` / `DIRECT_URL`, run `migrate deploy` + seed.
2. Deploy **API**, set its env vars, note its URL.
3. Set `NEXT_PUBLIC_API_URL` on **web**, deploy it.
4. Set `CORS_ORIGINS` on the API to the web URL; redeploy API.

## 5. Production checklist

- Rotate all secrets (don't reuse the dev seed admin password — change
  `SEED_ADMIN_PASSWORD` or reset it after first login).
- Add real Razorpay + Account Aggregator keys, set `RAZORPAY_SANDBOX=false`.
- Enable Supabase backups; restrict DB access.
- Consider a dedicated long-running host (Railway/Render/Fly) for the API if
  serverless cold-starts/connection-pooling become a constraint.
