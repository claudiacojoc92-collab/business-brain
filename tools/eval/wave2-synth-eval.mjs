import Anthropic from '@anthropic-ai/sdk';
const MODEL = process.env.SYNTHESIS_MODEL || 'claude-sonnet-4-6';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = [
 "You are Business Brain's synthesis layer. From a business's OWN material (website), produce a SMALL set",
 '(at most 9) of founder-legible conclusions about the business. Synthesize — never echo raw page text.',
 '','Band every conclusion by epistemicStatus:',
 '- OBSERVED: stated directly in the material.',
 '- SYNTHESIZED_FROM_OBSERVED: your reading across the material (grounded, but your interpretation).',
 '- HYPOTHESIS: a plausible guess to test with the founder.',
 '- NEEDS_MORE_EVIDENCE: you cannot responsibly claim it yet.','',
 'HARD RULE: a website shows what a business SAYS about itself, not the market. NEVER present market',
 'position, market opportunity, or audience response as OBSERVED or SYNTHESIZED_FROM_OBSERVED — at most',
 'HYPOTHESIS or NEEDS_MORE_EVIDENCE. Cite grounding with evidenceRefs using ONLY the [fragment-id] tokens',
 'provided. Prefer specificity and usefulness over surprise; do not flatter or manufacture insight.','',
 'Return ONLY JSON: {"conclusions":[{"type","statement","epistemicStatus","evidenceRefs":[],"confidence"}]}',
 'type ∈ what_it_is|what_it_offers|who_it_addresses|promise|positioning_clarity|inconsistency|',
 'underused_strength|missing_information|strategic_question|market_position|market_opportunity|audience_response.',
 'confidence ∈ low|medium|high.',
].join('\n');

const MARKET = new Set(['market_position','market_opportunity','audience_response']);
const TYPES = new Set(['what_it_is','what_it_offers','who_it_addresses','promise','positioning_clarity','inconsistency','underused_strength','missing_information','strategic_question','market_position','market_opportunity','audience_response']);
const STATUSES = new Set(['OBSERVED','SYNTHESIZED_FROM_OBSERVED','HYPOTHESIS','NEEDS_MORE_EVIDENCE']);
function normalize(raw, srcIds){ const known=new Set(srcIds); const out=[]; for(const r of raw){ if(!r||typeof r!=='object')continue; const type=String(r.type); const st=(typeof r.statement==='string'?r.statement.trim():''); if(!TYPES.has(type)||!st)continue; let status=String(r.epistemicStatus); if(!STATUSES.has(status))continue; const refs=Array.isArray(r.evidenceRefs)?r.evidenceRefs.filter(x=>known.has(x)):[]; if(MARKET.has(type)&&(status==='OBSERVED'||status==='SYNTHESIZED_FROM_OBSERVED'))status='HYPOTHESIS'; if((status==='OBSERVED'||status==='SYNTHESIZED_FROM_OBSERVED')&&refs.length===0)continue; out.push({type,statement:st,epistemicStatus:status,evidenceRefs:refs,confidence:r.confidence||'low'}); if(out.length>=9)break; } return out; }

const F = {
 clear: [['h','(home) Fractional CFO services for seed-stage SaaS startups. Monthly financial modeling, fundraising prep, and board reporting from $2,500/mo.'],['a','(about) Run by an ex-Big-4 CFO. We plug in 2 days a week for founders who are not ready for a full-time hire.']],
 ambiguous: [['h','(home) We tell stories that move people. A creative studio for brands that dare.'],['a','(about) Strategy, design, magic. We partner with visionaries.']],
 sparse: [['h','(home) Welcome to Rivera Consulting.']],
 conflicting: [['h','(home) Bespoke, premium branding for luxury clients — every engagement is fully custom, starting at $25,000.'],['p','(pricing) Grab our $19 logo template pack — DIY branding for anyone on a budget.']],
 empty: [],
};

function evidenceStr(pairs){ return pairs.map(([id,t])=>`[${id}] (website) ${t}`).join('\n'); }
async function run(fid, pairs){
  const srcIds = pairs.map(p=>p[0]);
  if(srcIds.length===0){ return { fid, insufficient:true }; }
  const user = `EVIDENCE (cite by [id]):\n${evidenceStr(pairs)}\n\nENGINE INFERENCE:\n(none)\n\nEngine confidence: thin\n\nReturn the JSON now.`;
  const resp = await client.messages.create({ model: MODEL, max_tokens: 1500, system: SYSTEM, messages:[{role:'user',content:user}] });
  const text = resp.content.filter(b=>b.type==='text').map(b=>b.text).join('');
  let parsed=null; try{ const m=text.match(/\{[\s\S]*\}/); parsed=m?JSON.parse(m[0]):null; }catch{}
  const raw = Array.isArray(parsed?.conclusions)?parsed.conclusions:[];
  const norm = normalize(raw, srcIds);
  const bands={}; norm.forEach(c=>bands[c.epistemicStatus]=(bands[c.epistemicStatus]||0)+1);
  const marketDemonstrated = norm.filter(c=>MARKET.has(c.type)&&(c.epistemicStatus==='OBSERVED'||c.epistemicStatus==='SYNTHESIZED_FROM_OBSERVED')).length;
  const allGrounded = norm.every(c=>(c.epistemicStatus==='HYPOTHESIS'||c.epistemicStatus==='NEEDS_MORE_EVIDENCE')||c.evidenceRefs.every(r=>srcIds.includes(r)));
  return { fid, model:MODEL, rawCount:raw.length, keptCount:norm.length, bands, marketDemonstrated, allGrounded,
    conclusions: norm.map(c=>({type:c.type, band:c.epistemicStatus, refs:c.evidenceRefs.length, statement:c.statement})) };
}
const order=['clear','ambiguous','sparse','conflicting','empty'];
const results=[];
for(const k of order){ try{ results.push(await run(k, F[k])); }catch(e){ results.push({fid:k, error:String(e.message||e)}); } }
console.log(JSON.stringify(results,null,1));
