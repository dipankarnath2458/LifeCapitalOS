# Security & Compliance

## Data protection
- **In transit:** TLS everywhere (terminate at the edge/load balancer).
- **At rest:** AES-256-GCM field-level encryption for PII (names, family members,
  TOTP secrets) via `CryptoService`. Key from `FIELD_ENCRYPTION_KEY` (32-byte hex),
  managed by a KMS/secret manager in production.
- **Passwords:** Argon2id hashing. **OTP & refresh tokens:** stored only as SHA-256
  hashes; refresh tokens rotate on every use.

## Access control
- Stateless JWT access tokens (short TTL) + rotating refresh tokens.
- Global auth guard (deny-by-default) + role-based `RolesGuard`.
- Roles: USER, ADVISOR, SUPPORT, ANALYST, ADMIN, SUPERADMIN. Destructive admin
  actions (role change, erasure) restricted to SUPERADMIN.

## Application hardening
- Helmet security headers, configurable CORS allowlist.
- Global input validation + whitelisting (`ValidationPipe`).
- Rate limiting via `@nestjs/throttler`.
- Append-only `AuditLog` for every admin mutation (actor, action, entity, IP).

## India / global compliance
- **DPDP Act 2023:** explicit `Consent` records per purpose; data **export** and
  **erasure** endpoints; purpose limitation; PII minimization in logs.
- **RBI Account Aggregator:** financial-data linking gated behind AA consent; the
  provider is abstracted and runs in sandbox by default.
- **GDPR-grade baseline** keeps the platform global-ready.

## Secrets & ops
- All secrets via environment / secret manager; none committed (`.env` is ignored).
- Dependency scanning + build/lint/test gates in CI before deploy.
- Production checklist: rotate `JWT_*` and `FIELD_ENCRYPTION_KEY`, change seeded
  admin credentials, enable backups, set real Razorpay/AA keys.
