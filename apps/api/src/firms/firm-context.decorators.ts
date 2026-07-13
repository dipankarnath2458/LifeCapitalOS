import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { FirmRole } from '@prisma/client';

/**
 * Restricts a firm-scoped route to callers whose Membership carries one of the
 * given firm roles. Enforced by FirmContextGuard (which must guard the route).
 */
export const FIRM_ROLES_KEY = 'firmRoles';
export const FirmRoles = (...roles: FirmRole[]) => SetMetadata(FIRM_ROLES_KEY, roles);

/** The active firm context resolved by FirmContextGuard for the request. */
export interface FirmContext {
  firmId: string;
  firmRole: FirmRole;
  membershipId: string;
}

/** Extracts the FirmContext attached by FirmContextGuard. */
export const CurrentFirm = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): FirmContext => {
    return ctx.switchToHttp().getRequest().firmContext;
  },
);
