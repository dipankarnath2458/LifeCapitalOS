import { Module } from '@nestjs/common';
import { FirmsModule } from '../firms/firms.module';
import { HouseholdsController } from './households.controller';
import { HouseholdsService } from './households.service';
import { HouseholdScopeGuard } from './household-scope.guard';
import { HouseholdMembersController } from './household-members.controller';
import { HouseholdMembersService } from './household-members.service';
import { EntitiesController } from './entities.controller';
import { EntitiesService } from './entities.service';

@Module({
  imports: [FirmsModule],
  controllers: [HouseholdsController, HouseholdMembersController, EntitiesController],
  providers: [HouseholdsService, HouseholdMembersService, EntitiesService, HouseholdScopeGuard],
  exports: [HouseholdsService, HouseholdScopeGuard],
})
export class HouseholdsModule {}
