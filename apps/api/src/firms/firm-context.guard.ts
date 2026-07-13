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
import { FIRM_ROLES_KEY } from './firm-context.decorators';

/**
 * Resolves the active firm for a request and verifies the caller belongs to it.
 *
 * The target firm is taken from the route (`:firmId` or `:id`), else the
 * `x-firm-id` header, else the user's persisted `activeFirmId`. The caller must
 * have an active Membership in that firm; if not, the route responds 404 so a
 * firm's existence never leaks across tenants (NFR-2, doc 04 §4). The resolved
 * `{ firmId, firmRole, membershipId }` is attached as `req.firmContext`.
 *
 * When a route is annotated with `@FirmRoles(...)`, the caller's firm role must
 * be in that set or the request is rejected with 403.
 */
@Injectable()
export class FirmContextGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!user) throw new ForbiddenException();

    const firmId: string | undefined =
      req.params?.firmId ?? req.params?.id ?? req.headers?.['x-firm-id'] ?? user.activeFirmId ?? undefined;
    if (!firmId) throw new NotFoundException('Firm not found');

    const membership = await this.prisma.membership.findUnique({
      where: { firmId_userId: { firmId, userId: user.id } },
    });
    // Deny-by-default: no membership (or a disabled one) is indistinguishable
    // from a non-existent firm to avoid cross-tenant existence leaks.
    if (!membership || membership.status !== 'active') {
      throw new NotFoundException('Firm not found');
    }

    req.firmContext = {
      firmId,
      firmRole: membership.firmRole,
      membershipId: membership.id,
    };

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
