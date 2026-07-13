import { createElement, type HTMLAttributes } from 'react';
import { cn } from '../cn';
import { typography, type TypographyRole } from '../tokens';

type HeadingLevel = 1 | 2 | 3 | 4;
const headingRole: Record<HeadingLevel, TypographyRole> = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4' };

export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  level?: HeadingLevel;
  /** Use the larger `display` role instead of the h1 scale. */
  display?: boolean;
}

/** Semantic heading whose size follows the typography scale (`level` sets the tag). */
export function Heading({ level = 2, display, className, children, ...rest }: HeadingProps) {
  const role: TypographyRole = display ? 'display' : headingRole[level];
  return createElement(
    `h${level}`,
    { className: cn(typography[role], 'text-foreground', className), ...rest },
    children,
  );
}

export interface TextProps extends HTMLAttributes<HTMLElement> {
  /** Typography role from the scale (default `body`). */
  role?: Extract<TypographyRole, 'lead' | 'body' | 'small' | 'caption' | 'overline'>;
  /** Render as a different element (default `<p>`). */
  as?: 'p' | 'span' | 'div' | 'label';
  muted?: boolean;
}

/** Body text at a chosen role from the typography scale. */
export function Text({ role = 'body', as = 'p', muted, className, children, ...rest }: TextProps) {
  return createElement(
    as,
    { className: cn(typography[role], muted && 'text-subtle', className), ...rest },
    children,
  );
}
