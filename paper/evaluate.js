// Produces every number quoted in the manuscript (paper/results.json).
// Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
// Needs validation/_experiments.json, written by validation/make_domains.py from the supplement of Neave & Putirka (2017).
// Usage: node paper/evaluate.js
const fs = require("fs");
const path = require("path");
const L = require("../lithopt-core.js");
const D = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "validation", "_experiments.json"), "utf8"));

const rmse = (a) => (a.length ? Math.sqrt(a.reduce((p, q) => p + q * q, 0) / a.length) : null);
const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
const r2 = (x) => (x === null ? null : +x.toFixed(2));
const out = { version: L.VERSION, nEquations: L.EQUATIONS.length, nSystems: Object.keys(L.SYSTEMS).length,
  bySystem: Object.fromEntries(Object.entries(L.SYSTEMS).map(([k, s]) => [k, { name: s.name, n: L.EQUATIONS.filter((e) => e.system === k).length }])),
  byKind: ["T", "P", "H2O", "fO2"].map((k) => [k, L.EQUATIONS.filter((e) => e.kind === k).length]) };

// ---- 1. Calibration-domain check: Neave & Putirka (2017) barometer at the experimental temperature ----
out.domain = {};
for (const set of ["calibration", "global_test", "tholeiite_test"]) {
  const g = { inside: [], marginal: [], outside: [] }, pts = [];
  for (const r of D[set]) {
    const smp = { Liq: r.Liq, Cpx: r.Cpx };
    let v = NaN;
    try { v = L.evaluate("P_Neave2017", L.prepare(smp), { T_K: r.T_C + 273.15 }); } catch (e) { /* unusable analysis */ }
    if (!Number.isFinite(v)) continue;
    const a = L.applicability("P_Neave2017", smp);
    g[a.status].push(v - r.P_kbar);
    pts.push([+a.d2.toFixed(2), +(v - r.P_kbar).toFixed(2)]);
  }
  out.domain[set] = { n: pts.length, points: set === "calibration" ? undefined : pts,
    groups: Object.fromEntries(Object.entries(g).map(([k, a]) => [k, { n: a.length, rmse: r2(rmse(a)), medianAbs: r2(median(a.map(Math.abs))) }])) };
}
out.domain.p95 = L.DOMAINS().NeavePutirka2017.d2_p95; out.domain.p99 = L.DOMAINS().NeavePutirka2017.d2_p99;

// ---- 2. Model choice: every Cpx–liquid thermometer × barometer pair on the independent global test data ----
// Masotta et al. (2013) equations are excluded: they are calibrated for alkaline differentiated magmas only.
const use = (e) => (e.system === "cpx_liq") && !e.id.includes("Mas2013") && e.src !== "Pending";
const Ts = L.EQUATIONS.filter((e) => e.kind === "T" && use(e)), Ps = L.EQUATIONS.filter((e) => e.kind === "P" && use(e));
const pairErr = {}, ensAll = { T: [], P: [] }, ensIn = { T: [], P: [] }, spreadT = [], spreadP = [];
let nUsed = 0;
for (const r of D.global_test) {
  if (r.P_kbar > 30) continue; // above the range of most of these barometers
  const smp = { Liq: r.Liq, Cpx: r.Cpx };
  let s; try { s = L.prepare(smp); } catch (e) { continue; }
  const sol = [];
  for (const t of Ts) for (const p of Ps) {
    let q; try { q = L.solvePT(t.id, p.id, s, { Pmin: -5, Pmax: 60 }); } catch (e) { q = { converged: false }; }
    if (!q.converged || !L.plausible(t.id, q.T_K) || !L.plausible(p.id, q.P_kbar)) continue;
    const k = `${t.id}+${p.id}`;
    (pairErr[k] = pairErr[k] || { T: [], P: [] }).T.push(q.T_K - 273.15 - r.T_C); pairErr[k].P.push(q.P_kbar - r.P_kbar);
    sol.push({ T: q.T_K - 273.15, P: q.P_kbar });
  }
  if (sol.length < 4) continue;
  nUsed++;
  const mT = median(sol.map((x) => x.T)), mP = median(sol.map((x) => x.P));
  ensAll.T.push(mT - r.T_C); ensAll.P.push(mP - r.P_kbar);
  const sd = (a) => { const m = a.reduce((p, q) => p + q, 0) / a.length; return Math.sqrt(a.reduce((p, q) => p + (q - m) ** 2, 0) / (a.length - 1)); };
  spreadT.push(sd(sol.map((x) => x.T))); spreadP.push(sd(sol.map((x) => x.P)));
  if (L.applicability("P_Neave2017", smp).status !== "outside") { ensIn.T.push(mT - r.T_C); ensIn.P.push(mP - r.P_kbar); }
}
const pairs = Object.entries(pairErr).filter(([, v]) => v.P.length > 0.8 * nUsed).map(([k, v]) => ({ pair: k, n: v.P.length, rmseT: r2(rmse(v.T)), rmseP: r2(rmse(v.P)) })).sort((a, b) => a.rmseP - b.rmseP);
out.ensemble = { nExperiments: nUsed, nThermometers: Ts.length, nBarometers: Ps.length,
  ensembleMedian: { rmseT: r2(rmse(ensAll.T)), rmseP: r2(rmse(ensAll.P)) },
  ensembleMedianNotOutsideDomain: { n: ensIn.P.length, rmseT: r2(rmse(ensIn.T)), rmseP: r2(rmse(ensIn.P)) },
  pairRange: { rmseP: [pairs[0].rmseP, pairs[pairs.length - 1].rmseP], rmseT: [Math.min(...pairs.map((p) => p.rmseT)), Math.max(...pairs.map((p) => p.rmseT))] },
  medianSpread: { T: r2(median(spreadT)), P: r2(median(spreadP)) }, pairs };

// ---- 3. Worked example: metapelite, garnet–biotite + GASP with Monte Carlo ----
const pelite = { Grt: { SiO2: 37.52, TiO2: 0.05, Al2O3: 21.4, Cr2O3: 0.02, FeOt: 29.8, MnO: 1.85, MgO: 4.2, CaO: 4.5, Na2O: 0.03, K2O: 0.01 },
  Bt: { SiO2: 35.8, TiO2: 2.85, Al2O3: 18.5, FeOt: 18.2, MnO: 0.15, MgO: 11.2, CaO: 0.08, Na2O: 0.25, K2O: 9.4 }, Pl: { SiO2: 60.1, Al2O3: 25.0, CaO: 6.6, Na2O: 7.6, K2O: 0.15 } };
const det = L.solvePT("T_FerrySpear1978", "P_Koziol1988_GASP", L.prepare(pelite), { Pmax: 30 });
const mc = L.monteCarloPT("T_FerrySpear1978", "P_Koziol1988_GASP", pelite, { N: 2000, seed: 42, Pmax: 30 });
const mcCal = L.monteCarloPT("T_FerrySpear1978", "P_Koziol1988_GASP", pelite, { N: 2000, seed: 42, Pmax: 30, calibration: true });
out.pelite = { T_C: r2(det.T_K - 273.15), P_kbar: r2(det.P_kbar), sdT: r2(mc.T_C.sd), sdP: r2(mc.P_kbar.sd), rho: r2(mc.rho), sdT_cal: r2(mcCal.T_C.sd), sdP_cal: r2(mcCal.P_kbar.sd), rho_cal: r2(mcCal.rho),
  ellipse: mc.points.slice(0, 600).map((p) => [+(p.T_K - 273.15).toFixed(1), +p.P_kbar.toFixed(2)]) };

fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(out));
const { points, ...short } = out.domain.global_test;
console.log(JSON.stringify({ domain: { cal: out.domain.calibration.groups, global: short.groups, thol: out.domain.tholeiite_test.groups }, ensemble: { ...out.ensemble, pairs: out.ensemble.pairs.length + " pairs; best " + JSON.stringify(out.ensemble.pairs[0]) }, pelite: { ...out.pelite, ellipse: undefined } }, null, 1));
