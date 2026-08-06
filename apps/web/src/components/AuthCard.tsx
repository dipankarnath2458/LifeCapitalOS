/**
 * The centred card used by the signed-out auth pages (login, forgot/reset password,
 * verify email). Matches the existing /login styling so the flow looks like one product.
 */
export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow">
        <h1 className="mb-6 text-2xl font-bold text-brand">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export const inputClass = 'mb-4 w-full rounded-lg border border-slate-200 px-3 py-2';
export const buttonClass =
  'w-full rounded-xl bg-brand px-4 py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-60';
export const labelClass = 'mb-1 block text-sm text-slate-600';
