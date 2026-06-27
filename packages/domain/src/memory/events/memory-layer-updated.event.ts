import type { MemoryLayer } from '@bb/shared';

export interface MemoryLayerUpdatedPayload {
  founderId: string;
  layer: MemoryLayer;
  newConfidence: number;
  dataPoints: number;
  updatedAt: Date;
}

export function buildMemoryLayerUpdatedEvent(
  p: MemoryLayerUpdatedPayload,
): MemoryLayerUpdatedPayload {
  return p;
}
