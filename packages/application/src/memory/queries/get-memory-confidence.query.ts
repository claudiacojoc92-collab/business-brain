import type { Query } from '../../shared/query-bus';
import type { MemoryLayer } from '@bb/shared';

export interface GetMemoryConfidenceQuery extends Query {
  readonly type: 'GetMemoryConfidence';
  readonly founderId: string;
}

export interface MemoryConfidenceDTO {
  founderId: string;
  compositeConfidence: number;
  layers: {
    layer: MemoryLayer;
    confidence: number;
    dataPoints: number;
    lastUpdatedAt: Date;
  }[];
}
