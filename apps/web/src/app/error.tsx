'use client';

/** Route-level error boundary — replaces a white-screen with a friendly recovery UI. */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-slate-600">
        An unexpected error occurred. You can try again, or head back to your dashboard.
      </p>
      <div className="mt-6 flex gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
        >
          Try again
        </button>
        <a href="/dashboard" className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:border-brand">
          Go to dashboard
        </a>
      </div>
    </main>
  );
}
