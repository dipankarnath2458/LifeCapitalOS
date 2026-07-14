import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FirmRole, Household } from '@prisma/client';
import { HouseholdsService } from './households.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { FirmContextGuard } from '../firms/firm-context.guard';
import { CurrentFirm, FirmContext, FirmRoles } from '../firms/firm-context.decorators';
import { HouseholdScopeGuard } from './household-scope.guard';
import { CurrentHousehold } from './household.decorators';
import { AssignHouseholdDto, CreateHouseholdDto, UpdateHouseholdDto } from './households.dto';

@ApiTags('households')
@Controller('households')
export class HouseholdsController {
  constructor(private readonly households: HouseholdsService) {}

  /** Create a household in the active firm. Owners and advisors may create. */
  @Post()
  @UseGuards(FirmContextGuard)
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR)
  create(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Body() dto: CreateHouseholdDto,
    @Ip() ip: string,
  ) {
    return this.households.create(actor, firm, dto, ip);
  }

  /** The book: firm-scoped, intersected with the caller's assignment, paginated. */
  @Get()
  @UseGuards(FirmContextGuard)
  list(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('advisorId') advisorId?: string,
    @Query('status') status?: string,
  ) {
    return this.households.list(actor, firm, {
      skip: skip ? parseInt(skip, 10) : 0,
      take: Math.min(take ? parseInt(take, 10) : 25, 100),
      advisorId,
      status,
    });
  }

  @Get(':id')
  @UseGuards(HouseholdScopeGuard)
  get(@CurrentHousehold() household: Household) {
    return this.households.get(household);
  }

  @Patch(':id')
  @UseGuards(HouseholdScopeGuard)
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR)
  update(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') id: string,
    @Body() dto: UpdateHouseholdDto,
    @Ip() ip: string,
  ) {
    return this.households.update(actor, firm, id, dto, ip);
  }

  /** Reassign the advisor (owner-only); the from -> to change is audited. */
  @Post(':id/assign')
  @UseGuards(HouseholdScopeGuard)
  @FirmRoles(FirmRole.OWNER)
  assign(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @CurrentHousehold() household: Household,
    @Body() dto: AssignHouseholdDto,
    @Ip() ip: string,
  ) {
    return this.households.assign(actor, firm, household, dto, ip);
  }

  @Delete(':id')
  @UseGuards(HouseholdScopeGuard)
  @FirmRoles(FirmRole.OWNER)
  remove(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') id: string,
    @Ip() ip: string,
  ) {
    return this.households.remove(actor, firm, id, ip);
  }
}
