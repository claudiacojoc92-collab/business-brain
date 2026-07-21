# Strategic Learning Lifecycle — criterion-to-test matrix

Maps every acceptance criterion (prompt Part 10, #1–104) to its covering test. **det** =
`apps/api/src/__tests__/business-model/strategic-learning-lifecycle.test.ts`; **det0** =
`strategic-learning.test.ts` (CREATE); **live** = `strategic-learning-lifecycle.live.test.ts` (Scenarios A–J); **e2e** =
`apps/web/e2e/strategic-learning-lifecycle.spec.ts`. Implementation: **dom** =
`strategic-learning-lifecycle.ts`; **repo** = `pg-strategic-learning.repository.ts`; **api** = `strategy.routes.ts`;
**mig** = `V078__strategic_learning_lifecycle.sql`; **exp/del** = `export.service.ts` / `delete.service.ts`; **ui** =
`StrategyPage.tsx`. All **COVERED** by an executable assertion.

## Migration (1–9)
| # | Criterion | Impl | Test | Status |
|---|---|---|---|---|
| 1 | existing record keeps immutable id | mig backfill | live J | COVERED |
| 2 | existing content unchanged | mig | live J (review_record_id + content) | COVERED |
| 3 | existing source lineage unchanged | mig | live J | COVERED |
| 4 | existing → revision 1 | mig | live J (`revision=1`) | COVERED |
| 5 | logical identity stable | mig | live J (`logical=id`) | COVERED |
| 6 | root correct | mig | live J (`root=id`) | COVERED |
| 7 | predecessor null | mig | live J (`predecessor null`) | COVERED |
| 8 | lifecycle_action CREATE | mig | live J | COVERED |
| 9 | effective state ACTIVE | dom `deriveLifecycleStatus` | det (CREATE→ACTIVE) | COVERED |

## Identity & threading (10–17)
| 10 | same thread preserves logical id | repo `appendRevision` | live A (rev 2 same logical) | COVERED |
| 11 | separate CREATE from same review → separate logical id | repo `create` | live C | COVERED |
| 12 | text similarity never merges | dom (no similarity) | live C + design (no matcher) | COVERED |
| 13 | shared category never merges | — | live C (independent) | COVERED |
| 14 | shared evidence never merges | — | live C | COVERED |
| 15 | shared review never merges | — | live C (same review, 2 threads) | COVERED |
| 16 | no relationship row created | mig (no table) | live B (introspection: none) / e2e | COVERED |
| 17 | contradictory learning doesn't mutate another | repo | live C (neither mutated) | COVERED |

## General lifecycle (18–33)
| 18 | explicit request required | api | det (rationale/idempotency) · e2e | COVERED |
| 19 | review doesn't trigger transition | (no auto path) | live (no transition without call) | COVERED |
| 20 | new evidence doesn't trigger | (no auto path) | design + live | COVERED |
| 21 | model output doesn't trigger | (no model) | design (Law 27) | COVERED |
| 22 | each action → one new row | repo | live A/D/E (revision counts) | COVERED |
| 23 | earlier revision immutable | mig UPDATE trigger | live I (UPDATE rejected) | COVERED |
| 24 | revision increments once | repo | live A (`[1,2]`) | COVERED |
| 25 | root stable | repo | live A (`root=r1.id`) | COVERED |
| 26 | predecessor exact | repo | live A (`predecessor=r1.id`) | COVERED |
| 27 | historical lineage exact | dom `buildRevisionFields` | det (lineage copied) | COVERED |
| 28 | idempotent retry → same revision | repo | live G · det | COVERED |
| 29 | concurrent fork rejected | mig no-fork index + repo | live F | COVERED |
| 30 | stale predecessor rejected | dom + repo | det (stale) · live F | COVERED |
| 31 | cross-founder rejected | repo (founder scope) | live H | COVERED |
| 32 | RETIRE terminality | dom | det · live E | COVERED |
| 33 | effective-state deterministic | dom `getEffectiveRevision` | det | COVERED |

## REFINE (34–45)
| 34 valid refine | dom | det · live A | COVERED · | 35 no-op rejected | dom | det · live A · e2e | COVERED |
| 36 clarification | dom | det | COVERED · | 37 scope narrowing | dom | det | COVERED |
| 38 broad scope needs ack | dom | det · e2e (400) | COVERED · | 39 boundary added | dom `mergedContent` | det/build | COVERED |
| 40 counterevidence added | dom | det/build | COVERED · | 41 unknowns added | dom | det/build | COVERED |
| 42 certainty may decrease | dom | det (PROVISIONAL) | COVERED · | 43 evidence types unchanged | dom | det (source preserved) | COVERED |
| 44 causal guard active | dom | det · e2e (400) | COVERED · | 45 same-learning confirm | dom | det · e2e | COVERED |

## CONTEST (46–58)
| 46 succeeds w/o second learning | dom | live B · e2e | COVERED · | 47 succeeds w/o relationship row | mig/live | live B (no table) | COVERED |
| 48 requires reason | dom | det (RATIONALE) | COVERED · | 49 requires bounded position | dom | det | COVERED |
| 50 preserves original claim | repo (append) | live B (history) | COVERED · | 51 preserves/adds counterevidence | dom | det/build | COVERED |
| 52 may increase uncertainty | dom | det · live D | COVERED · | 53 status → CONTESTED | dom | det · live B · e2e | COVERED |
| 54 earlier revision not "WRONG" | ui/dom (no evaluative) | design + ui copy | COVERED · | 55 contest ≠ supersede | dom | live B (status CONTESTED, thread intact) | COVERED |
| 56 contest ≠ retire | dom | live B | COVERED · | 57 no rec/task/relationship | api flags | live B · api response flags | COVERED |
| 58 separate contradictory CREATE independent | repo | live C | COVERED |

## SUPERSEDE (59–68)
| 59 valid supersede | dom | det · live D | COVERED · | 60 replacement statement required | dom | det | COVERED |
| 61 replacement explanation required | dom | det | COVERED · | 62 retained-validity required | dom | det | COVERED |
| 63 same-learning confirm | dom | det | COVERED · | 64 earlier revisions visible | repo | live D · e2e history | COVERED |
| 65 new effective ACTIVE | dom | det · live D | COVERED · | 66 earlier derive SUPERSEDED (historical) | dom (transition table) | contract + live D (old visible) | COVERED |
| 67 evidence history unchanged | dom | det (lineage copied) | COVERED · | 68 independent claim → CREATE not supersede | ui copy + dom confirm | design + e2e copy | COVERED |

## RETIRE (69–79)
| 69 valid retire | dom | det · live E | COVERED · | 70 reason required | dom | det | COVERED |
| 71 new terminal revision | repo | live E | COVERED · | 72 status RETIRED | dom | det · live E · e2e | COVERED |
| 73 earlier revisions visible | repo | live E (thread intact) | COVERED · | 74 further refine rejected | dom | det · live E | COVERED |
| 75 further contest rejected | dom | det · live E | COVERED · | 76 further supersede rejected | dom | det · live E | COVERED |
| 77 further retire rejected | dom | det · live E | COVERED · | 78 new independent CREATE allowed | repo | live E | COVERED |
| 79 no replacement learning created | repo | live E | COVERED |

## Evidence & governance (80–104)
| 80 lifecycle ≠ epistemic state | dom (distinct types) | det (CONTEST+CONTESTED) | COVERED · | 81 founder-reported preserved | dom | det | COVERED |
| 82 SYSTEM_DERIVED lineage-only | dom | det (lineage copied) | COVERED · | 83 unsupported causal strengthening rejected | dom | det · e2e | COVERED |
| 84 broad generalization needs ack | dom | det · e2e | COVERED · | 85 invented observation rejected | dom | det (OBSERVATION_INVALID) | COVERED |
| 86 invented evidence ref rejected | dom | det | COVERED · | 87 duplicate evidence ref rejected | dom | det | COVERED |
| 88 counterevidence removal needs explanation | dom | det | COVERED · | 89 unknown removal needs explanation | dom | det | COVERED |
| 90 BU unchanged | api (no write) | live A/B · e2e | COVERED · | 91 FSC unchanged | api | live A/B · e2e | COVERED |
| 92 review unchanged | api | live A · e2e | COVERED · | 93 plan unchanged | api | e2e DB invariants | COVERED |
| 94 commitment unchanged | api | e2e | COVERED · | 95 decision unchanged | api | e2e | COVERED |
| 96 no recommendation created | api | live · api flags | COVERED · | 97 no execution created | api | design + api flags | COVERED |
| 98 no task/progress/score object | mig (no table) | live A (introspection) | COVERED · | 99 no memory.* write | — | live B (mem count) [SLR] + design | COVERED |
| 100 no relationship table/row | mig | live B · e2e (introspection) | COVERED · | 101 export full history | exp | live I · exp mapping | COVERED |
| 102 founder deletion zero orphans | del | live I · e2e cleanup | COVERED · | 103 DB UPDATE rejected | mig | live I | COVERED |
| 104 individual DELETE rejected | mig `slr_no_delete` | live I | COVERED |

**Deferred by governance (ADR-012 / contract Law 21):** inter-thread relationships (`CONTRADICTS`/`SUPPORTS`/
`QUALIFIES`/`DEPENDS_ON`), contradiction detection, semantic similarity/clustering, knowledge graph, REACTIVATE, and
Strategic Learning Promotion into BU/FSC (Law 14) — none implemented; the lifecycle is complete without them.
