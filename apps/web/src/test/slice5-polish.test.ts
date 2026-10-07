import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CATALOG } from '../i18n/messages';

// Resolve the stylesheet relative to THIS test file, not the CWD, so the suite passes whether vitest
// runs from apps/web or from the monorepo root (../slice0/slice0.css from src/test/).
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../slice0/slice0.css'), 'utf8');

// Extract the declaration body of a single CSS rule by selector (first match).
function ruleBody(selector: string): string {
  const i = css.indexOf(selector);
  if (i === -1) return '';
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

describe('Slice 5 freeze polish', () => {
  // A — clay (material-Evidence-movement) is NEVER used on Slice-5 active/adopted/focus/primary/Create states.
  it('A. Slice-5 state treatments use no clay semantic role', () => {
    for (const sel of ['.s0-plan-primary ', '.s0-plan-active ', '.s0-plan-focus ', '.s0-plan-focus-tag ', '.s0-today-create ']) {
      expect(ruleBody(sel)).not.toMatch(/--s0-clay/);
    }
    // and the primary action is still clearly filled/obvious (neutral warm ink), not flattened away
    expect(ruleBody('.s0-plan-primary ')).toMatch(/background:\s*var\(--s0-ink\)/);
  });

  // B — the Create boundary copy does not contain "Ready for Create" (the label carries it) → no duplication.
  it('B. Create note copy does not duplicate the "Ready for Create" label', () => {
    for (const loc of ['en', 'ro', 'it'] as const) {
      expect(CATALOG[loc]['plan.create.note']).not.toMatch(/ready for create/i);
    }
  });

  // C — Today subtitle has no defensive "not a to-do list" meta-copy.
  it('C. Today subtitle carries no product-category meta-copy', () => {
    expect(CATALOG.en['plan.today.sub']).toBe('Your next useful working session.');
    for (const loc of ['en', 'ro', 'it'] as const) {
      expect(CATALOG[loc]['plan.today.sub']).not.toMatch(/to-?do|listă de sarcini|cose da fare/i);
    }
  });
});
