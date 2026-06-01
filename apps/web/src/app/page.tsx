import { ToolsSection } from '@/components/ToolsSection';

const FEATURES = [
  {
    title: 'Family Balance Sheet',
    body: 'See your real net worth — every asset and liability in one live view, with solvency and financial-independence ratios.',
    icon: '📊',
  },
  {
    title: 'Wealth Scores',
    body: 'Emergency fund, protection, investments, retirement and debt — each scored, with a single Life Capital Score and traffic-light alerts.',
    icon: '🎯',
  },
  {
    title: 'Goal & Retirement Planning',
    body: 'Know exactly how much to invest each month for retirement, a home, or your child’s education — inflation-adjusted.',
    icon: '🚀',
  },
  {
    title: 'Debt Freedom',
    body: 'Snowball vs avalanche payoff plans that show how many months — and how much interest — you can save.',
    icon: '💸',
  },
  {
    title: 'AI Wealth Coach',
    body: 'Personalised, plain-English guidance on your next best money move. (Rolling out now.)',
    icon: '🤖',
  },
  {
    title: 'Private & Secure',
    body: 'Bank-grade encryption, India DPDP-ready consent, and an audit trail. Your data is yours.',
    icon: '🔒',
  },
];

const JOURNEY = [
  'Wealth Health Check',
  'Family Balance Sheet',
  'AI Action Plan',
  'Advisor Consultation',
  'Continuous Coaching',
  'Legacy Planning',
];

export default function HomePage() {
  return (
    <main className="bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-xl font-bold text-brand">Life Capital OS</span>
          <nav className="flex items-center gap-4 text-sm">
            <a href="#tools" className="hidden text-slate-600 hover:text-brand sm:block">
              Free tools
            </a>
            <a href="#features" className="hidden text-slate-600 hover:text-brand sm:block">
              Features
            </a>
            <a href="/login" className="text-slate-600 hover:text-brand">
              Log in
            </a>
            <a
              href="/login"
              className="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark"
            >
              Get started free
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-b from-white to-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <span className="inline-block rounded-full bg-brand/10 px-4 py-1 text-sm font-medium text-brand">
            India’s AI-powered Wealth Health &amp; Family CFO
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
            Know Your Financial Health in 5 Minutes
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
            Most apps track expenses. Life Capital OS is a financial operating system for your whole
            family — wealth, protection, retirement and legacy, in one intelligent dashboard.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <a
              href="#tools"
              className="rounded-xl bg-brand px-6 py-3 font-semibold text-white hover:bg-brand-dark"
            >
              Check my financial health
            </a>
            <a
              href="/login"
              className="rounded-xl border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-700 hover:border-brand hover:text-brand"
            >
              Create free account
            </a>
          </div>
          <p className="mt-4 text-sm text-slate-400">No signup needed to try the tools below.</p>
        </div>
      </section>

      {/* Free tools */}
      <section id="tools" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16">
        <h2 className="mb-2 text-3xl font-bold">Try it now — free</h2>
        <p className="mb-8 text-slate-600">
          Instant answers, no account required. Your numbers never leave your browser.
        </p>
        <ToolsSection />
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 bg-white py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-2 text-3xl font-bold">One platform for your family’s financial life</h2>
          <p className="mb-10 text-slate-600">From “Am I okay?” to a clear plan and ongoing coaching.</p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-slate-100 bg-slate-50 p-6">
                <div className="text-3xl">{f.icon}</div>
                <h3 className="mt-3 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Journey */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="mb-8 text-center text-3xl font-bold">Your journey with us</h2>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {JOURNEY.map((step, i) => (
            <div key={step} className="flex items-center gap-3">
              <span className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow">
                {step}
              </span>
              {i < JOURNEY.length - 1 && <span className="text-brand">→</span>}
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-brand">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center">
          <h2 className="text-3xl font-bold text-white">Build wealth, health, security and legacy</h2>
          <p className="mx-auto mt-3 max-w-xl text-brand-light">
            Create your free account and get your personalised Top Wealth Actions today.
          </p>
          <a
            href="/login"
            className="mt-8 inline-block rounded-xl bg-white px-8 py-3 font-semibold text-brand hover:bg-slate-100"
          >
            Get started free
          </a>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-slate-500">
          © {new Date().getFullYear()} Life Capital OS — Wealth · Health · Security · Purpose · Legacy
        </div>
      </footer>
    </main>
  );
}
