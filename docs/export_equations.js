// Writes docs/equations.json (equation registry, systems, molar masses, depth models) for docs/build_manual.py.
// Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
// Usage: node docs/export_equations.js
const fs = require("fs");
const path = require("path");
const L = require("../lithopt-core.js");

const domains = L.DOMAINS() || {};
const out = {
  version: L.VERSION,
  systems: L.SYSTEMS,
  oxides: Object.fromEntries(Object.entries(L.OX).map(([k, o]) => [k, { mw: o.mw, cat: o.cat, ox: o.ox }])),
  atomic_weights: L.ATOMIC_WEIGHT,
  eqs: L.EQUATIONS.map((e) => ({ id: e.id, name: e.name, system: e.system, kind: e.kind, src: e.src, see: e.see, range: e.range,
    doi: e.doi || null, ref: e.ref || null, code: e.fn.toString() })),
  domains: Object.fromEntries(Object.entries(domains).map(([k, d]) => [k, { label: d.label, n: d.n, features: d.features, p95: d.d2_p95, p99: d.d2_p99, equations: d.equations }])),
  depth: Object.fromEntries(Object.entries(L.DEPTH_MODELS).map(([k, m]) => [k, { name: m.name, code: m.fn.toString() }]))
};
fs.writeFileSync(path.join(__dirname, "equations.json"), JSON.stringify(out, null, 1));
console.log(`wrote docs/equations.json: ${out.eqs.length} equations, ${Object.keys(out.systems).length} systems`);
