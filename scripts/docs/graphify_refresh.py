"""Rebuild the DS2 code knowledge graph (graphify) — code only, no model calls, no API cost.

Scope: DS2_Backend/src, DS2_Backend/scripts, DS2_Frontend/src and DS2_Lambdas/Process_Payment_Images,
excluding tests, virtual environments, node_modules and build output (the feature documentation
lives in DS2_Backend/docs and the DS2_Notes vault instead).
Outputs: DS2/graphify-out/{graph.json, GRAPH_REPORT.md, graph.html} and DS2/DS2_Notes/Graph/.

Run from the DS2 folder with graphify's interpreter:
    $(cat graphify-out/.graphify_python) DS2_Backend/scripts/docs/graphify_refresh.py
"""
import collections
import json
import sys
from pathlib import Path

from graphify.analyze import god_nodes, suggest_questions, surprising_connections
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.detect import detect, save_manifest
from graphify.export import to_canvas, to_html, to_json, to_obsidian
from graphify.extract import extract
from graphify.report import generate

ROOT = Path.cwd()
if not (ROOT / 'DS2_Backend').is_dir() or not (ROOT / 'DS2_Frontend').is_dir():
    sys.exit('Run this from the DS2 folder (the one containing DS2_Backend and DS2_Frontend).')
CODE_ROOTS = ['DS2_Backend/src', 'DS2_Backend/scripts', 'DS2_Frontend/src', 'DS2_Lambdas/Process_Payment_Images']
SKIP = {'venv', '.venv', '__pycache__', 'node_modules', 'node_modules.nosync', 'tests', 'out', 'build'}
VAULT_GRAPH = ROOT / 'DS2_Notes' / 'Graph'
OUT = ROOT / 'graphify-out'
OUT.mkdir(exist_ok=True)

code = []
for root in CODE_ROOTS:
    if not (ROOT / root).exists():
        continue
    for f in detect(ROOT / root).get('files', {}).get('code', []):
        p = Path(f)
        if any(part in SKIP for part in p.parts) or p.name.endswith(('.test.js', '.spec.js')):
            continue
        code.append(str(p))
code = sorted(set(code))
words = sum(len(Path(f).read_text(errors='ignore').split()) for f in code)
detection = {'files': {'code': code, 'document': [], 'paper': [], 'image': [], 'video': []},
             'total_files': len(code), 'total_words': words, 'needs_graph': True, 'warning': None}
print(f'Corpus: {len(code)} code files, ~{words:,} words')

extraction = extract([Path(f) for f in code], cache_root=ROOT)
extraction.update({'hyperedges': [], 'input_tokens': 0, 'output_tokens': 0})
G = build_from_json(extraction)
communities = cluster(G)
cohesion = score_all(G, communities)

prefix = str(ROOT) + '/'
def area(src):
    parts = [p for p in (src or '').replace(prefix, '').split('/') if p]
    if not parts:
        return 'Misc'
    repo = {'DS2_Backend': 'Backend', 'DS2_Frontend': 'Frontend', 'DS2_Lambdas': 'Lambda'}.get(parts[0], parts[0])
    inner = [p for p in parts[1:-1] if p not in ('src', 'endpoints', 'Pages', 'Components', 'Process_Payment_Images')]
    return ' '.join([repo] + inner[-2:]) if inner else f'{repo} {Path(parts[-1]).stem}'

labels, used = {}, collections.Counter()
for cid, members in communities.items():
    areas = collections.Counter(area(G.nodes[n].get('source_file')) for n in members if n in G.nodes)
    base = areas.most_common(1)[0][0] if areas else f'Community {cid}'
    top = max(members, key=lambda n: G.degree(n) if n in G.nodes else 0)
    name = base if not used[base] else f"{base}: {G.nodes[top].get('label', top) if top in G.nodes else cid}"[:60]
    used[base] += 1
    labels[cid] = name

gods = god_nodes(G)
surprises = surprising_connections(G, communities)
questions = suggest_questions(G, communities, labels)
(OUT / 'GRAPH_REPORT.md').write_text(generate(G, communities, cohesion, labels, gods, surprises, detection,
                                              {'input': 0, 'output': 0}, str(ROOT), suggested_questions=questions))
to_json(G, communities, str(OUT / 'graph.json'))
(OUT / '.graphify_labels.json').write_text(json.dumps({str(k): v for k, v in labels.items()}))
to_html(G, communities, str(OUT / 'graph.html'), community_labels=labels)
if (ROOT / 'DS2_Notes' / '.obsidian').is_dir():
    n = to_obsidian(G, communities, str(VAULT_GRAPH), community_labels=labels, cohesion=cohesion)
    to_canvas(G, communities, str(VAULT_GRAPH / 'graph.canvas'), community_labels=labels)
    print(f'Obsidian: {n} notes in {VAULT_GRAPH}')
save_manifest(detection['files'])
print(f'Graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges, {len(communities)} communities (0 model tokens)')
