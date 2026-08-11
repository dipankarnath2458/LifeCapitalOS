import { apiPost } from './api';
import { getOnboardingStatus } from './household';

/**
 * Family CFO client (M5.7) — the V2 consumer AI surface.
 *
 * Design: `docs/M5_7_AI_INSIGHTS_ARCHITECTURE.md`.
 *
 * Every answer is grounded on the **same snapshot the dashboard reads**, and the server returns
 * that `snapshotId` with it. Nothing here computes, summarises or reformats a financial figure:
 * the prose and the ranked actions both arrive from the server already composed.
 *
 * `ai: false` means the answer came from the layer's deterministic narrative rather than a model.
 * The UI must say so. Presenting a template as a personalised AI answer would be a lie about
 * provenance, which is the one thing a financial product cannot afford to be casual about.
 */

export interface RecommendedAction {
  priority: number;
  title: string;
  rationale: string;
  sourceSection: string;
  estimatedImpact: string;
}

export interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type AiAnswer =
  | { available: false; reason: string }
  | {
      available: true;
      ai: boolean;
      answer: string;
      snapshotId: string;
      capturedAt: string | null;
      actions: RecommendedAction[];
    };

/** Distinguishes "you don't have this plan" from a genuine failure — different screens. */
export class NotEntitledError extends Error {
  constructor() {
    super('premium required');
    this.name = 'NotEntitledError';
  }
}

const isForbidden = (err: unknown) => err instanceof Error && / 403$/.test(err.message);

async function householdId(token: string): Promise<string | null> {
  const status = await getOnboardingStatus(token);
  return status?.householdId ?? null;
}

/**
 * The narrative summary. Free to serve — it narrates the same intelligence call the dashboard
 * already makes, so it is never gated.
 */
export async function loadInsights(token: string): Promise<AiAnswer | null> {
  const id = await householdId(token);
  if (!id) return null;
  return apiPost<AiAnswer>(`/households/${id}/ai/insights`, {}, token);
}

/**
 * A conversational turn. Throws {@link NotEntitledError} when the user's plan does not include
 * the model-backed coach, so the caller can offer the upgrade rather than render an error.
 */
export async function askCoach(token: string, messages: CoachMessage[]): Promise<AiAnswer | null> {
  const id = await householdId(token);
  if (!id) return null;
  try {
    return await apiPost<AiAnswer>(`/households/${id}/ai/coach`, { messages }, token);
  } catch (err) {
    if (isForbidden(err)) throw new NotEntitledError();
    throw err;
  }
}
