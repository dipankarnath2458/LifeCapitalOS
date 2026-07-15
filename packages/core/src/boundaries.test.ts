import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Kernel guardrail — DEPENDENCY BOUNDARY test. `@lcos/core` must stay pure and
 * framework/IO-free (it is imported by both the Node API and the browser web app). This
 * scans the core source and fails if any non-test file imports a framework, an IO/Node
 * builtin, or reaches into `apps/*`. Keeps the inward, acyclic dependency direction from
 * regressing.
 */
describe('dependency boundaries — @lcos/core purity', () => {
  const srcDir = dirname(fileURLToPath(import.meta.url)); // packages/core/src

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...sourceFiles(full));
      else if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.d.ts')
      ) {
        out.push(full);
      }
    }
    return out;
  }

  // Forbidden import specifiers for the pure domain core.
  const FORBIDDEN = [
    /^@nestjs\//,
    /^@prisma\//,
    /^express$/,
    /^node:/,
    /^fs$/,
    /^path$/,
    /^crypto$/,
    /apps\/(api|web)/,
    /\.\.\/\.\.\/\.\.\/apps/,
  ];
  const importRe = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;

  it('has no framework/IO/app imports in any core source file', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const text = readFileSync(file, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(text)) !== null) {
        const spec = m[1]!;
        if (FORBIDDEN.some((re) => re.test(spec))) {
          violations.push(`${file.replace(srcDir, 'src')} imports '${spec}'`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('finds core source files to scan (guards against a broken glob)', () => {
    expect(sourceFiles(srcDir).length).toBeGreaterThan(5);
  });
});
