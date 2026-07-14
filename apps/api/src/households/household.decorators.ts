import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Household } from '@prisma/client';

/** Extracts the household resolved and scope-checked by HouseholdScopeGuard. */
export const CurrentHousehold = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Household => {
    return ctx.switchToHttp().getRequest().household;
  },
);
