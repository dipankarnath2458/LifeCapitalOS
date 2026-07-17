import { redirect } from 'next/navigation';

/**
 * Legacy V1 dashboard route — RETIRED as a destination by the V2 Activation (M5.5).
 *
 * The authenticated experience is now the V2 app shell at `/app` (the Module 4
 * Dashboard). This route is kept as a permanent server-side redirect so every
 * remaining inbound link (`/billing` back-link, error boundary, admin fallback,
 * `AdminShell`, `lib/admin` 403 handling) transparently lands in V2 without editing
 * each call site. The V1 retail dashboard component and its widgets remain in the repo
 * (now unreferenced) and can be removed in a dedicated cleanup once V2 is confirmed.
 *
 * Rollback: restore this file from git history to bring the V1 dashboard back, and
 * revert the `/app` redirects in `login`/`onboarding`.
 */
export default function LegacyDashboardRedirect() {
  redirect('/app');
}
