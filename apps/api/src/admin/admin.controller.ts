import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AdminService } from './admin.service';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { RolesGuard } from '../common/roles.guard';

/**
 * All admin endpoints require an elevated role. SUPPORT/ANALYST get read access via
 * the broad role list; destructive actions are restricted to ADMIN/SUPERADMIN.
 */
@ApiTags('admin')
@Controller('admin')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN, Role.SUPPORT, Role.ANALYST)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  users(@Query('search') search?: string, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.admin.listUsers({
      search,
      skip: skip ? parseInt(skip, 10) : 0,
      take: take ? parseInt(take, 10) : 25,
    });
  }

  @Patch('users/:id/status')
  @Roles(Role.ADMIN, Role.SUPERADMIN, Role.SUPPORT)
  setStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body('status') status: 'active' | 'suspended',
  ) {
    return this.admin.setUserStatus(actor, id, status);
  }

  @Patch('users/:id/role')
  @Roles(Role.SUPERADMIN)
  setRole(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body('role') role: Role) {
    return this.admin.setUserRole(actor, id, role);
  }

  @Get('users/:id/feature-overrides')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  featureOverrides(@Param('id') id: string) {
    return this.admin.listFeatureOverrides(id);
  }

  @Post('users/:id/feature-override')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  override(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: { feature: string; enabled: boolean },
  ) {
    return this.admin.setFeatureOverride(actor, id, body.feature, body.enabled);
  }

  @Delete('users/:id/feature-override/:feature')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  clearOverride(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Param('feature') feature: string) {
    return this.admin.clearFeatureOverride(actor, id, feature);
  }

  @Get('users/:id/export')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  exportData(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.admin.exportUserData(actor, id);
  }

  @Delete('users/:id')
  @Roles(Role.SUPERADMIN)
  erase(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.admin.eraseUser(actor, id);
  }

  // Plans
  @Get('plans')
  plans() {
    return this.admin.listPlans();
  }

  @Put('plans/:id')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  updatePlan(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.admin.updatePlan(actor, id, body);
  }

  // Feature flags
  @Get('flags')
  flags() {
    return this.admin.listFlags();
  }

  @Put('flags/:key')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  upsertFlag(@CurrentUser() actor: AuthUser, @Param('key') key: string, @Body() body: any) {
    return this.admin.upsertFlag(actor, key, body);
  }

  @Get('features')
  features() {
    return this.admin.availableFeatures();
  }

  // Analytics & audit
  @Get('metrics')
  metrics() {
    return this.admin.metrics();
  }

  @Get('audit')
  audit(@Query('skip') skip?: string, @Query('take') take?: string, @Query('action') action?: string) {
    return this.admin.auditLog({
      skip: skip ? parseInt(skip, 10) : 0,
      take: take ? parseInt(take, 10) : 50,
      action,
    });
  }
}
