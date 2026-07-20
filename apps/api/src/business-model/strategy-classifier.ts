/**
 * Wave 4 — BOUNDED strategic-job classifier (first slice). Deterministic heuristic that recognises ONLY the
 * one supported job — a business/marketing PRIORITY_DECISION — and assigns a subtype. It is intentionally NOT
 * an open-domain intent router: anything it does not recognise as a priority decision returns OUT_OF_SCOPE, and
 * the route answers with the founder-safe boundary response (no model call, no durable job).
 */
import type { StrategicSubtype } from './strategy';

export type Classification = { job: 'PRIORITY_DECISION'; subtype: StrategicSubtype } | { job: 'OUT_OF_SCOPE' };

// A decision/priority signal — the founder is weighing what to do next, not requesting an arbitrary task.
const DECISION = /\b(prioriti[sz]e?|prioriti(?:es|y)|focus|which|versus|\bvs\.?\b|\bor\b|first\b|before\b|after\b|invest in|should (?:i|we)|what should|help me decide|worth (?:it|doing|the)|is my .*aligned|aligned with|better to|next (?:30|thirty) days)\b/i;
// A business/marketing domain signal — the decision is about the business, not personal life.
const DOMAIN = /\b(instagram|linkedin|tiktok|youtube|facebook|twitter|threads|channel|platform|social media|positioning|position|messaging|brand|offer|pricing|price|package|product|launch|website|site|landing page|ads?|paid|advertis|acquisition|outreach|partnership|sales|leads?|content|seo|newsletter|audience|customers?|market|growth|revenue|funnel|conversion|campaign|30 days|priorit)\b/i;

// Subtype detection — ordered; the first matching family wins. Default GENERAL_30_DAY_PRIORITY.
const SUBTYPE_RULES: Array<{ re: RegExp; subtype: StrategicSubtype }> = [
  { re: /\b(instagram|linkedin|tiktok|youtube|facebook|twitter|threads|channel|platform|social media)\b/i, subtype: 'CHANNEL_PRIORITY' },
  { re: /\b(positioning|position|messaging|brand)\b/i, subtype: 'POSITIONING_PRIORITY' },
  { re: /\b(website|site|landing page)\b/i, subtype: 'WEBSITE_PRIORITY' },
  { re: /\b(launch)\b/i, subtype: 'LAUNCH_PRIORITY' },
  { re: /\b(offer|pricing|price|package|product)\b/i, subtype: 'OFFER_PRIORITY' },
  { re: /\b(ads?|paid|advertis|acquisition|outreach|partnership|sales|leads?|content|seo|newsletter|campaign|funnel)\b/i, subtype: 'ACQUISITION_PRIORITY' },
  { re: /\b(next (?:30|thirty) days|prioriti|focus)\b/i, subtype: 'GENERAL_30_DAY_PRIORITY' },
];

export function classifyStrategicJob(question: string): Classification {
  const q = (question ?? '').trim();
  if (q.length < 3) return { job: 'OUT_OF_SCOPE' };
  if (!DECISION.test(q) || !DOMAIN.test(q)) return { job: 'OUT_OF_SCOPE' };
  const rule = SUBTYPE_RULES.find((r) => r.re.test(q));
  return { job: 'PRIORITY_DECISION', subtype: rule ? rule.subtype : 'GENERAL_30_DAY_PRIORITY' };
}
