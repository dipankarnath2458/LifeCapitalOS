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

@Module({
  imports: [FirmsModule],
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
    HouseholdScopeGuard,
  ],
  exports: [HouseholdsService, HouseholdScopeGuard],
})
export class HouseholdsModule {}
