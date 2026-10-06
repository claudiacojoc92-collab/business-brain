import type { LandingProposition } from './contracts';

/**
 * Route licensed propositions to landing sections BY ATOM CLASS, instead of handing the generator one flat bag
 * for every section. Two purposes: (1) give each kind of fact a home — policy rules had none, so they were
 * dropped; (2) variance reduction — a section handed 13 people and told to name them drifts far less than one
 * handed 63 facts and told to write "proof". Anchored atoms route by class; synthesized / founder prose (no
 * atomClass) is general context for hero / subhead / who. Safety is unaffected — the gate still sees every
 * proposition; this only decides which section each one feeds.
 */
export interface RoutedFacts {
  readonly services: string[];      // → "what"
  readonly people: string[];        // → "proof" (name every one)
  readonly contact: string[];       // → "cta"
  readonly policy: string[];        // → "how_it_works"
  readonly locations: string[];     // → hero / subhead context
  readonly general: string[];       // synthesized / founder prose → hero / subhead / who
}

export function routeFacts(props: readonly LandingProposition[]): RoutedFacts {
  const r: { [K in keyof RoutedFacts]: string[] } = { services: [], people: [], contact: [], policy: [], locations: [], general: [] };
  for (const p of props) {
    switch (p.atomClass) {
      case 'service': r.services.push(p.text); break;
      case 'people': r.people.push(p.text); break;
      case 'contact_booking': r.contact.push(p.text); break;
      case 'policy': r.policy.push(p.text); break;
      case 'location': r.locations.push(p.text); break;
      default: r.general.push(p.text); // synthesized / founder_owned / untagged → positioning & audience
    }
  }
  return r;
}
