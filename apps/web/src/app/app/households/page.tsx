'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { useApp, canManageBook } from '@/lib/appContext';
import {
  Card,
  DataTable,
  Badge,
  Button,
  Modal,
  LabeledInput,
  Heading,
  Text,
  ErrorState,
  type Column,
} from '@/ui';
import { IconPlus } from '@/ui/icons';

interface HouseholdRow {
  id: string;
  name: string;
  advisorId: string | null;
  baseCurrency: string;
  status: string;
}
interface HouseholdList {
  total: number;
  data: HouseholdRow[];
}

export default function HouseholdsPage() {
  const { token, firm } = useApp();
  const [list, setList] = useState<HouseholdList | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(firm.baseCurrency);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const canCreate = canManageBook(firm.firmRole);

  function load() {
    setList(null);
    setError(false);
    apiGet<HouseholdList>('/households?take=100', token)
      .then(setList)
      .catch(() => setError(true));
  }

  useEffect(load, [token]);

  async function create() {
    if (!name.trim()) {
      setFormError('Name is required');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await apiPost('/households', { name: name.trim(), baseCurrency: currency }, token);
      setOpen(false);
      setName('');
      load();
    } catch {
      setFormError('Could not create household. Check your permissions and try again.');
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<HouseholdRow>[] = [
    { key: 'name', header: 'Household', cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'currency', header: 'Base currency', cell: (r) => r.baseCurrency },
    {
      key: 'advisor',
      header: 'Advisor',
      cell: (r) => (r.advisorId ? <Badge tone="info">assigned</Badge> : <Badge>unassigned</Badge>),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status}</Badge>,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Heading level={1}>Households</Heading>
          <Text muted>{list ? `${list.total} in your book` : 'Loading…'}</Text>
        </div>
        {canCreate && (
          <Button leftIcon={<IconPlus className="h-4 w-4" />} onClick={() => setOpen(true)}>
            New household
          </Button>
        )}
      </div>

      <Card flush>
        {error ? (
          <div className="p-6">
            <ErrorState
              title="Couldn't load households"
              description="Please try again."
              action={{ label: 'Retry', onClick: load }}
            />
          </div>
        ) : (
          <div className="p-2">
            <DataTable
              columns={columns}
              data={list?.data ?? []}
              rowKey={(r) => r.id}
              loading={!list}
              empty={canCreate ? 'No households yet. Create your first one.' : 'No households yet.'}
              onRowClick={(r) => (window.location.href = `/app/households/${r.id}`)}
            />
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New household">
        <div className="space-y-4">
          <LabeledInput
            label="Family / household name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. The Sharma Family"
          />
          <LabeledInput
            label="Base currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            hint="ISO code, e.g. INR"
          />
          {formError && <Text className="text-danger">{formError}</Text>}
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={create}>
              Create
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
