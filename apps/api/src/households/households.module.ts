import { Module } from '@nestjs/common';
import { FirmsModule } from '../firms/firms.module';
import { HouseholdsController } from './households.controller';
import { HouseholdsService } from './households.service';
import { HouseholdScopeGuard } from './household-scope.guard';
import { HouseholdMembersController } from './household-members.controller';
import { HouseholdMembersService } from './household-members.service';
import { EntitiesController } from './entities.controller';
import { EntitiesService } from './entities.service';
import { HouseholdAccountsController } from './household-accounts.controller';
import { HouseholdAccountsService } from './household-accounts.service';
import { HouseholdNetWorthController } from './household-networth.controller';
import { HouseholdNetWorthService } from './household-networth.service';
import { HouseholdCashflowController } from './household-cashflow.controller';
import { HouseholdCashflowService } from './household-cashflow.service';
import { HouseholdBudgetController } from './household-budget.controller';
import { HouseholdBudgetService } from './household-budget.service';
import { HouseholdDebtController } from './household-debt.controller';
import { HouseholdDebtService } from './household-debt.service';
import { HouseholdFinancialSnapshotController } from './household-financial-snapshot.controller';
import { HouseholdFinancialSnapshotService } from './household-financial-snapshot.service';
import { HouseholdHealthScoreController } from './household-health-score.controller';
import { HouseholdHealthScoreService } from './household-health-score.service';
import { HouseholdHealthExplanationController } from './household-health-explanation.controller';
import { HouseholdHealthExplanationService } from './household-health-explanation.service';
import { HouseholdSimulationController } from './household-simulation.controller';
import { HouseholdSimulationService } from './household-simulation.service';
import { HouseholdIntelligenceController } from './household-intelligence.controller';
import { HouseholdIntelligenceService } from './household-intelligence.service';
import { HouseholdGoalsController } from './household-goals.controller';
import { HouseholdProtectionController } from './household-protection.controller';
import { HouseholdGoalsService } from './household-goals.service';
import { HouseholdProtectionService } from './household-protection.service';
import { HouseholdAiController } from './household-ai.controller';
import { HouseholdAiService } from './household-ai.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  // BillingModule: the Family CFO conversation keeps the same premium entitlement that gates
  // V1's /ai/* routes. See household-ai.controller.ts.
  imports: [FirmsModule, BillingModule],
  controllers: [
    HouseholdsController,
    HouseholdMembersController,
    EntitiesController,
    HouseholdAccountsController,
    HouseholdNetWorthController,
    HouseholdCashflowController,
    HouseholdBudgetController,
    HouseholdDebtController,
    HouseholdFinancialSnapshotController,
    HouseholdHealthScoreController,
    HouseholdHealthExplanationController,
    HouseholdSimulationController,
    HouseholdIntelligenceController,
    HouseholdGoalsController,
    HouseholdProtectionController,
    HouseholdAiController,
  ],
  providers: [
    HouseholdsService,
    HouseholdMembersService,
    EntitiesService,
    HouseholdAccountsService,
    HouseholdNetWorthService,
    HouseholdCashflowService,
    HouseholdBudgetService,
    HouseholdDebtService,
    HouseholdFinancialSnapshotService,
    HouseholdHealthScoreService,
    HouseholdHealthExplanationService,
    HouseholdSimulationService,
    HouseholdIntelligenceService,
    HouseholdGoalsService,
    HouseholdProtectionService,
    HouseholdAiService,
    HouseholdScopeGuard,
  ],
  exports: [HouseholdsService, HouseholdScopeGuard],
})
export class HouseholdsModule {}
