import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SimulationScenario } from '@lcos/core';
import { HouseholdSimulationService } from './household-simulation.service';
import { HouseholdScopeGuard } from './household-scope.guard';
import { CurrentHousehold } from './household.decorators';
import { Household } from '@prisma/client';
import { SimulationRequestDto } from './household-simulation.dto';

/**
 * Financial What-if Simulation (M3-3). Household-scoped by HouseholdScopeGuard. The
 * engine is **non-mutating** — it simulates on an immutable snapshot and persists
 * nothing — so it is available to any in-scope member. `POST` only carries the scenario
 * body; it is not a write. 404 for out-of-scope households.
 */
@ApiTags('households')
@Controller('households/:id/simulation')
@UseGuards(HouseholdScopeGuard)
export class HouseholdSimulationController {
  constructor(private readonly simulation: HouseholdSimulationService) {}

  @Get('scenario-types')
  scenarioTypes() {
    return this.simulation.scenarioTypes();
  }

  @Post()
  simulate(@CurrentHousehold() household: Household, @Body() dto: SimulationRequestDto) {
    return this.simulation.simulate(
      household.id,
      dto.snapshotId,
      dto.scenarios as unknown as SimulationScenario[],
    );
  }
}
