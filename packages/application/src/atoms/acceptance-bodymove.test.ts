import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EvidenceFragment } from '@bb/domain';
import { AtomExtractionService } from './atom-extraction.service';
import type { AtomCandidate, BusinessAtom, IAtomRepository } from './contracts';

/**
 * ACCEPTANCE — the extractor against REAL Body Move page text, derived from the BB production export
 * (intent/2026-10-06-licensed-atoms/fixtures/*.ingested.txt — public page text only, nothing internal). This
 * is deterministic (a scripted proposer) so it runs in CI; it proves the service LICENSES strings that are
 * really in the ingested text, with correct spans, and DROPS what is not. The real-model recall is a separate
 * live run (reported, not committed — non-deterministic, needs the API key).
 *
 * INGESTION REALITY this fixture encodes (see the plan status log): production ingested the service names, the
 * team names+roles and the Evo Beauty booking sentence, but NOT the street addresses, phone or email — those
 * live behind "Vezi locația"/footer links the ingest did not capture. So the extractor cannot license an
 * address that is not in the text; that is an INGESTION gap, not an extractor gap.
 */
const FIX = resolve(process.cwd(), 'intent/2026-10-06-licensed-atoms/fixtures');
const HOME = readFileSync(resolve(FIX, 'bodymove-home.ingested.txt'), 'utf8');
const DESPRE = readFileSync(resolve(FIX, 'bodymove-despre.ingested.txt'), 'utf8');

const supplied = (ref: string, url: string, text: string): EvidenceFragment => ({
  id: ref, founderId: 'f', source: 'upload', platform: null, sourceUrl: url,
  confidenceKind: 'observed' as never, occurredAt: null, capturedAt: new Date(0),
  visibility: 'business' as never, payload: { ref, text }, derivedFrom: null,
});
function repo(): IAtomRepository {
  let saved: BusinessAtom[] = [];
  return { latestFingerprint: async () => null, listAtoms: async () => saved, replaceForBusiness: async (_b, _f, a) => { saved = [...a]; } };
}
const svc = (atoms: AtomCandidate[]) => new AtomExtractionService({
  links: { listFragmentIds: async () => ['home', 'despre'] } as never,
  evidence: { findByIds: async () => [supplied('home', 'https://bodymovestudio.ro/', HOME), supplied('despre', 'https://bodymovestudio.ro/despre-noi/', DESPRE)] } as never,
  model: { extract: async () => ({ atoms }) }, repo: repo(), modelId: 'acceptance',
});

describe('ACCEPTANCE — licensed atoms from real Body Move ingested text', () => {
  it('licenses the services, people and booking that ARE in the ingested text, each with a correct span', async () => {
    const atoms = await svc([
      { atomClass: 'service', value: 'Clase & Personal Training', sourceRef: 'home' },
      { atomClass: 'service', value: 'Kinetoterapie', sourceRef: 'home' },
      { atomClass: 'service', value: 'Gimnastică Prenatală & Recuperare Postpartum', sourceRef: 'home' },
      { atomClass: 'service', value: 'Masaj', sourceRef: 'home' },
      { atomClass: 'contact_booking', value: 'Programările se realizează online prin aplicația Evo Beauty sau prin contactarea recepției.', sourceRef: 'home' },
      { atomClass: 'people', value: 'Bogdan Borsan Specialist Kinetoterapeut, Antrenor Fitness si Specialist Masseur', sourceRef: 'despre' },
      // proposed WITH diacritics — must license the AS-WRITTEN form (in / Postnatala), matching folded
      { atomClass: 'people', value: 'Cristina Muresan Fiziokinetoterapeut specializat în Recuperare Pre și Postnatală', sourceRef: 'despre' },
      { atomClass: 'people', value: 'Florin Laza Kinetoterapeut', sourceRef: 'despre' },
    ]).facts('bodymove');

    const byClass = (c: string) => atoms.filter((a) => a.atomClass === c).map((a) => a.value);
    // Each service is licensed. NOTE: anchoring takes the FIRST verbatim (folded) occurrence, so a one-word
    // service that also appears lowercase in prose ("kinetoterapie", "masaj") stores that prose-case form, not
    // the title-case label — a real behaviour, surfaced not smoothed. Assert by folded value + span-correctness.
    const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const services = byClass('service').map(fold);
    for (const s of ['clase & personal training', 'kinetoterapie', 'gimnastica prenatala & recuperare postpartum', 'masaj']) expect(services).toContain(s);
    expect(byClass('contact_booking')[0]).toContain('aplicația Evo Beauty');
    expect(byClass('people')).toHaveLength(3);
    // inconsistent diacritics: stored AS WRITTEN in the ingest ("in"/"Postnatala"), not the proposer's diacritics
    const cristina = atoms.find((a) => a.value.startsWith('Cristina'));
    expect(cristina?.value).toContain('specializat in Recuperare Pre și Postnatala');
    expect(cristina?.value).not.toContain('Postnatală');
    // span correctness against the real fixture, for every licensed atom
    const text = (a: BusinessAtom) => (a.sourceRef === 'despre' ? DESPRE : HOME);
    for (const a of atoms) expect(text(a).slice(a.charStart, a.charEnd)).toBe(a.value);
  });

  it('DROPS what is not in the ingested text — no fabricated person, no address the ingest never captured', async () => {
    const atoms = await svc([
      { atomClass: 'people', value: 'Florin Laza Kinetoterapeut', sourceRef: 'despre' },     // real
      { atomClass: 'people', value: 'Ana Ionescu Osteopat', sourceRef: 'despre' },           // fabricated
      { atomClass: 'location', value: 'Strada Decebal nr. 110, Cluj-Napoca', sourceRef: 'home' }, // full address NOT ingested
    ]).facts('bodymove');
    expect(atoms).toHaveLength(1);
    expect(atoms[0]?.value).toContain('Florin Laza');
    expect(atoms.some((a) => a.value.includes('Ana Ionescu'))).toBe(false);
    expect(atoms.some((a) => a.atomClass === 'location')).toBe(false);
  });

  it('documents the ingestion gap: full addresses / phone / email are NOT in the ingested fixture', () => {
    const both = `${HOME}\n${DESPRE}`;
    expect(both).not.toContain('Tonitza');                 // the second address — absent from the ingest
    expect(both).not.toMatch(/\+?40?[\s.\-]?7\d{2}[\s.\-]?\d{3}[\s.\-]?\d{3}/); // no phone number
    expect(both).not.toContain('contact@bodymovestudio.ro'); // no email
  });
});
