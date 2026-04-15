#!/usr/bin/env -S node --loader tsx
/**
 * KG Visualizer — self-contained HTML with inlined data + D3 force layout.
 *
 * Serves two audiences (the dual-audience goal): humans navigating the graph
 * and Kuro auditing its own memory. Output is one file, no external assets,
 * gitignored under memory/index/ so it rebuilds cheaply.
 *
 * Usage:
 *   pnpm tsx scripts/kg-viz.ts                 # default paths
 *   pnpm tsx scripts/kg-viz.ts --out path.html
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KG_PATHS, type EntityRecord, type EdgeRecord, type ConflictRecord } from '../src/kg-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? resolve(args[outIdx + 1]) : resolve(REPO_ROOT, 'memory/index/kg-graph.html');

const entitiesPath = resolve(REPO_ROOT, KG_PATHS.entities);
const edgesPath = resolve(REPO_ROOT, KG_PATHS.edges);
const conflictsPath = resolve(REPO_ROOT, KG_PATHS.conflicts);
const resolvedPath = resolve(REPO_ROOT, 'memory/index/entities-resolved.jsonl');

function loadJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip */ }
  }
  return out;
}

interface ResolvedRecord extends EntityRecord {
  resolved_type: string | string[];
  resolution_rule: string;
  resolution_confidence: 'high' | 'medium' | 'low';
  alternatives: string[];
}

const entities = loadJsonl<EntityRecord>(entitiesPath);
const edges = loadJsonl<EdgeRecord>(edgesPath);
const conflicts = loadJsonl<ConflictRecord>(conflictsPath);
const resolved = loadJsonl<ResolvedRecord>(resolvedPath);

// Overlay by id — resolver may not cover every entity (e.g., if resolved file
// is stale), so raw entity stays the fallback.
const resolvedById = new Map<string, ResolvedRecord>();
for (const r of resolved) resolvedById.set(r.id, r);

// Slim payload — the full records include span/confidence per reference that
// aren't needed for the top-level graph view.
const nodes = entities.map((e) => {
  const r = resolvedById.get(e.id);
  const resolvedType = r?.resolved_type ?? e.type;
  return {
    id: e.id,
    type: e.type,
    resolved_type: resolvedType,
    rule: r?.resolution_rule ?? 'R0-noop',
    confidence: r?.resolution_confidence ?? 'high',
    alternatives: r?.alternatives ?? [],
    name: e.canonical_name,
    aliases: e.aliases,
    refs: e.references.length,
    disputed: (e.meta?.disputed_types as string[] | undefined) ?? [],
  };
});

const links = edges.map((e) => ({
  source: e.from,
  target: e.to,
  type: e.type,
  confidence: e.confidence,
}));

const conflictIndex: Record<string, string[]> = {};
for (const c of conflicts) {
  for (const id of c.entities) {
    (conflictIndex[id] ??= []).push(c.type);
  }
}

const data = { nodes, links, conflicts: conflictIndex, built_at: new Date().toISOString() };

const html = renderHtml(data);
writeFileSync(outPath, html);

const reviewCount = nodes.filter((n) => n.rule === 'R7-needs-review').length;
const resolvedCount = nodes.filter((n) => n.rule !== 'R0-noop').length;

console.log(`Wrote ${outPath}`);
console.log(`  ${nodes.length} nodes, ${links.length} edges, ${conflicts.length} conflicts`);
console.log(`  overlay: ${resolved.length} resolved records, ${resolvedCount} non-passthrough, ${reviewCount} needs-review`);

function renderHtml(payload: typeof data): string {
  const json = JSON.stringify(payload);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>KG — ${payload.nodes.length} entities</title>
<style>
  :root {
    --bg: #0e0f13; --fg: #d7dae0; --dim: #7b8091; --accent: #7aa7ff;
    --panel: #1a1c23; --border: #2a2d36; --conflict: #f07a7a;
    --review: #ffb86c; --low: #f0a07a; --medium: #d9c67a; --high: #8be9c0;
  }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg); font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; }
  #app { display: grid; grid-template-columns: 1fr 320px; height: 100vh; }
  svg { width: 100%; height: 100%; display: block; }
  aside { border-left: 1px solid var(--border); padding: 14px 16px; overflow-y: auto; background: var(--panel); }
  h1 { font-size: 14px; margin: 0 0 8px; color: var(--accent); }
  h2 { font-size: 12px; margin: 16px 0 6px; color: var(--dim); text-transform: uppercase; letter-spacing: .04em; }
  .stat { display: flex; justify-content: space-between; padding: 2px 0; color: var(--dim); }
  .stat b { color: var(--fg); font-weight: 500; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .legend span { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dim); padding: 2px 6px; border-radius: 4px; background: #22242c; cursor: pointer; user-select: none; }
  .legend span.off { opacity: .35; }
  .legend i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  #search { width: 100%; box-sizing: border-box; background: #22242c; border: 1px solid var(--border); color: var(--fg); padding: 6px 8px; border-radius: 4px; font: inherit; }
  #details { margin-top: 8px; }
  #details .name { font-size: 14px; font-weight: 500; margin: 0; }
  #details .type { color: var(--accent); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  #details ul { margin: 4px 0 0; padding-left: 18px; color: var(--dim); }
  #details .conflict { color: var(--conflict); margin-top: 6px; font-size: 11px; }
  .node { cursor: pointer; }
  .node:hover circle.primary { stroke: #fff; stroke-width: 2px; }
  .node.selected circle.primary { stroke: var(--accent); stroke-width: 2.5px; }
  .node.conflict circle.primary { stroke: var(--conflict); stroke-width: 2px; }
  .node.needs-review circle.primary { stroke: var(--review); stroke-width: 2px; stroke-dasharray: 3 2; }
  .node.dimmed { opacity: .15; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: .04em; }
  .badge.high { background: rgba(139,233,192,.15); color: var(--high); }
  .badge.medium { background: rgba(217,198,122,.15); color: var(--medium); }
  .badge.low { background: rgba(240,160,122,.15); color: var(--low); }
  .badge.review { background: rgba(255,184,108,.15); color: var(--review); }
  #details .rule-row { display: flex; gap: 6px; margin: 4px 0; align-items: center; }
  #details .res-change { color: var(--accent); font-size: 11px; margin-top: 4px; }
  #details .alt { color: var(--dim); font-size: 11px; }
  text.label { fill: var(--fg); font-size: 10px; pointer-events: none; }
  line.link { stroke: #3d4150; stroke-opacity: .5; }
  line.link.dimmed { stroke-opacity: .08; }
  footer { position: absolute; bottom: 8px; left: 12px; color: var(--dim); font-size: 11px; }
</style>
</head>
<body>
<div id="app">
  <div style="position: relative;">
    <svg id="graph"></svg>
    <footer id="footer"></footer>
  </div>
  <aside>
    <h1>KG — self-audit</h1>
    <input id="search" placeholder="search name / alias / id…" />
    <h2>Stats</h2>
    <div class="stat"><span>entities</span><b id="s-nodes"></b></div>
    <div class="stat"><span>edges</span><b id="s-edges"></b></div>
    <div class="stat"><span>conflicts</span><b id="s-conflicts"></b></div>
    <div class="stat"><span>needs-review</span><b id="s-review"></b></div>
    <div class="stat"><span>resolved</span><b id="s-resolved"></b></div>
    <div class="stat"><span>built</span><b id="s-built"></b></div>
    <h2>Types</h2>
    <div class="legend" id="legend"></div>
    <h2>Detail</h2>
    <div id="details"><div class="stat" style="color:var(--dim)">click a node</div></div>
  </aside>
</div>
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<script>
const DATA = ${json};

const typeColors = {
  actor:       '#ffb86c',
  concept:     '#7aa7ff',
  project:     '#a980ff',
  tool:        '#8be9c0',
  artifact:    '#ffd86c',
  'code-symbol': '#6ccff5',
  event:       '#f08cd6',
  claim:       '#d7dae0',
  decision:    '#f07a7a',
};

const svg = d3.select('#graph');
const width = () => document.querySelector('#graph').clientWidth;
const height = () => document.querySelector('#graph').clientHeight;

const g = svg.append('g');
svg.call(d3.zoom().scaleExtent([0.1, 8]).on('zoom', (e) => g.attr('transform', e.transform)));

const sim = d3.forceSimulation(DATA.nodes)
  .force('link', d3.forceLink(DATA.links).id((d) => d.id).distance(60).strength(0.3))
  .force('charge', d3.forceManyBody().strength(-140))
  .force('center', d3.forceCenter(width() / 2, height() / 2))
  .force('collide', d3.forceCollide().radius(14));

const link = g.append('g').attr('class', 'links').selectAll('line')
  .data(DATA.links).join('line').attr('class', 'link');

const primaryType = (d) => Array.isArray(d.resolved_type) ? d.resolved_type[0] : d.resolved_type;
const secondaryType = (d) => Array.isArray(d.resolved_type) && d.resolved_type[1] ? d.resolved_type[1] : null;
const needsReview = (d) => d.rule === 'R7-needs-review';

const node = g.append('g').attr('class', 'nodes').selectAll('g')
  .data(DATA.nodes).join('g')
  .attr('class', (d) => {
    let cls = 'node';
    if (DATA.conflicts[d.id]) cls += ' conflict';
    if (needsReview(d)) cls += ' needs-review';
    return cls;
  })
  .call(d3.drag()
    .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
    .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

const nodeRadius = (d) => Math.max(4, Math.min(12, 3 + Math.sqrt(d.refs)));

// Primary circle — fill = resolved_type[0] (R4 union) or resolved_type (scalar).
node.append('circle')
  .attr('class', 'primary')
  .attr('r', nodeRadius)
  .attr('fill', (d) => typeColors[primaryType(d)] ?? '#888');

// Secondary half-ring — only for R4 union types (tool+actor, artifact+actor).
// Positioned at top half of node so both colours visible at a glance.
node.filter((d) => secondaryType(d) !== null).append('path')
  .attr('class', 'secondary')
  .attr('d', (d) => {
    const r = nodeRadius(d);
    return 'M ' + (-r) + ',0 A ' + r + ',' + r + ' 0 0,1 ' + r + ',0';
  })
  .attr('fill', (d) => typeColors[secondaryType(d)] ?? '#888')
  .attr('stroke', 'none');

node.append('text').attr('class', 'label').attr('x', 10).attr('y', 3)
  .text((d) => d.name.length > 24 ? d.name.slice(0, 22) + '…' : d.name);

node.on('click', (_e, d) => selectNode(d));

sim.on('tick', () => {
  link.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
  node.attr('transform', (d) => 'translate(' + d.x + ',' + d.y + ')');
});

// Sidebar
document.getElementById('s-nodes').textContent = DATA.nodes.length;
document.getElementById('s-edges').textContent = DATA.links.length;
document.getElementById('s-conflicts').textContent = Object.keys(DATA.conflicts).length;
document.getElementById('s-review').textContent = DATA.nodes.filter(needsReview).length;
document.getElementById('s-resolved').textContent = DATA.nodes.filter((n) => n.rule !== 'R0-noop').length;
document.getElementById('s-built').textContent = DATA.built_at.slice(0, 16).replace('T', ' ');

// Legend counts by resolved primary type — so R4 unions count toward both
// their primary and secondary. Secondary adds as a tertiary count for
// visibility.
const typeCounts = {};
for (const n of DATA.nodes) {
  typeCounts[primaryType(n)] = (typeCounts[primaryType(n)] ?? 0) + 1;
  const sec = secondaryType(n);
  if (sec) typeCounts[sec] = (typeCounts[sec] ?? 0) + 1;
}

const hidden = new Set();
const legend = d3.select('#legend');
Object.entries(typeColors).forEach(([t, c]) => {
  if (!typeCounts[t]) return;
  const chip = legend.append('span').attr('data-t', t)
    .on('click', function () {
      const el = d3.select(this);
      if (hidden.has(t)) { hidden.delete(t); el.classed('off', false); }
      else { hidden.add(t); el.classed('off', true); }
      applyFilter();
    });
  chip.append('i').style('background', c);
  chip.append('text').text(t + ' · ' + typeCounts[t]);
});

const search = document.getElementById('search');
search.addEventListener('input', () => applyFilter());

function applyFilter() {
  const q = search.value.trim().toLowerCase();
  node.classed('dimmed', (d) => {
    if (hidden.has(primaryType(d)) && !secondaryType(d)) return true;
    if (hidden.has(primaryType(d)) && hidden.has(secondaryType(d))) return true;
    if (!q) return false;
    return !(d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q) ||
             d.aliases.some((a) => a.toLowerCase().includes(q)));
  });
  link.classed('dimmed', (d) => hidden.has(primaryType(d.source)) && hidden.has(primaryType(d.target)));
}

function selectNode(d) {
  node.classed('selected', (n) => n === d);
  const details = document.getElementById('details');
  const conflicts = DATA.conflicts[d.id] ?? [];
  const resolvedStr = Array.isArray(d.resolved_type) ? d.resolved_type.join(' + ') : d.resolved_type;
  const changed = resolvedStr !== d.type;
  const confClass = needsReview(d) ? 'review' : d.confidence;
  details.innerHTML =
    '<p class="name">' + escapeHtml(d.name) + '</p>' +
    '<p class="type">' + escapeHtml(resolvedStr) + ' · <span style="color:var(--dim)">' + d.id + '</span></p>' +
    (changed ? '<div class="res-change">resolved from <b>' + d.type + '</b> → <b>' + escapeHtml(resolvedStr) + '</b></div>' : '') +
    '<div class="rule-row"><span class="badge ' + confClass + '">' + d.rule + '</span>' +
    '<span class="badge ' + confClass + '">' + d.confidence + '</span></div>' +
    (d.alternatives.length ? '<div class="alt">alt: ' + d.alternatives.map(escapeHtml).join(', ') + '</div>' : '') +
    '<div class="stat"><span>references</span><b>' + d.refs + '</b></div>' +
    '<div class="stat"><span>aliases</span><b>' + d.aliases.length + '</b></div>' +
    (d.aliases.length ? '<ul>' + d.aliases.slice(0, 12).map((a) => '<li>' + escapeHtml(a) + '</li>').join('') + '</ul>' : '') +
    (d.disputed.length ? '<div class="conflict">disputed types: ' + d.disputed.join(', ') + '</div>' : '') +
    (conflicts.length ? '<div class="conflict">conflicts: ' + conflicts.join(', ') + '</div>' : '');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.getElementById('footer').textContent = 'scroll to zoom · drag to pan · click node for detail · click legend to toggle';
</script>
</body>
</html>`;
}
