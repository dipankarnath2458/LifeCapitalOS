'use client';

import { createContext, useContext } from 'react';

/** The signed-in admin's role, shared from the /admin layout to the pages below it. */
export const AdminRoleContext = createContext<string | null>(null);

export function useAdminRole(): string | null {
  return useContext(AdminRoleContext);
}

export function isSuperadmin(role: string | null | undefined): boolean {
  return role === 'SUPERADMIN';
}

/** ADMIN or SUPERADMIN — the roles allowed to manage plans, flags and feature overrides. */
export function isAdminLevel(role: string | null | undefined): boolean {
  return role === 'ADMIN' || role === 'SUPERADMIN';
}
