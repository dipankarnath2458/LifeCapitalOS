'use client';

/** Catches errors in the root layout itself (must render its own <html>/<body>). */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="bg-slate-50">
        <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="mt-2 text-slate-600">The app hit an unexpected error. Please try again.</p>
          <button
            onClick={reset}
            className="mt-6 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
