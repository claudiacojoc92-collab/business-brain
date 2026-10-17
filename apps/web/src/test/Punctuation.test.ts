import { describe, it, expect } from 'vitest';
import { tidyPunctuation, endSentence } from '../slice0/punctuation';

describe('punctuation after composition (2026-10-17)', () => {
  it('a sentence mark followed by a period keeps the mark; doubled periods collapse; an ellipsis stays', () => {
    expect(tidyPunctuation('Evaluarea: filtru bun sau pas în plus?. Kinetoterapia cere un pas plătit.')).toBe('Evaluarea: filtru bun sau pas în plus? Kinetoterapia cere un pas plătit.');
    expect(tidyPunctuation('Masajul: serviciu adițional sau linie separată?.')).toBe('Masajul: serviciu adițional sau linie separată?');
    expect(tidyPunctuation('Done.. Next!.')).toBe('Done. Next!');
    expect(tidyPunctuation('Wait... and see.')).toBe('Wait... and see.');
    expect(tidyPunctuation('A list ; then more .')).toBe('A list; then more.');
  });
  it('a composed headline gets a period only when it has no mark of its own', () => {
    expect(endSentence('Evaluarea: filtru bun sau pas în plus?')).toBe('Evaluarea: filtru bun sau pas în plus?');
    expect(endSentence('Masajul ca linie separată')).toBe('Masajul ca linie separată.');
  });
});
