import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FirmRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators';
import { FIRM_ROLES_KEY } from '../firms/firm-context.decorators';

/** Firm roles that may read every household in the firm (not just assigned ones). */
const FIRM_WIDE_READ: FirmRole[] = ['OWNER', 'ANALYST'];

/**
 * Guards a single-household route (`/households/:id`). Resolves the household,
 * derives its firm, and requires the caller to have an active Membership in that
 * firm. Read scope is then intersected with the caller's assignment: OWNER and
 * ANALYST see any household in the firm; ADVISOR and SUPPORT see only households
 * they are the assigned advisor of. A household the caller can't see responds 404
 * so neither its existence nor another advisor's book leaks (NFR-2, doc 04 §3/§4).
 *
 * Attaches `req.firmContext` ({ firmId, firmRole, membershipId }) and
 * `req.household`. When the route carries `@FirmRoles(...)`, the caller's firm
 * role must be in that set (enforced after scope) — used to gate mutations.
 */
@Injectable()
export class HouseholdScopeGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!user) throw new ForbiddenException();

    const householdId: string | undefined = req.params?.id ?? req.params?.householdId;
    if (!householdId) throw new NotFoundException('Household not found');

    const household = await this.prisma.household.findUnique({ where: { id: householdId } });
    if (!household || household.status === 'deleted') {
      throw new NotFoundException('Household not found');
    }

    const membership = await this.prisma.membership.findUnique({
      where: { firmId_userId: { firmId: household.firmId, userId: user.id } },
    });
    if (!membership || membership.status !== 'active') {
      throw new NotFoundException('Household not found');
    }

    const firmWide = FIRM_WIDE_READ.includes(membership.firmRole);
    const assigned = household.advisorId === user.id;
    if (!firmWide && !assigned) {
      // In-firm but out of the caller's assigned scope: 404, not 403, so we don't
      // reveal which households exist outside their book.
      throw new NotFoundException('Household not found');
    }

    req.firmContext = {
      firmId: household.firmId,
      firmRole: membership.firmRole,
      membershipId: membership.id,
    };
    req.household = household;

    const requiredRoles = this.reflector.getAllAndOverride<FirmRole[]>(FIRM_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(membership.firmRole)) {
      throw new ForbiddenException('Insufficient firm role');
    }

    return true;
  }
}
