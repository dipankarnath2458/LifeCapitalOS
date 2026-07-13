'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DashboardLayout,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Heading,
  Icons,
  Input,
  LoadingState,
  Modal,
  Select,
  Skeleton,
  Spinner,
  StatCard,
  Text,
  Textarea,
  type Column,
  type NavSection,
} from '@/ui';

const nav: NavSection[] = [
  {
    items: [
      { label: 'Overview', href: '/design-system', icon: <Icons.IconHome className="h-5 w-5" /> },
      { label: 'Net Worth', href: '/design-system#networth', icon: <Icons.IconChart className="h-5 w-5" /> },
      { label: 'Accounts', href: '/design-system#accounts', icon: <Icons.IconWallet className="h-5 w-5" /> },
      { label: 'Goals', href: '/design-system#goals', icon: <Icons.IconTarget className="h-5 w-5" /> },
    ],
  },
  {
    title: 'Manage',
    items: [
      { label: 'Protection', href: '/design-system#protect', icon: <Icons.IconShield className="h-5 w-5" /> },
      { label: 'Family', href: '/design-system#family', icon: <Icons.IconUsers className="h-5 w-5" /> },
      { label: 'Settings', href: '/design-system#settings', icon: <Icons.IconSettings className="h-5 w-5" /> },
    ],
  },
];

interface Row {
  name: string;
  type: string;
  balance: string;
  status: 'active' | 'past_due';
}
const rows: Row[] = [
  { name: 'HDFC Savings', type: 'Bank', balance: '₹4,50,000', status: 'active' },
  { name: 'Zerodha Equity', type: 'Investment', balance: '₹12,80,000', status: 'active' },
  { name: 'Home Loan', type: 'Loan', balance: '−₹35,00,000', status: 'past_due' },
];
const columns: Column<Row>[] = [
  { key: 'name', header: 'Account', cell: (r) => <span className="font-medium">{r.name}</span> },
  { key: 'type', header: 'Type', cell: (r) => r.type },
  { key: 'balance', header: 'Balance', align: 'right', cell: (r) => r.balance },
  {
    key: 'status',
    header: 'Status',
    cell: (r) =>
      r.status === 'active' ? (
        <Badge tone="success" dot>Active</Badge>
      ) : (
        <Badge tone="danger" dot>Past due</Badge>
      ),
  },
];

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-4">
      <Heading level={3}>{title}</Heading>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <DashboardLayout
      sections={nav}
      brand={
        <span className="flex items-center gap-2 font-bold text-primary">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            LC
          </span>
          Life Capital
        </span>
      }
      title="Design System"
      actions={
        <Button size="sm" leftIcon={<Icons.IconPlus className="h-4 w-4" />}>
          New
        </Button>
      }
    >
      <div className="mx-auto max-w-5xl space-y-12">
        <div>
          <Heading level={1} display>
            V2 UI Foundation
          </Heading>
          <Text role="lead" className="mt-2">
            Tokens, primitives, and layout — theme-aware (toggle top-right), responsive, reusable.
          </Text>
        </div>

        <Section title="Typography">
          <Card className="space-y-2">
            <Heading level={1}>Heading 1 — Wealth Health</Heading>
            <Heading level={2}>Heading 2 — Family Balance Sheet</Heading>
            <Heading level={3}>Heading 3 — Net Worth</Heading>
            <Text role="body">Body — Know your financial health in five minutes.</Text>
            <Text role="small" muted>Small muted — supporting detail.</Text>
            <Text role="overline">Overline label</Text>
          </Card>
        </Section>

        <Section title="Colors">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(['primary', 'success', 'warning', 'danger', 'info'] as const).map((t) => (
              <div key={t} className="overflow-hidden rounded-lg border border-border">
                <div className={`h-14 bg-${t}`} />
                <div className="bg-surface px-3 py-2 text-xs capitalize text-subtle">{t}</div>
              </div>
            ))}
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="h-14 bg-muted" />
              <div className="bg-surface px-3 py-2 text-xs text-subtle">muted</div>
            </div>
          </div>
        </Section>

        <Section title="Buttons">
          <Card className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="success">Success</Button>
            <Button variant="link">Link</Button>
            <Button loading>Loading</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Add">
              <Icons.IconPlus className="h-5 w-5" />
            </Button>
          </Card>
        </Section>

        <Section title="Inputs">
          <Card className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="ds-name" hint="As it appears on your PAN">
              <Input id="ds-name" placeholder="Dipankar" />
            </Field>
            <Field label="Search" htmlFor="ds-search">
              <Input id="ds-search" leftIcon={<Icons.IconSearch className="h-4 w-4" />} placeholder="Search…" />
            </Field>
            <Field label="Risk tolerance" htmlFor="ds-risk">
              <Select id="ds-risk" defaultValue="moderate">
                <option value="conservative">Conservative</option>
                <option value="moderate">Moderate</option>
                <option value="aggressive">Aggressive</option>
              </Select>
            </Field>
            <Field label="Amount" htmlFor="ds-amt" error="Enter a valid amount">
              <Input id="ds-amt" invalid placeholder="₹0" />
            </Field>
            <Field label="Notes" htmlFor="ds-notes" className="sm:col-span-2">
              <Textarea id="ds-notes" placeholder="Optional notes…" />
            </Field>
          </Card>
        </Section>

        <Section title="Badges">
          <Card className="flex flex-wrap gap-2">
            <Badge>Neutral</Badge>
            <Badge tone="primary">Primary</Badge>
            <Badge tone="success" dot>Active</Badge>
            <Badge tone="warning">Pending</Badge>
            <Badge tone="danger" variant="solid">Overdue</Badge>
            <Badge tone="info" variant="outline">Info</Badge>
          </Card>
        </Section>

        <Section id="networth" title="Cards & stats">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Net Worth" value="₹1.2 Cr" hint="+4.2% this month" highlight icon={<Icons.IconChart className="h-6 w-6" />} />
            <StatCard label="Assets" value="₹1.55 Cr" icon={<Icons.IconWallet className="h-6 w-6" />} />
            <StatCard label="Liabilities" value="₹35.0 L" icon={<Icons.IconShield className="h-6 w-6" />} />
          </div>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Wealth Health</CardTitle>
                <CardDescription>Composite score across six dimensions.</CardDescription>
              </div>
              <Badge tone="success">Green</Badge>
            </CardHeader>
            <CardContent>Your Life Capital Score is 78/100.</CardContent>
            <CardFooter>
              <Button size="sm" variant="outline">View report</Button>
            </CardFooter>
          </Card>
        </Section>

        <Section id="accounts" title="Table">
          <Card flush>
            <DataTable columns={columns} data={rows} rowKey={(r) => r.name} />
          </Card>
        </Section>

        <Section title="Loading states">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="flex items-center gap-3">
              <Spinner className="text-primary" /> <Text role="small">Inline spinner</Text>
            </Card>
            <Card className="space-y-2">
              <Skeleton variant="title" />
              <Skeleton />
              <Skeleton className="w-4/5" />
            </Card>
            <Card><LoadingState label="Loading your dashboard…" /></Card>
            <Card className="relative min-h-[120px]">
              <Text role="small" muted>Content behind overlay</Text>
            </Card>
          </div>
        </Section>

        <Section title="Empty & error states">
          <div className="grid gap-4 sm:grid-cols-2">
            <EmptyState
              title="No accounts yet"
              description="Add your first account to build your balance sheet."
              action={{ label: 'Add account', onClick: () => setModalOpen(true) }}
            />
            <ErrorState
              title="Couldn't load data"
              description="Check your connection and try again."
              action={{ label: 'Retry', onClick: () => undefined }}
            />
          </div>
        </Section>

        <Section title="Modal">
          <Card>
            <Button onClick={() => setModalOpen(true)}>Open modal</Button>
          </Card>
          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title="Add account"
            description="Manually add an asset or liability."
            footer={
              <>
                <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button onClick={() => setModalOpen(false)}>Save</Button>
              </>
            }
          >
            <div className="space-y-4">
              <Field label="Account name" htmlFor="m-name">
                <Input id="m-name" placeholder="e.g. HDFC Savings" />
              </Field>
              <Field label="Balance" htmlFor="m-bal">
                <Input id="m-bal" placeholder="₹0" />
              </Field>
            </div>
          </Modal>
        </Section>
      </div>
    </DashboardLayout>
  );
}
