'use client';

import { createContext, useContext } from 'react';

export type FirmRole = 'OWNER' | 'ADVISOR' | 'ANALYST' | 'SUPPORT';

export interface FirmSummary {
  id: string;
  name: string;
  brandName: string | null;
  baseCurrency: string;
  status: string;
  firmRole: FirmRole;
}

export interface AppContextValue {
  token: string;
  /** The active firm's id (also persisted server-side as User.activeFirmId). */
  firmId: string;
  firm: FirmSummary;
  /** All firms the signed-in user belongs to (for the firm switcher). */
  firms: FirmSummary[];
}

export const AppContext = createContext<AppContextValue | null>(null);

/** Firm context provided by the /app layout. Throws if used outside it. */
export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within the /app layout');
  return ctx;
}

/** Firm roles that may create/edit households (mirrors the API's write gate). */
export function canManageBook(role: FirmRole): boolean {
  return role === 'OWNER' || role === 'ADVISOR';
}
