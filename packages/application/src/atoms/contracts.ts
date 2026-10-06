/**
 * ATOM EXTRACTION contracts.
 *
 * A business's verifiable OPERATIONAL ATOMS — the concrete facts a founder would recognise verbatim on
 * their own site (a service name, an address, a phone number, a booking method, a stated role). Licensed
 * into the one shared fact substrate as provenance-carrying `business_evidence`, so carousel, reel and
 * move-draft all inherit them.
 *
 * Sibling to proof extraction, but LANGUAGE-NEUTRAL by construction. The ONLY safety mechanism is
 * VERBATIM ANCHORING: an atom is licensed iff its value is a verbatim span of an ingested fragment, with
 * a stored pointer (source URL + fragment ref + exact char span). No regex language gates, no English
 * reference guard, no reported-speech templates — RO / IT / EN behave identically. The model is a
 * PROPOSER only; the deterministic anchor check decides what is licensed.
 *
 * Closed scope. Four shipped atom classes, no open-ended extraction. Adding a class later is additive
 * (one enum value + one prompt line + one test) and needs no schema change.
 */

/**
 * The shipped atom classes.
 *  - `policy`: rules of HOW the service works — group size / capacity, cancellation & rescheduling windows,
 *    arrival / lead time, booking requirements, membership terms. Concrete detail that makes a page credible
 *    (e.g. "max. 4 persoane", "anulările se realizează cu minimum 8 ore înainte"). Same verbatim anchoring.
 * Deferred (additive later): 'schedule' (opening-hours tables — weak copy, live on a subpage); 'price' —
 * NOT for staleness (their prices are published, as anchorable as a service name) but because the generator
 * must not VOLUNTEER a price into a landing page on its own initiative; that is the owner's decision, not the
 * copy's. The long-term shape is "licensed but not volunteered" (known, used only when asked), which needs
 * machinery that does not exist yet — so `price` stays deferred and fail-closed withholding handles it.
 */
export type AtomClass = 'service' | 'location' | 'contact_booking' | 'people' | 'policy';
export const ATOM_CLASSES: readonly AtomClass[] = ['service', 'location', 'contact_booking', 'people', 'policy'];

/** One readable source unit handed to the extractor (a page or a poured-in document), with resolvable
 *  provenance. (Same shape proof extraction projects; unified with proof's via the shared projection.) */
export interface AtomSourceUnit {
  readonly sourceRef: string;   // founder-readable label
  readonly sourceUrl: string;   // resolvable provenance (http URL or founder:// URI); never empty
  readonly pageType: string;
  readonly text: string;
}

/** Raw model output — a PROPOSER only. Every candidate is re-verified by verbatim anchoring before trust. */
export interface AtomCandidate {
  readonly atomClass: AtomClass;
  readonly value: string;       // MUST locate as a (whitespace-insensitive, diacritic-folded) span of the cited unit
  readonly sourceRef: string;
}
export interface AtomModelOutput { readonly atoms: AtomCandidate[]; }
/** No businessName / language is passed — the extractor is language-neutral by design. */
export interface AtomExtractionInput { readonly units: readonly AtomSourceUnit[]; }
export interface IAtomExtractionModel { extract(input: AtomExtractionInput): Promise<AtomModelOutput>; }

/**
 * A verified, licensable business atom with durable provenance (persisted, V083). The span offsets are
 * computed deterministically from the verbatim match against the cited unit's text, so
 * `unit.text.slice(charStart, charEnd) === value` holds by construction (newline preserved where the
 * value spans lines). "Where did this fact come from" is answerable from the DB alone.
 */
export interface BusinessAtom {
  readonly id: string;
  readonly businessId: string;
  readonly atomClass: AtomClass;
  readonly value: string;             // the EXACT fragment span actually licensed
  readonly sourceRef: string;
  readonly sourceUrl: string;
  readonly charStart: number;
  readonly charEnd: number;
  readonly sourceFingerprint: string; // deterministic key over the bound-fragment set (re-extract on change)
  readonly modelId: string | null;
  readonly extractedAt: string;
}

/** Persistence port — mirrors the proof-fact repo: replace-on-fingerprint-change, read-all. */
export interface IAtomRepository {
  latestFingerprint(businessId: string): Promise<string | null>;
  listAtoms(businessId: string): Promise<BusinessAtom[]>;
  replaceForBusiness(businessId: string, fingerprint: string, atoms: readonly BusinessAtom[]): Promise<void>;
}
