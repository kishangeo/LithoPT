// Robustness check: random, degenerate and adversarial inputs (run: node test/fuzz.js).
const L = require("../lithopt-core.js");
const rng = L.mulberry32(7);
const phases = ["Grt", "Bt", "Cpx", "Opx", "Liq", "Ol", "Pl", "Kfs", "Amp", "Sp"];
const issues = {};
const note = (k, m) => { issues[k] = issues[k] || { n: 0, ex: m }; issues[k].n++; };
function rnd(ph) {
  const c = {};
  for (const o of L.MINERAL_OXIDES) c[o] = rng() < 0.2 ? 0 : +(rng() * 40).toFixed(2);
  if (ph === "Liq") Object.assign(c, { H2O: rng() * 6, Fe3Fet: rng() * 0.4, P2O5: rng(), Zr_ppm: rng() * 500 });
  if (ph === "Grt") c.Ni_ppm = rng() * 120;
  return c;
}
for (let k = 0; k < 3000; k++) {
  const smp = {};
  for (const ph of phases) if (rng() < 0.5) smp[ph] = rnd(ph);
  smp.Trace = { Ti_zrc: rng() * 50, Zr_rt: rng() * 1000, Zr_ttn: rng() * 800, Ti_qz: rng() * 200, Ti_bt_apfu: rng() * 0.6, XMg_bt: rng(), aTiO2: 1, aSiO2: 1 };
  let s;
  try { s = L.prepare(smp); } catch (e) { note("prepare throws: " + e.message, JSON.stringify(smp).slice(0, 80)); continue; }
  for (const e of L.EQUATIONS) {
    if (!L.SYSTEMS[e.system].phases.every((p) => smp[p])) continue;
    let v;
    try { v = L.evaluate(e.id, s, { P_kbar: rng() * 30, T_K: 900 + rng() * 800 }); } catch (err) { note("evaluate throws " + e.id + ": " + err.message, ""); continue; }
    if (typeof v !== "number") note("non-number " + e.id, typeof v);
    else if (Number.isFinite(v) && e.kind === "T" && (v < 0)) note("negative K " + e.id, v);
  }
  try { L.equilibriumTests(s); } catch (err) { note("eqtests throws: " + err.message, ""); }
  try { for (const e of L.EQUATIONS) L.applicability(e.id, smp); } catch (err) { note("applicability throws: " + err.message, ""); }
}
// degenerate cases
const cases = {
  "all-zero phase": { Cpx: {}, Liq: { SiO2: 50 } },
  "string numbers": { Grt: { SiO2: "37.5", FeOt: "29.8", MgO: "4.2", CaO: "4.5", Al2O3: "21.4" }, Bt: { SiO2: "35", FeOt: "18", MgO: "11", Al2O3: "18", K2O: "9" } },
  "negative oxide": { Grt: { SiO2: 37.5, FeOt: -5, MgO: 4.2, CaO: 4.5, Al2O3: 21.4 }, Bt: { SiO2: 35, FeOt: 18, MgO: 11, Al2O3: 18, K2O: 9 } },
  "NaN oxide": { Grt: { SiO2: NaN, FeOt: 29.8, MgO: 4.2, CaO: 4.5, Al2O3: 21.4 }, Bt: { SiO2: 35, FeOt: 18, MgO: 11, Al2O3: 18, K2O: 9 } }
};
for (const [k, smp] of Object.entries(cases)) {
  try { const s = L.prepare(smp); const e = L.EQUATIONS.find((q) => L.SYSTEMS[q.system].phases.every((p) => smp[p])); console.log("case", k, "->", e ? e.id + " = " + L.evaluate(e.id, s, { P_kbar: 5, T_K: 1000 }) : "no eq"); }
  catch (err) { console.log("case", k, "-> throws:", err.message); }
}
// solver edge cases
const pel = { Grt: { SiO2: 37.52, Al2O3: 21.4, FeOt: 29.8, MnO: 1.85, MgO: 4.2, CaO: 4.5 }, Bt: { SiO2: 35.8, TiO2: 2.85, Al2O3: 18.5, FeOt: 18.2, MgO: 11.2, K2O: 9.4 }, Pl: { SiO2: 60.1, Al2O3: 25, CaO: 6.6, Na2O: 7.6, K2O: 0.15 } };
try { L.solvePT("T_FerrySpear1978", "P_Koziol1988_GASP", L.prepare(pel), { Pmin: 20, Pmax: 5 }); console.log("solver Pmin>Pmax: NOT rejected"); } catch (e) { console.log("solver Pmin>Pmax rejected:", e.message); }
console.log("MC N=3:", Object.keys(L.monteCarloPT("T_FerrySpear1978", "P_Koziol1988_GASP", pel, { N: 3 })));
const lhz = { Cpx: { SiO2: 52.4, TiO2: 0.35, Al2O3: 4.1, Cr2O3: 0.9, FeOt: 3.1, MgO: 16.2, CaO: 20.3, Na2O: 1.2 },
  Opx: { SiO2: 56.8, TiO2: 0.08, Al2O3: 0.9, Cr2O3: 0.3, FeOt: 6.1, MgO: 34.1, CaO: 0.85, Na2O: 0.12 },
  Grt: { SiO2: 41.9, TiO2: 0.1, Al2O3: 22.1, Cr2O3: 2.2, FeOt: 7.4, MnO: 0.35, MgO: 20.6, CaO: 5.1 } };
const m = L.monteCarloPT("T_Brey1990", "P_Brey1990", lhz, { N: 500, calibration: true, Pmax: 70 });
console.log("MC with calibration error:", m.P_kbar && m.P_kbar.sd.toFixed(3), "kbar, failed", m.failed);
console.log("SEE parse:", L.EQUATIONS.filter((e) => !L.seeOf(e)).map((e) => e.id + ":" + e.see));
console.log("ISSUES", JSON.stringify(issues, null, 1));
