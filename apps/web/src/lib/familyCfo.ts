import { apiPost } from './api';
import { resolveHousehold, type UnavailableReason } from './household';

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

/**
 * A coach answer, or why there is none (Gap 7).
 *
 * `null` used to mean both "you have no household yet" and "we could not find out", and the page
 * rendered the first message for both — telling a family with a full financial picture that they
 * had no household, because `/onboarding/status` was briefly rate limited.
 */
export type CoachResult =
  | { kind: 'ready'; reply: AiAnswer }
  | { kind: 'none' }
  | { kind: 'unavailable'; reason: UnavailableReason };

/**
 * The narrative summary. Free to serve — it narrates the same intelligence call the dashboard
 * already makes, so it is never gated.
 */
export async function loadInsights(token: string): Promise<CoachResult> {
  const resolution = await resolveHousehold(token);
  if (resolution.kind !== 'resolved') {
    return resolution.kind === 'none'
      ? { kind: 'none' }
      : { kind: 'unavailable', reason: resolution.reason };
  }
  const reply = await apiPost<AiAnswer>(
    `/households/${resolution.householdId}/ai/insights`,
    {},
    token,
  );
  return { kind: 'ready', reply };
}

/**
 * A conversational turn. Throws {@link NotEntitledError} when the user's plan does not include
 * the model-backed coach, so the caller can offer the upgrade rather than render an error.
 */
export async function askCoach(token: string, messages: CoachMessage[]): Promise<CoachResult> {
  const resolution = await resolveHousehold(token);
  if (resolution.kind !== 'resolved') {
    return resolution.kind === 'none'
      ? { kind: 'none' }
      : { kind: 'unavailable', reason: resolution.reason };
  }
  try {
    const reply = await apiPost<AiAnswer>(
      `/households/${resolution.householdId}/ai/coach`,
      { messages },
      token,
    );
    return { kind: 'ready', reply };
  } catch (err) {
    if (isForbidden(err)) throw new NotEntitledError();
    throw err;
  }
}
