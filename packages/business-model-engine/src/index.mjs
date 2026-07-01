// Re-export the frozen engine surface. This file only re-exports — it adds no logic.
export { buildSystemPrompt, buildUserMessage } from './prompt.mjs';
export {
  DECLARED_PATTERN,
  EvidenceRefSchema,
  FieldSchema,
  InsightSchema,
  ContextItemSchema,
  SINGLE_FIELDS,
  ARRAY_FIELDS,
  INSIGHT_FIELDS,
  validateModel,
} from './schema.mjs';
