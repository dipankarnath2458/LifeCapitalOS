import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { Household } from '@prisma/client';
import {
  buildAiGroundingContext,
  containsNoPiiKeys,
  type AiGroundingContext,
  type FinancialSnapshotPayload,
  type GroundingEnvelope,
  type HouseholdFinancialIntelligence,
} from '@lcos/core';
import { HouseholdIntelligenceService } from './household-intelligence.service';
import { HouseholdFinancialSnapshotService } from './household-financial-snapshot.service';

export interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Sections of the intelligence object the model is allowed to see. */
interface GroundedAnalysis {
  wealthHealth: HouseholdFinancialIntelligence['wealthHealth'];
  risk: HouseholdFinancialIntelligence['risk'];
  opportunity: HouseholdFinancialIntelligence['opportunity'];
  recommendedActions: HouseholdFinancialIntelligence['recommendedActions'];
  executiveSummary: HouseholdFinancialIntelligence['executiveSummary'];
}

export interface Grounding {
  context: AiGroundingContext;
  analysis: GroundedAnalysis;
}

/**
 * Everything the model may see, and nothing else. **Pure** — no IO, no clock — so the redaction
 * property can be tested directly rather than inferred from a service's behaviour.
 *
 * ## The PII hazard this exists to close
 *
 * The pure intelligence object is PII-light by construction: `household.name` is null, ids only,
 * coarse demographics. But `HouseholdIntelligenceService.current()` deliberately decrypts the
 * family name into it for the dashboard header. Handing that object to a model would send a real
 * family's name to a third-party LLM.
 *
 * So the analysis is assembled by **naming each section** — an allow-list, never a spread and
 * never a `delete`. A `delete` stops protecting the moment someone adds an identifying field to a
 * section it does not know about; an allow-list keeps protecting by default, and a new section
 * simply does not reach the model until someone adds it here deliberately.
 */
export function buildHouseholdGrounding(
  envelope: GroundingEnvelope,
  payload: FinancialSnapshotPayload,
  intel: HouseholdFinancialIntelligence,
): Grounding {
  return {
    context: buildAiGroundingContext(envelope, payload),
    analysis: {
      wealthHealth: intel.wealthHealth,
      risk: intel.risk,
      opportunity: intel.opportunity,
      recommendedActions: intel.recommendedActions,
      executiveSummary: intel.executiveSummary,
    },
  };
}

export type AiAnswer =
  | { available: false; reason: string }
  | {
      available: true;
      /** True when an LLM produced this; false for the deterministic layer narrative. */
      ai: boolean;
      answer: string;
      /** The snapshot every figure in the answer traces to. */
      snapshotId: string;
      capturedAt: string | null;
      /** Ranked actions from the layer — shown alongside the prose, never invented by the model. */
      actions: HouseholdFinancialIntelligence['recommendedActions'];
    };

/**
 * V2 consumer AI — the Financial Intelligence Layer's narrator.
 *
 * See `docs/M5_7_AI_INSIGHTS_ARCHITECTURE.md`.
 *
 * ## The rule this class implements
 *
 * **It consumes the Financial Intelligence Layer and the redacted grounding context. It reads no
 * financial table, and it computes no financial number.**
 *
 * Note what is *not* injected here: no `PrismaService`, no accounts / cashflow / debt repository.
 * That is the enforcement mechanism from `AI_INTEGRATION_ARCHITECTURE` §5 — a structural
 * guarantee visible in the constructor, rather than a convention someone has to remember. A test
 * asserts it directly, so an edit that reaches for a table fails rather than merely being noticed
 * in review.
 *
 * ## Why the model gets two objects
 *
 * `AiGroundingContext` carries **figures** (PII-light aggregates + provenance) and satisfies
 * `AI_GROUNDING_CONTRACT` §1. On its own it would leave the model to judge whether, say, a 0.20
 * debt-to-assets ratio is healthy — a financial judgement this codebase already owns in
 * `financialHealth.ts` and the Early Warning engine. Re-deriving it in a prompt would duplicate
 * business logic and drift: the dashboard would report one assessment and the coach another, from
 * the same snapshot, on the same screen.
 *
 * So the layer's **conclusions** are supplied as facts the model may not contradict, and the
 * grounding context supplies the figures it may cite. The model explains and converses; it does
 * not assess.
 */
@Injectable()
export class HouseholdAiService {
  private readonly logger = new Logger(HouseholdAiService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;

  constructor(
    private readonly intelligence: HouseholdIntelligenceService,
    private readonly snapshots: HouseholdFinancialSnapshotService,
    private readonly config: ConfigService,
  ) {
    const apiKey = this.config.get<string>('ai.apiKey');
    this.model = this.config.get<string>('ai.model') ?? 'claude-sonnet-4-6';
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  /**
   * Assemble everything the model may see, or explain why there is nothing to say.
   *
   * ## The PII hazard this guards
   *
   * The pure intelligence object is PII-light by construction — `household.name` is null, ids
   * only, coarse demographics. But `HouseholdIntelligenceService.current()` deliberately decrypts
   * the family name into it for the dashboard header. Passing that object to a model would send a
   * real family's name to a third-party LLM.
   *
   * The analysis is therefore assembled by **naming each section**, never by spreading the object.
   * An allow-list rather than a `delete`, because a `delete` stops protecting the moment someone
   * adds a new identifying field to a section it does not know about.
   */
  private async ground(household: Household): Promise<Grounding | { reason: string }> {
    const snap = await this.snapshots.latest(household.id);
    if (!snap) {
      return { reason: 'no snapshot captured' };
    }

    const intel = await this.intelligence.current(household);
    if (!intel.available) {
      return { reason: intel.reason };
    }

    return buildHouseholdGrounding(
      {
        snapshotId: snap.id,
        schemaVersion: snap.schemaVersion,
        engineVersion: snap.engineVersion,
        fxVersion: snap.fxVersion ?? undefined,
        currency: snap.currency,
        capturedAt:
          snap.capturedAt instanceof Date ? snap.capturedAt.toISOString() : String(snap.capturedAt),
        status: snap.status,
      },
      snap.payload as unknown as FinancialSnapshotPayload,
      intel,
    );
  }

  private static SYSTEM = [
    'You are the Life Capital OS Family CFO, a calm, encouraging financial coach for Indian families.',
    'You are given a GROUNDING block with two parts: `context` holds consolidated figures in the',
    'household base currency with their provenance, and `analysis` holds assessments already',
    'produced by the platform.',
    'Treat `analysis` as settled fact: never contradict a score, band, risk or recommendation in it.',
    'Cite only figures present in `context`. Never invent, estimate, convert or recompute a number —',
    'all amounts are minor units of the base currency; divide by 100 to present them.',
    'If asked something the grounding does not cover, say plainly that you do not have that',
    'information rather than guessing.',
    'Be concise (under 200 words) and prefer concrete next steps over general theory.',
    'You are an educational coach, not a SEBI-registered advisor: do not recommend specific',
    'securities, and add a one-line reminder to consult a registered advisor for regulated',
    'product decisions.',
  ].join(' ');

  /** A narrative summary of where the household stands. */
  async insights(household: Household): Promise<AiAnswer> {
    return this.answer(household, [
      { role: 'user', content: 'Summarise where my family stands financially right now.' },
    ]);
  }

  /** Multi-turn conversation, grounded on the same snapshot the dashboard reads. */
  async coach(household: Household, history: CoachMessage[]): Promise<AiAnswer> {
    const messages = history.length > 0 ? history : [{ role: 'user' as const, content: 'How am I doing?' }];
    return this.answer(household, messages);
  }

  private async answer(household: Household, messages: CoachMessage[]): Promise<AiAnswer> {
    const grounding = await this.ground(household);
    if ('reason' in grounding) {
      return { available: false, reason: grounding.reason };
    }

    const base = {
      available: true as const,
      snapshotId: grounding.context.provenance.snapshotId,
      capturedAt: grounding.context.provenance.capturedAt ?? null,
      actions: grounding.analysis.recommendedActions,
    };

    // Runtime enforcement of the redaction contract, immediately before the only place the data
    // could leave the system. A grounding block that would carry PII is never sent — the
    // deterministic answer is returned instead, which needs no model call at all.
    if (!containsNoPiiKeys(grounding)) {
      this.logger.error(
        `Grounding for household ${household.id} failed the PII guard; refusing the model call.`,
      );
      return { ...base, ai: false, answer: this.deterministic(grounding.analysis) };
    }

    if (!this.client) {
      return { ...base, ai: false, answer: this.deterministic(grounding.analysis) };
    }

    try {
      const msg = await this.client.messages.create({
        model: this.model,
        max_tokens: 600,
        system: [
          { type: 'text', text: HouseholdAiService.SYSTEM },
          {
            type: 'text',
            text: `GROUNDING:\n${JSON.stringify(grounding)}`,
            // The grounding is stable across a conversation; caching it keeps multi-turn cheap.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });
      const answer = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      // An empty completion must not render as a blank coach reply.
      if (!answer) return { ...base, ai: false, answer: this.deterministic(grounding.analysis) };
      return { ...base, ai: true, answer };
    } catch (err) {
      this.logger.error(`Family CFO call failed: ${(err as Error).message}`);
      return { ...base, ai: false, answer: this.deterministic(grounding.analysis) };
    }
  }

  /**
   * The answer when there is no model: the layer's **own** deterministic narrative.
   *
   * Not a degraded imitation of the AI reply — it is the same analysis the dashboard renders,
   * composed by template from the same snapshot, minus the conversational phrasing. It fabricates
   * nothing. Callers receive `ai: false` so the client can label it honestly; a user must never be
   * told a template was a personalised AI answer.
   */
  private deterministic(analysis: GroundedAnalysis): string {
    const s = analysis.executiveSummary;
    const lines = [s.headline, '', ...s.paragraphs];
    if (s.watchouts.length > 0) lines.push('', `Worth watching: ${s.watchouts.join('; ')}.`);
    if (s.highlights.length > 0) lines.push(`Going well: ${s.highlights.join('; ')}.`);
    return lines.filter((l) => l !== undefined).join('\n');
  }
}
