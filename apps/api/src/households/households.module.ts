import { Module } from '@nestjs/common';
import { FirmsModule } from '../firms/firms.module';
import { HouseholdsController } from './households.controller';
import { HouseholdsService } from './households.service';
import { HouseholdScopeGuard } from './household-scope.guard';

@Module({
  imports: [FirmsModule],
  controllers: [HouseholdsController],
  providers: [HouseholdsService, HouseholdScopeGuard],
  exports: [HouseholdsService, HouseholdScopeGuard],
})
export class HouseholdsModule {}
