#!/usr/bin/env node
//
// build-high-risk-roles.mjs: regenerate the High-Risk Roles register in
// high-risk-roles.html from content/high-risk-roles.json.
//
// Same contract as tools/build-nav.sh:
//   IDEMPOTENT   replaces strictly BETWEEN the HRR:BEGIN / HRR:END markers.
//                Running it twice yields byte-identical output.
//   FAIL CLOSED  a dataset that does not validate (missing field, duplicate id,
//                a role citing a source that is not in the source list, an
//                unused source, an em or en dash in the text) is a hard ERROR
//                that names every problem. Nothing is written.
//
// Usage:  node tools/build-high-risk-roles.mjs          regenerate
//         node tools/build-high-risk-roles.mjs --check  verify up to date, change nothing (exit 1 if stale)
//
// Node built-ins only. No dependencies.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = 'content/high-risk-roles.json';
const PAGE = 'high-risk-roles.html';
const BEGIN = '<!-- HRR:BEGIN -->';
const END = '<!-- HRR:END -->';
const CHECK = process.argv.includes('--check');

const DRIVERS = [
  ['access', 'Access'],
  ['trust', 'Trust'],
  ['opportunity', 'Opportunity'],
  ['pressure', 'Pressure'],
];
const CONTROLS = [
  ['screening', 'Screening'],
  ['privileged_access', 'Privileged access'],
  ['separation_of_duties', 'Separation of duties'],
  ['monitoring', 'Monitoring scope'],
  ['offboarding', 'Offboarding'],
];
const SECTORS = {
  all: 'Cross-sector',
  financial: 'Financial institutions',
  healthcare: 'Healthcare',
};
const LICENSES = {
  'us-gov': 'U.S. government work, public domain in the U.S.',
  'state-gov': 'State government publication; reuse terms not confirmed, quoted minimally',
  'crown-copyright': 'Crown copyright; Open Government Licence not confirmed, linked and paraphrased',
  'copyright': 'Copyrighted; cited by number and paraphrased, not reproduced',
  'apache-2.0': 'Apache License 2.0 (repository)',
  'not-public': 'Not publicly released; existence cited only',
  'unverified': 'License not confirmed; linked only',
  'forscie': 'Forscie license: royalty-free use, copies must carry its notice; linked only',
};
const CONFIDENCE = {
  verified: 'Verified: primary source read',
  corroborated: 'Corroborated: two independent secondary sources',
  'single-source': 'Single source',
  unverified: 'Unverified: not read for this page',
  'not-rechecked': 'Not re-checked: read earlier, site refused access on the review date',
};
const GIVES = { yes: 'Gives a role list', partial: 'Gives a partial list or examples', no: 'No role list' };

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// Load and validate. Collect every problem before stopping.
// ---------------------------------------------------------------------------
const raw = readFileSync(join(ROOT, DATA), 'utf8');
let data;
try { data = JSON.parse(raw); } catch (e) { fail([`${DATA} is not valid JSON: ${e.message}`]); }

const problems = [];
if (/[–—]/.test(raw)) problems.push(`${DATA} contains an em or en dash; house style for this page uses none`);
const need = (obj, keys, where) => keys.forEach((k) => {
  const v = obj?.[k];
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length)) {
    problems.push(`${where}: missing "${k}"`);
  }
});

need(data, ['meta', 'sources', 'categories'], DATA);
need(data.meta || {}, ['title', 'last_reviewed', 'license'], 'meta');

const sourceIds = new Set();
(data.sources || []).forEach((s, i) => {
  const where = `source ${s.id || '#' + i}`;
  need(s, ['id', 'title', 'publisher', 'year', 'url', 'license', 'what_it_says', 'gives_list', 'confidence'], where);
  if (sourceIds.has(s.id)) problems.push(`${where}: duplicate id`);
  sourceIds.add(s.id);
  if (s.license && !LICENSES[s.license]) problems.push(`${where}: unknown license "${s.license}"`);
  if (s.confidence && !CONFIDENCE[s.confidence]) problems.push(`${where}: unknown confidence "${s.confidence}"`);
  if (s.gives_list && !GIVES[s.gives_list]) problems.push(`${where}: unknown gives_list "${s.gives_list}"`);
  if (s.url && !/^https:\/\//.test(s.url)) problems.push(`${where}: url must be https`);
});

const ids = new Set();
const cited = new Set();
(data.categories || []).forEach((c, ci) => {
  const where = `category ${c.id || '#' + ci}`;
  need(c, ['id', 'name', 'summary', 'roles'], where);
  if (ids.has(c.id)) problems.push(`${where}: duplicate id`);
  ids.add(c.id);
  (c.roles || []).forEach((r, ri) => {
    const rw = `role ${r.id || c.id + '#' + ri}`;
    need(r, ['id', 'name', 'sector', 'why', 'typical_access', 'indicators', 'controls', 'sources'], rw);
    if (ids.has(r.id)) problems.push(`${rw}: duplicate id`);
    ids.add(r.id);
    if (r.sector && !SECTORS[r.sector]) problems.push(`${rw}: unknown sector "${r.sector}"`);
    need(r.why || {}, DRIVERS.map((d) => d[0]), `${rw} why`);
    need(r.controls || {}, CONTROLS.map((d) => d[0]), `${rw} controls`);
    (r.sources || []).forEach((sid) => {
      if (!sourceIds.has(sid)) problems.push(`${rw}: cites unknown source "${sid}"`);
      cited.add(sid);
    });
  });
});
[...sourceIds].filter((s) => !cited.has(s) && !(data.sources.find((x) => x.id === s) || {}).context_only)
  .forEach((s) => problems.push(`source ${s}: listed but cited by no role (cite it, or set "context_only": true)`));

if (problems.length) fail(problems);

function fail(list) {
  list.forEach((p) => console.error(`ERROR: ${p}`));
  console.error(`\nRefusing to build ${PAGE}. Fix ${DATA} and re-run.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Render.
// ---------------------------------------------------------------------------
const srcById = Object.fromEntries(data.sources.map((s) => [s.id, s]));
const srcNum = Object.fromEntries(data.sources.map((s, i) => [s.id, i + 1]));
const roles = data.categories.flatMap((c) => c.roles);
const sectorsUsed = Object.keys(SECTORS).filter((k) => roles.some((r) => r.sector === k));
const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;

const out = [];
out.push('<!-- GENERATED by tools/build-high-risk-roles.mjs from content/high-risk-roles.json. DO NOT HAND-EDIT.');
out.push('     Edit the dataset and re-run the script; changes here are overwritten. -->');
out.push(`<p class="hrr-total">${n(roles.length, 'role', 'roles')} in ${n(data.categories.length, 'category', 'categories')}, drawn from ${n(data.sources.length, 'source', 'sources')}.</p>`);

out.push('<nav class="hrr-toc" aria-label="Role categories"><ul>');
data.categories.forEach((c) => out.push(`<li><a href="#${esc(c.id)}">${esc(c.name)}</a> <span class="hrr-count">${c.roles.length}</span></li>`));
out.push('<li><a href="#sources">Sources and licenses</a> <span class="hrr-count">' + data.sources.length + '</span></li>');
out.push('</ul></nav>');

out.push('<div class="hrr-controls" id="hrr-controls" data-pagefind-ignore hidden>');
out.push('<div class="hrr-filter-group" role="group" aria-labelledby="hrr-f-sector"><span class="hrr-filter-label" id="hrr-f-sector">Sector</span> '
  + sectorsUsed.map((k) => `<button type="button" class="hrr-chip" data-sector="${k}" aria-pressed="false">${esc(SECTORS[k])}</button>`).join(' ')
  + ' <button type="button" class="hrr-clear" id="hrr-clear">Show all</button></div>');
out.push('<div class="hrr-bulk-row"><button type="button" class="hrr-bulk" id="hrr-expand-all">Expand all</button> <button type="button" class="hrr-bulk" id="hrr-collapse-all">Collapse all</button></div>');
out.push(`<p class="hrr-status" id="hrr-status" aria-live="polite">Showing all ${n(roles.length, 'role', 'roles')}</p>`);
out.push('</div>');

data.categories.forEach((c) => {
  out.push(`<section class="hrr-group" data-category="${esc(c.id)}">`);
  out.push(`<h2 id="${esc(c.id)}">${esc(c.name)} <span class="hrr-count" data-total="${c.roles.length}">${n(c.roles.length, 'role', 'roles')}</span></h2>`);
  out.push(`<p class="hrr-summary">${esc(c.summary)}</p>`);
  c.roles.forEach((r) => {
    out.push(`<details class="hrr-role" id="${esc(r.id)}" data-sector="${esc(r.sector)}">`);
    out.push(`<summary><span class="hrr-role-name">${esc(r.name)}</span> <span class="hrr-pill${r.sector === 'all' ? '' : ' hrr-pill-sector'}">${esc(SECTORS[r.sector])}</span></summary>`);
    out.push('<div class="hrr-body">');
    out.push('<h3>Why it is high-risk</h3><dl class="hrr-dl">');
    DRIVERS.forEach(([k, label]) => out.push(`<dt>${label}</dt><dd>${esc(r.why[k])}</dd>`));
    out.push('</dl>');
    out.push('<h3>Typical access and privileges</h3><ul>' + r.typical_access.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>');
    out.push('<h3>Indicators that matter more in this role</h3><ul>' + r.indicators.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>');
    out.push('<h3>Recommended controls</h3><dl class="hrr-dl">');
    CONTROLS.forEach(([k, label]) => out.push(`<dt>${label}</dt><dd>${esc(r.controls[k])}</dd>`));
    out.push('</dl>');
    out.push('<p class="hrr-cites"><span>Sources:</span> ' + r.sources.map((sid) => `<a href="#src-${esc(sid)}">[${srcNum[sid]}] ${esc(srcById[sid].publisher.replace(/\s*\(.*\)$/, ''))}</a>`).join(', ') + '</p>');
    out.push('</div></details>');
  });
  out.push('</section>');
});

out.push('<section class="hrr-sources" aria-labelledby="sources">');
out.push('<h2 id="sources">Sources and licenses</h2>');
out.push('<p class="hrr-summary">What each source says about high-risk roles, whether it gives a list, and how this page may use it. Confidence labels say how each was checked on the review date.</p>');
out.push('<ol class="hrr-src-list">');
data.sources.forEach((s) => {
  out.push(`<li class="hrr-src" id="src-${esc(s.id)}">`);
  out.push(`<p class="hrr-src-title"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></p>`);
  out.push(`<p class="hrr-src-pub">${esc(s.publisher)}, ${esc(s.year)}</p>`);
  out.push(`<p class="hrr-meta"><span class="hrr-pill">${esc(GIVES[s.gives_list])}</span> <span class="hrr-pill hrr-lic-${esc(s.license)}">${esc(LICENSES[s.license])}</span> <span class="hrr-pill hrr-conf-${esc(s.confidence)}">${esc(CONFIDENCE[s.confidence])}</span></p>`);
  out.push(`<p class="hrr-src-says">${esc(s.what_it_says)}</p>`);
  if (s.confidence_note) out.push(`<p class="hrr-src-note">${esc(s.confidence_note)}</p>`);
  out.push('</li>');
});
out.push('</ol></section>');

const block = out.join('\n') + '\n';

// ---------------------------------------------------------------------------
// Splice between the markers.
// ---------------------------------------------------------------------------
const pagePath = join(ROOT, PAGE);
const page = readFileSync(pagePath, 'utf8');
const b = page.split(BEGIN).length - 1;
const e = page.split(END).length - 1;
if (b !== 1 || e !== 1) fail([`${PAGE}: expected exactly 1 ${BEGIN} and 1 ${END}, found ${b} and ${e}`]);
const start = page.indexOf(BEGIN) + BEGIN.length;
const stop = page.indexOf(END);
if (stop < start) fail([`${PAGE}: ${END} comes before ${BEGIN}`]);
const next = page.slice(0, start) + '\n' + block + page.slice(stop);

if (next === page) {
  console.log(CHECK ? `OK: ${PAGE} matches ${DATA}` : `${PAGE} already up to date (${roles.length} roles, ${data.sources.length} sources)`);
  process.exit(0);
}
if (CHECK) {
  console.error(`STALE: ${PAGE} does not match ${DATA}. Run node tools/build-high-risk-roles.mjs`);
  process.exit(1);
}
writeFileSync(pagePath, next);
console.log(`${PAGE} rebuilt from ${DATA}: ${roles.length} roles in ${data.categories.length} categories, ${data.sources.length} sources`);
