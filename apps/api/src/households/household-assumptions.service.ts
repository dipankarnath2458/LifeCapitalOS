import { Injectable } from '@nestjs/common';
import type { IntelligenceAssumptions } from '@lcos/core';
import { HouseholdGoalsService } from './household-goals.service';
import { HouseholdProtectionService } from './household-protection.service';
import { RetirementPlanService } from './retirement-plan.service';

/**
 * The module-owned inputs the Financial Snapshot does not carry — protection, retirement, goals.
 *
 * ## Why this is a service of its own (M5.12)
 *
 * It began as a private method on `HouseholdIntelligenceService`, written that way to fix the M5.9
 * defect: `current()` accepted an `assumptions` argument and every call site forgot to pass it, so
 * the layer reported protection it had never been given. Resolving centrally made that class of
 * omission impossible **for that one service**.
 *
 * M5.12 gives the Wealth Health Score the same needs, and `HouseholdHealthScoreService` is a
 * different service with a different dependency set. Leaving the resolution private would have
 * meant a second copy — and a second copy is how the two paths eventually disagree about the same
 * family, which is exactly the defect the first fix was written to prevent.
 *
 * So: one loader, two consumers, and a new module-owned input is still one more entry in one
 * method. `undefined` means "nothing is known", which the layer and the scorer both read as
 * *not asked* rather than as a fact about the family.
 */
@Injectable()
export class HouseholdAssumptionsService {
  constructor(
    private readonly protection: HouseholdProtectionService,
    private readonly retirementPlans: RetirementPlanService,
    private readonly goals: HouseholdGoalsService,
  ) {}

  async resolve(householdId: string): Promise<IntelligenceAssumptions | undefined> {
    const [insurance, retirement, goals] = await Promise.all([
      this.protection.assumptionsFor(householdId),
      this.retirementPlans.assumptionsFor(householdId),
      this.goals.assumptionsFor(householdId),
    ]);
    if (!insurance && !retirement && !goals) return undefined;
    return {
      ...(insurance ? { insurance } : {}),
      ...(retirement ? { retirement } : {}),
      ...(goals ? { goals } : {}),
    };
  }
}
