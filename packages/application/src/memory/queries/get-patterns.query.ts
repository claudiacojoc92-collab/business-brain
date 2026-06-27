import type { Query } from '../../shared/query-bus';
import type { MemoryLayer } from '@bb/shared';
import type { PatternStatus } from '@bb/domain';

export interface GetPatternsQuery extends Query {
  readonly type: 'GetPatterns';
  readonly founderId: string;
  readonly layer?: MemoryLayer;
}

export interface PatternDTO {
  patternId: string;
  layer: MemoryLayer;
  domainConcept: string;
  direction: string;
  status: PatternStatus;
  confidence: number;
  observationCount: number;
  description: string;
}
