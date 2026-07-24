import { z } from 'zod';

/**
 * Runtime schema + parser for the deterministic Instagram-like fixture. This commit does NOT ingest
 * or persist the fixture — it only proves the fixture parses, is deterministic, and satisfies the
 * intended corpus constraints. Actual RawCapture/Observation construction is a later commit.
 */
export const FixtureMediaType = z.enum(['reel', 'carousel', 'image', 'video']);

export const FixturePostSchema = z
  .object({
    externalId: z.string().min(1),
    caption: z.string().min(1),
    mediaType: FixtureMediaType,
    occurredAt: z.string().datetime(),
    capturedAt: z.string().datetime().optional(),
  })
  .strict();

export const FixtureCorpusSchema = z
  .object({
    businessRef: z.object({ type: z.literal('business'), id: z.string().min(1) }).strict(),
    source: z.literal('instagram'),
    bio: z.string().min(1).optional(),
    posts: z.array(FixturePostSchema).min(1),
  })
  .strict()
  .superRefine((corpus, ctx) => {
    const seen = new Set<string>();
    for (const [i, post] of corpus.posts.entries()) {
      if (seen.has(post.externalId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate externalId "${post.externalId}"`,
          path: ['posts', i, 'externalId'],
        });
      }
      seen.add(post.externalId);
    }
  });

export type FixturePost = z.infer<typeof FixturePostSchema>;
export type FixtureCorpus = z.infer<typeof FixtureCorpusSchema>;

/** Parse + validate a fixture. Throws ZodError on malformed input (fail closed). */
export function parseFixture(input: unknown): FixtureCorpus {
  return FixtureCorpusSchema.parse(input);
}
