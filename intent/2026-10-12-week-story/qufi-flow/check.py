import json, re, sys
d = json.load(open(sys.argv[1])); S = d['surfaces']
BAD_VERB = re.compile(r'\b(identify|identifies|identifying|ensure|ensures|ensuring|align|aligning|leverage|utilize)\b', re.I)
def texts(v):
    if isinstance(v, str): return [v]
    if isinstance(v, list): return [t for x in v for t in texts(x)]
    if isinstance(v, dict): return [t for k, x in v.items() if k not in ('founderWords', 'planVersionId', 'proposalId', 'stateId', 'labelKey', 'provenance', 'sourceRefs') for t in texts(x)]
    return []
def bb_only(name, v):
    # founder words are not BB's voice: conversation FOUNDER lines, declared container items, the goal the founder confirmed
    if name == 'conversation': return [x for x in v if x.startswith('BB:')]
    if name == 'container': return [i['statement'] for i in v if i.get('provenance') != 'declared']
    if name == 'goal': return []
    return texts(v)
for name, v in S.items():
    if name == 'pour-in': continue
    t = bb_only(name, v)
    blob = '\n'.join(t)
    dashes = len(re.findall(r'[—–]|[ \t]-[ \t]', blob))
    verbs = sorted(set(m.group(0).lower() for m in BAD_VERB.finditer(blob)))
    trunc = len(re.findall(r'…|\.\.\.', blob))
    print(f'{name:16} dashes={dashes} badVerbs={verbs or "-"} truncation={trunc}')
c = S.get('container') or []
print('\ncontainer:'); [print(f"  [{i['provenance']}] {i['labelKey'].split('.')[-1]}: {i['statement'][:150]}") for i in c]
print('\ngoal:', S.get('goal')); print('mirror:', json.dumps(S.get('mirror'), ensure_ascii=False)[:400])
