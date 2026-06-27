import type { FounderSnapshot } from '../pipeline-context';

/**
 * Session-scoped pseudonymiser.
 * Replaces PII with placeholder tokens before LLM calls (F008).
 * MUST be destroyed (destroy()) in the pipeline finally{} block.
 * The mapping is never logged, serialised, or persisted.
 * Source: Implementation Spec V1 Section 14, Corrections Addendum V1 F008.
 */
export class Pseudonymiser {
  private readonly mapping = new Map<string, string>();

  pseudonymise(snapshot: FounderSnapshot): FounderSnapshot {
    const replace = (original: string, token: string): string => {
      if (original) this.mapping.set(original, token);
      return token;
    };

    return {
      ...snapshot,
      name:         replace(snapshot.name,         '[FOUNDER_NAME]'),
      businessName: replace(snapshot.businessName, '[BUSINESS_NAME]'),
      offer: {
        ...snapshot.offer,
        name:           replace(snapshot.offer.name,           '[OFFER_NAME]'),
        primaryPromise: replace(snapshot.offer.primaryPromise, '[OFFER_PROMISE]'),
      },
      audience: {
        ...snapshot.audience,
        description: replace(snapshot.audience.description, '[AUDIENCE_DESC]'),
      },
      conviction: {
        ...snapshot.conviction,
        statement: replace(snapshot.conviction.statement, '[CONVICTION_STATEMENT]'),
      },
    };
  }

  /**
   * Restore pseudonymised tokens to real values in LLM output.
   * Called by S11 (DecisionCommit) before persisting the brief.
   */
  restore(text: string): string {
    let result = text;
    for (const [original, token] of this.mapping) {
      result = result.replaceAll(token, original);
    }
    return result;
  }

  /**
   * Destroy the session mapping.
   * Called in the pipeline finally{} block — always, success or failure.
   */
  destroy(): void {
    this.mapping.clear();
  }
}
