/**
 * Tiny classname combiner (no external dependency). Filters falsy values and flattens
 * arrays so components can compose conditional Tailwind classes cleanly:
 *   cn('px-4', isActive && 'bg-primary', ['rounded', size === 'lg' && 'text-lg'])
 */
export type ClassValue = string | number | null | false | undefined | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue): void => {
    if (v === null || v === undefined || v === false || v === '') return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    out.push(String(v));
  };
  inputs.forEach(walk);
  return out.join(' ');
}
