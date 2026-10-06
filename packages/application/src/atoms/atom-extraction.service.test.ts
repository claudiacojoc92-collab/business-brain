import { describe, it, expect } from 'vitest';
import type { EvidenceFragment } from '@bb/domain';
import { AtomExtractionService } from './atom-extraction.service';
import type { AtomCandidate, BusinessAtom, IAtomRepository } from './contracts';

// A single ingested page (supplied fragment → one SourceUnit via toSourceUnits). Mirrors the real Despre page:
// a generic group phrase, three named people with roles, inconsistent diacritics ("in"/"Postnatala" without the
// marks next to "și" with it), and a CAROUSEL DUPLICATE of one person (the real page duplicates 8 of 13).
const DESPRE =
  'Echipa Body Move Studio este formată din specialiști\n' +
  'Bogdan Borsan\nSpecialist Kinetoterapeut, Antrenor Fitness si Specialist Masseur\n' +
  'Cristina Muresan\nFiziokinetoterapeut specializat in Recuperare Pre și Postnatala\n' +
  'Florin Laza\nKinetoterapeut\n' +
  'Bogdan Borsan\nSpecialist Kinetoterapeut, Antrenor Fitness si Specialist Masseur';
const URL = 'https://bodymovestudio.ro/despre';

const frag = (): EvidenceFragment => ({
  id: 'frag1', founderId: 'f', source: 'upload', platform: null, sourceUrl: URL,
  confidenceKind: 'observed' as never, occurredAt: null, capturedAt: new Date(0),
  visibility: 'business' as never, payload: { ref: 'Despre', text: DESPRE }, derivedFrom: null,
});

function repo(): IAtomRepository & { saved: BusinessAtom[] } {
  let saved: BusinessAtom[] = [];
  return {
    get saved() { return saved; },
    latestFingerprint: async () => null,
    listAtoms: async () => saved,
    replaceForBusiness: async (_b, _fp, atoms) => { saved = [...atoms]; },
  };
}
const model = (atoms: AtomCandidate[]) => ({ extract: async () => ({ atoms }) });
const svc = (atoms: AtomCandidate[], log?: (e: { type: string; detail?: string }) => void) =>
  new AtomExtractionService({
    links: { listFragmentIds: async () => ['frag1'] } as never,
    evidence: { findByIds: async () => [frag()] } as never,
    model: model(atoms), repo: repo(), modelId: 'test-model', clock: () => '2026-10-06T00:00:00.000Z', log,
  });

describe('AtomExtractionService — verbatim anchoring', () => {
  it('licenses the three named people with their roles, each with a correct span', async () => {
    const md = svc([
      { atomClass: 'people', value: 'Bogdan Borsan Specialist Kinetoterapeut, Antrenor Fitness si Specialist Masseur', sourceRef: 'Despre' },
      { atomClass: 'people', value: 'Cristina Muresan Fiziokinetoterapeut specializat în Recuperare Pre și Postnatală', sourceRef: 'Despre' },
      { atomClass: 'people', value: 'Florin Laza Kinetoterapeut', sourceRef: 'Despre' },
    ]);
    const atoms = await md.facts('b1');
    expect(atoms).toHaveLength(3);
    // span correctness: the stored value is EXACTLY the fixture slice (newlines preserved) for every atom
    for (const a of atoms) expect(DESPRE.slice(a.charStart, a.charEnd)).toBe(a.value);
    expect(atoms.map((a) => a.atomClass)).toEqual(['people', 'people', 'people']);
    expect(atoms.every((a) => a.sourceUrl === URL)).toBe(true);
  });

  it('inconsistent diacritics: matches folded, STORES AS WRITTEN', async () => {
    const md = svc([
      { atomClass: 'people', value: 'Cristina Muresan Fiziokinetoterapeut specializat în Recuperare Pre și Postnatală', sourceRef: 'Despre' },
    ]);
    const [a] = await md.facts('b1');
    // proposed with diacritics ("în"/"Postnatală"); licensed value is the page's as-written form ("in"/"Postnatala")
    expect(a?.value).toContain('specializat in Recuperare Pre și Postnatala');
    expect(a?.value).not.toContain('Postnatală');
    expect(DESPRE.slice(a!.charStart, a!.charEnd)).toBe(a!.value);
  });

  it('dedup: identical (class, value) collapses to one atom, keeping the FIRST span', async () => {
    const dup = 'Bogdan Borsan Specialist Kinetoterapeut, Antrenor Fitness si Specialist Masseur';
    const md = svc([
      { atomClass: 'people', value: dup, sourceRef: 'Despre' },
      { atomClass: 'people', value: dup, sourceRef: 'Despre' }, // carousel duplicate
    ]);
    const atoms = await md.facts('b1');
    expect(atoms).toHaveLength(1);
    expect(atoms[0]?.charStart).toBe(DESPRE.indexOf('Bogdan Borsan')); // the FIRST occurrence, not the second
  });

  it('no fabrication: a proposal that is NOT a verbatim span is DROPPED, never repaired', async () => {
    const md = svc([
      { atomClass: 'people', value: 'Florin Laza Kinetoterapeut', sourceRef: 'Despre' }, // real
      { atomClass: 'people', value: 'Ana Ionescu Osteopat', sourceRef: 'Despre' },       // fabricated — not on the page
    ]);
    const atoms = await md.facts('b1');
    expect(atoms).toHaveLength(1);
    expect(atoms[0]?.value).toContain('Florin Laza');
    expect(atoms.some((a) => a.value.includes('Ana Ionescu'))).toBe(false);
  });

  it('closed scope: a proposal with an out-of-scope class is dropped', async () => {
    const md = svc([
      { atomClass: 'price' as never, value: 'Florin Laza Kinetoterapeut', sourceRef: 'Despre' }, // price deferred
      { atomClass: 'people', value: 'Florin Laza Kinetoterapeut', sourceRef: 'Despre' },
    ]);
    const atoms = await md.facts('b1');
    expect(atoms).toHaveLength(1);
    expect(atoms[0]?.atomClass).toBe('people');
  });

  it('exact-case preference: a capitalized label beats an earlier lowercase prose mention', async () => {
    // "masaj"/"kinetoterapie" appear lowercase in prose BEFORE the capitalized service labels.
    const page = 'Oferim kinetoterapie si masaj pentru toți. Servicii principale: Kinetoterapie si Masaj.';
    const svc2 = new AtomExtractionService({
      links: { listFragmentIds: async () => ['p'] } as never,
      evidence: { findByIds: async () => [{ ...frag(), id: 'p', payload: { ref: 'home', text: page } }] } as never,
      model: model([
        { atomClass: 'service', value: 'Kinetoterapie', sourceRef: 'home' },
        { atomClass: 'service', value: 'Masaj', sourceRef: 'home' },
      ]), repo: repo(), clock: () => '2026-10-06T00:00:00.000Z',
    });
    const atoms = await svc2.facts('b1');
    expect(atoms.map((a) => a.value)).toEqual(['Kinetoterapie', 'Masaj']); // capitals preserved, not the lowercase prose
    for (const a of atoms) expect(page.slice(a.charStart, a.charEnd)).toBe(a.value);
  });

  it('lenient ref resolution: a trailing parenthetical resolves to the one matching unit', async () => {
    const svc2 = new AtomExtractionService({
      links: { listFragmentIds: async () => ['p'] } as never,
      evidence: { findByIds: async () => [{ ...frag(), id: 'p', payload: { ref: 'Homepage', text: 'Servicii: Kinetoterapie.' } }] } as never,
      model: model([{ atomClass: 'service', value: 'Kinetoterapie', sourceRef: 'Homepage (home)' }]), // model echoed the pageType
      repo: repo(), clock: () => '2026-10-06T00:00:00.000Z',
    });
    const atoms = await svc2.facts('b1');
    expect(atoms).toHaveLength(1);
    expect(atoms[0]?.value).toBe('Kinetoterapie');
  });

  it('lenient resolution never guesses: an unresolved OR ambiguous ref is dropped as dropped_unit', async () => {
    const logs: { type: string; detail?: string }[] = [];
    const svc2 = new AtomExtractionService({
      links: { listFragmentIds: async () => ['a', 'b'] } as never,
      // two units whose refs NORMALIZE to the same key ("home") — an ambiguous target
      evidence: { findByIds: async () => [
        { ...frag(), id: 'a', payload: { ref: 'Home', text: 'Kinetoterapie' } },
        { ...frag(), id: 'b', payload: { ref: 'home (x)', text: 'Masaj' } },
      ] } as never,
      model: model([
        { atomClass: 'service', value: 'Kinetoterapie', sourceRef: 'home' },  // ambiguous → 2 units → drop
        { atomClass: 'service', value: 'Masaj', sourceRef: 'nowhere' },        // unresolved → 0 units → drop
      ]), repo: repo(), clock: () => '2026-10-06T00:00:00.000Z', log: (e) => logs.push(e),
    });
    const atoms = await svc2.facts('b1');
    expect(atoms).toHaveLength(0);
    expect(logs.find((l) => l.type === 'atoms_extracted')?.detail).toContain('dropped_unit=2');
  });

  it('instruments the drop rate: proposed vs licensed, with the breakdown', async () => {
    const logs: { type: string; detail?: string }[] = [];
    const md = svc([
      { atomClass: 'people', value: 'Florin Laza Kinetoterapeut', sourceRef: 'Despre' }, // licensed
      { atomClass: 'people', value: 'Ana Ionescu Osteopat', sourceRef: 'Despre' },        // dropped: not verbatim
      { atomClass: 'people', value: 'Bogdan Borsan Specialist Kinetoterapeut, Antrenor Fitness si Specialist Masseur', sourceRef: 'nope' }, // dropped: unknown unit
    ], (e) => logs.push(e));
    await md.facts('b1');
    const line = logs.find((l) => l.type === 'atoms_extracted');
    expect(line?.detail).toContain('proposed=3');
    expect(line?.detail).toContain('licensed=1');
    expect(line?.detail).toContain('dropped_anchor=1');
    expect(line?.detail).toContain('dropped_unit=1');
  });
});
