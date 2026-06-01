/**
 * Wealth DNA — a short, no-login personality assessment from the blueprint.
 * Maps answers to one of four archetypes (Builder / Protector / Explorer / Achiever)
 * with traits and blind spots. Designed as a viral, top-of-funnel lead-gen tool.
 */

export type WealthArchetype = 'builder' | 'protector' | 'explorer' | 'achiever';

export interface WealthDnaQuestion {
  id: string;
  prompt: string;
  options: { label: string; archetype: WealthArchetype }[];
}

/** The fixed questionnaire (front-end renders these; scoring is deterministic). */
export const WEALTH_DNA_QUESTIONS: WealthDnaQuestion[] = [
  {
    id: 'windfall',
    prompt: 'You receive an unexpected ₹5,00,000. What is your first instinct?',
    options: [
      { label: 'Invest it for long-term growth', archetype: 'builder' },
      { label: 'Move it somewhere safe and guaranteed', archetype: 'protector' },
      { label: 'Try a new opportunity — startup, crypto, a punt', archetype: 'explorer' },
      { label: 'Put it toward a specific goal I am chasing', archetype: 'achiever' },
    ],
  },
  {
    id: 'market_drop',
    prompt: 'Markets fall 20% in a month. You…',
    options: [
      { label: 'Buy more — it is on sale', archetype: 'builder' },
      { label: 'Feel anxious and consider moving to safety', archetype: 'protector' },
      { label: 'See it as a chance to find the next big winner', archetype: 'explorer' },
      { label: 'Check whether my goals are still on track', archetype: 'achiever' },
    ],
  },
  {
    id: 'money_means',
    prompt: 'Money, to you, mostly means…',
    options: [
      { label: 'Freedom built steadily over time', archetype: 'builder' },
      { label: 'Security and peace of mind', archetype: 'protector' },
      { label: 'Options and experiences', archetype: 'explorer' },
      { label: 'A scoreboard for the life I want', archetype: 'achiever' },
    ],
  },
  {
    id: 'planning',
    prompt: 'How do you approach financial planning?',
    options: [
      { label: 'Automate and let compounding work', archetype: 'builder' },
      { label: 'Protect the downside first, always', archetype: 'protector' },
      { label: 'Stay flexible; I adapt as I go', archetype: 'explorer' },
      { label: 'Set targets and track them closely', archetype: 'achiever' },
    ],
  },
  {
    id: 'pride',
    prompt: 'What would make you most proud in 10 years?',
    options: [
      { label: 'A large, diversified portfolio', archetype: 'builder' },
      { label: 'Zero debt and a fully protected family', archetype: 'protector' },
      { label: 'Having taken bold bets that paid off', archetype: 'explorer' },
      { label: 'Hitting every goal I set for myself', archetype: 'achiever' },
    ],
  },
];

export interface WealthDnaResult {
  archetype: WealthArchetype;
  title: string;
  tagline: string;
  traits: string[];
  blindSpots: string[];
  nextStep: string;
  /** Score breakdown across all archetypes (number of answers each got). */
  scores: Record<WealthArchetype, number>;
}

const PROFILES: Record<WealthArchetype, Omit<WealthDnaResult, 'archetype' | 'scores'>> = {
  builder: {
    title: 'The Wealth Builder',
    tagline: 'Patient, systematic, compounding-driven.',
    traits: ['Invests consistently', 'Comfortable with market volatility', 'Long time horizon'],
    blindSpots: ['May under-insure', 'Can neglect short-term liquidity', 'Risk of over-concentration in equity'],
    nextStep: 'Run an Insurance Gap check — builders often protect too little.',
  },
  protector: {
    title: 'The Wealth Protector',
    tagline: 'Security-first, downside-aware, steady.',
    traits: ['Strong emergency fund', 'Values guarantees', 'Low debt tolerance'],
    blindSpots: ['May hold too much cash', 'Inflation can erode safe assets', 'Often under-invested for growth'],
    nextStep: 'Check your Asset Allocation — some growth assets can protect long-term value.',
  },
  explorer: {
    title: 'The Wealth Explorer',
    tagline: 'Opportunistic, bold, experience-led.',
    traits: ['High risk appetite', 'Spots opportunities early', 'Adaptable'],
    blindSpots: ['Concentration & speculation risk', 'Inconsistent saving', 'Thin safety net'],
    nextStep: 'Use the Early Warning System to catch concentration and liquidity risks.',
  },
  achiever: {
    title: 'The Wealth Achiever',
    tagline: 'Goal-oriented, measured, target-driven.',
    traits: ['Plans around clear goals', 'Tracks progress', 'Disciplined'],
    blindSpots: ['Can over-optimise one goal', 'May ignore legacy/family planning', 'Stress from constant scorekeeping'],
    nextStep: 'Build your full Goal plan so every target has a funded SIP.',
  },
};

/** Score a set of answers (archetype per question) into a Wealth DNA result. */
export function computeWealthDna(answers: WealthArchetype[]): WealthDnaResult {
  const scores: Record<WealthArchetype, number> = { builder: 0, protector: 0, explorer: 0, achiever: 0 };
  for (const a of answers) {
    if (a in scores) scores[a] += 1;
  }
  // Highest score wins; ties broken by a stable priority order.
  const order: WealthArchetype[] = ['builder', 'protector', 'achiever', 'explorer'];
  let archetype: WealthArchetype = 'builder';
  let best = -1;
  for (const k of order) {
    if (scores[k] > best) {
      best = scores[k];
      archetype = k;
    }
  }
  return { archetype, ...PROFILES[archetype], scores };
}
