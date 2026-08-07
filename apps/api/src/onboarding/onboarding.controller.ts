import { Body, Controller, Get, Ip, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { ProvisionHouseholdDto } from './dto';

/**
 * Consumer onboarding. Authenticated but NOT firm-scoped — by definition the caller has no
 * firm context yet, which is the whole point of these two endpoints.
 */
@ApiTags('onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /** What the caller already has. Lets the web app decide between onboarding and dashboard. */
  @Get('status')
  async status(@CurrentUser() user: AuthUser) {
    const workspace = await this.onboarding.findWorkspace(user.id);
    // Deliberately not spreading `workspace`: it carries a `provisioned` flag that means
    // nothing on a read, and would read as "we just created this" to a client.
    return {
      hasHousehold: workspace !== null,
      firmId: workspace?.firmId ?? null,
      householdId: workspace?.householdId ?? null,
    };
  }

  /** Idempotent: returns the existing workspace rather than creating a second one. */
  @Post('household')
  provision(
    @CurrentUser() user: AuthUser,
    @Body() dto: ProvisionHouseholdDto,
    @Ip() ip: string,
  ) {
    return this.onboarding.ensurePersonalHousehold(user, dto, ip);
  }
}
