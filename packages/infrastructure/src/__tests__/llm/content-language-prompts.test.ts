// Language rule (2026-10-07): every model writes in the business's CONTENT language it is given, decided once per
// business — never "the language of the founder's latest message / own words / sources". Live finding: the
// conversation prompt answered "ok, mersi" with an English label over Romanian bullets because it chased the
// founder's message language. This pins the five prompts that used to.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(__dirname, '../../business-intelligence');
const PROMPTS = ['conversation', 'correction-reflection', 'mirror', 'strategy', 'email'];
const PER_MESSAGE = [/SAME language as the founder/i, /founder'?s? (LATEST|MOST RECENT|last) message/i, /language of the SOURCES/i, /only if (their|that) (language )?is unclear/i, /in the source language/i];

describe('model prompts write in the business content language, never the message language', () => {
  for (const name of PROMPTS) {
    it(name, () => {
      const src = readFileSync(resolve(DIR, `anthropic-${name}.model.ts`), 'utf8')
        .replace(/never the language of the founder\\'s last message if that differs/, '')      // the explicit prohibitions
        .replace(/it does NOT follow the language of the founder's latest message/, '');
      for (const re of PER_MESSAGE) expect(src).not.toMatch(re);
      expect(src).toMatch(/\$\{l\}/); // the given language is what the prompt uses
    });
  }
});
