import type { ReactNode } from 'react';

/** A single navigation entry shared by Sidebar and MobileNav. */
export interface NavItem {
  label: string;
  href: string;
  icon?: ReactNode;
  /** Optional count/label badge (e.g. unread, "New"). */
  badge?: ReactNode;
}

/** A grouped set of nav items with an optional section label. */
export interface NavSection {
  title?: string;
  items: NavItem[];
}
