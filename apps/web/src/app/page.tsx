import { HealthCheck } from '@/components/HealthCheck';

export default function HomePage() {
  return (
    <main>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-xl font-bold text-brand">Life Capital OS</span>
          <nav className="flex gap-4 text-sm">
            <a href="/login" className="text-slate-600 hover:text-brand">
              Log in
            </a>
            <a href="/login" className="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark">
              Get started
            </a>
          </nav>
        </div>
      </header>

      <section className="bg-gradient-to-b from-white to-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-16 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Know Your Financial Health in 5 Minutes
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
            Get a personalized wealth report covering investments, insurance, retirement and asset
            allocation — India&apos;s AI-powered Wealth Health &amp; Family CFO platform.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <HealthCheck />
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-slate-500">
          © {new Date().getFullYear()} Life Capital OS — Wealth · Health · Security · Purpose · Legacy
        </div>
      </footer>
    </main>
  );
}
