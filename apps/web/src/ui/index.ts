/**
 * Life Capital OS — V2 UI Design System.
 *
 * Single import surface for tokens, theme, primitives, and layout. Example:
 *   import { Button, Card, DashboardLayout, ThemeProvider } from '@/ui';
 *
 * Presentational only — no business logic, no API/data calls, no schema coupling.
 */

// Utilities & tokens
export { cn, type ClassValue } from './cn';
export * from './tokens';
export * as Icons from './icons';

// Theme
export {
  ThemeProvider,
  ThemeScript,
  useTheme,
  type ThemePreference,
  type ResolvedTheme,
} from './theme/ThemeProvider';
export { ThemeToggle } from './theme/ThemeToggle';

// Components
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './components/Button';
export {
  Field,
  Input,
  Textarea,
  Select,
  LabeledInput,
  type InputProps,
  type TextareaProps,
  type SelectProps,
  type FieldProps,
} from './components/Input';
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  StatCard,
  type CardProps,
  type CardVariant,
} from './components/Card';
export { Badge, type BadgeProps, type BadgeTone, type BadgeVariant } from './components/Badge';
export { Modal, type ModalProps, type ModalSize } from './components/Modal';
export {
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  DataTable,
  type Column,
  type DataTableProps,
} from './components/Table';
export {
  Spinner,
  Skeleton,
  LoadingState,
  LoadingOverlay,
  type SpinnerProps,
  type SkeletonProps,
} from './components/Spinner';
export { EmptyState, ErrorState } from './components/States';
export { Heading, Text, type HeadingProps, type TextProps } from './components/Text';

// Layout
export { DashboardLayout, type DashboardLayoutProps } from './layout/DashboardLayout';
export { Sidebar, type SidebarProps } from './layout/Sidebar';
export { TopNav, type TopNavProps } from './layout/TopNav';
export { MobileNav, type MobileNavProps } from './layout/MobileNav';
export type { NavItem, NavSection } from './layout/types';
