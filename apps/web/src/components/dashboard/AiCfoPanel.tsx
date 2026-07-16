'use client';

import { Card, CardHeader, CardTitle, CardDescription, CardContent, Badge, Button, Text } from '@/ui';
import { IconShield, IconTarget, IconCheck } from '@/ui/icons';

/**
 * Section 3 — AI Family CFO™ (V2 PLACEHOLDER). Establishes where AI guidance will live
 * (top priorities, recommended actions, a conversational entry point) without any AI
 * logic. When the M4 AI fleet lands it grounds via the AI Grounding Contract; the layout
 * does not change.
 */
export function AiCfoPanel() {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>
            <span className="inline-flex items-center gap-2">
              <IconShield className="h-5 w-5 text-primary" aria-hidden />
              AI Family CFO™
            </span>
          </CardTitle>
          <CardDescription>Proactive, explainable guidance for your family's wealth.</CardDescription>
        </div>
        <Badge tone="neutral" variant="outline">
          Coming soon
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-2">
              <IconTarget className="h-4 w-4 text-subtle" aria-hidden />
              <span className="text-sm font-medium">Top priorities</span>
            </div>
            <Text muted className="mt-2 text-sm">
              Your family's most important financial priorities will appear here, ranked by impact.
            </Text>
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-2">
              <IconCheck className="h-4 w-4 text-subtle" aria-hidden />
              <span className="text-sm font-medium">Recommended actions</span>
            </div>
            <Text muted className="mt-2 text-sm">
              Concrete, explainable next steps — grounded on your latest financial snapshot.
            </Text>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-subtle"
            placeholder="Ask your Family CFO…  (available in a future release)"
            disabled
            aria-label="Ask your Family CFO (coming soon)"
          />
          <Button variant="outline" size="sm" disabled>
            Ask
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
