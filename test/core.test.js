// Unit tests for lithopt-core.js. Run: node test/core.test.js
// Reference values were computed independently (hand-coded from the original papers) and are
// hard-coded here; other checks write the printed equation out in full.
// Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
const assert = require("assert");
const L = require("../lithopt-core.js");

let passed = 0;
const close = (a, b, rel = 1e-9, msg = "") => {
  assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} vs ${b}`);
  passed++;
};
const T = (id, trace, P = 0) => L.evaluate(id, L.prepare({ Trace: trace }), { P_kbar: P });

// ---- trace-element thermometers (T in K) ----
close(T("T_Watson2006_TiZrc", { Ti_zrc: 10 }), 1013.9720558882236, 1e-12, "Ti-in-zircon W06");
close(T("T_FerryWatson2007_TiZrc", { Ti_zrc: 10, aTiO2: 0.7, aSiO2: 1 }), 1053.533079807251, 1e-12, "Ti-in-zircon FW07");
close(T("T_Watson2006_ZrRt", { Zr_rt: 100 }), 833.9552238805969, 1e-12, "Zr-in-rutile W06");
close(T("T_FerryWatson2007_ZrRt", { Zr_rt: 100, aSiO2: 1 }), 835.7933579335794, 1e-12, "Zr-in-rutile FW07");
close(T("T_Tomkins2007_alpha", { Zr_rt: 100 }, 10), 842.168458664231, 1e-12, "Tomkins α-qz");
close(T("T_Tomkins2007_beta", { Zr_rt: 100 }, 10), 845.2051048280931, 1e-12, "Tomkins β-qz");
close(T("T_Tomkins2007_coe", { Zr_rt: 100 }, 10), 876.2487539669515, 1e-12, "Tomkins coesite");
close(T("T_Hayden2008_ZrTtn", { Zr_ttn: 300, aTiO2: 1, aSiO2: 1 }, 5), 1018.1934467950697, 1e-12, "Zr-in-titanite");
close(T("T_Henry2005_TiBt", { Ti_bt_apfu: 0.3, XMg_bt: 0.5 }), 934.5689630525533, 1e-12, "Ti-in-biotite");
close(T("T_Thomas2010_TiQz", { Ti_qz: 50, aTiO2: 1 }, 5), 849.7663652479034, 1e-5, "TitaniQ Thomas"); // reference used M(TiO2) = 79.866, M(SiO2) = 60.0843; IUPAC values shift it by 2e-6
close(T("T_Huang2012_TiQz", { Ti_qz: 50 }, 5), 1001.9173975878296, 1e-12, "TitaniQ Huang & Audétat");

// ---- checks against the printed equations (see Papers/) ----
{
  const l10 = Math.log10, t = (id, tr, P) => T(id, tr, P);
  // Ferry & Watson (2007) eq. 14: log Zr = 7.420 − 4530/T − log aSiO2
  close(t("T_FerryWatson2007_ZrRt", { Zr_rt: 100, aSiO2: 0.7 }), 4530 / (7.420 - l10(0.7) - 2), 1e-12, "FW07 Zr-in-rutile activity term");
  // Tomkins et al. (2007) eq. 8, printed with −273: T(°C) at 10 kbar, 100 ppm
  close(t("T_Tomkins2007_alpha", { Zr_rt: 100 }, 10) - 273.15, (83.9 + 4.10) / (0.1428 - 0.0083144 * Math.log(100)) - 273, 1e-12, "Tomkins printed form");
}
// Koziol & Newton (1988) eq. 5a: pure end-members give P(bar) = 22.80 T(°C) − 1093
{
  const s = L.prepare({ Grt: { SiO2: 38.4, Al2O3: 21.8, CaO: 37.3 }, Pl: { SiO2: 43.2, Al2O3: 36.7, CaO: 20.1 } });
  const P = L.evaluate("P_Koziol1988_GASP", s, { T_K: 923.15 }) * 1000;
  close(P, 22.80 * 650 - 1093, 5e-4, "GASP end-member line");
}
// Brey & Köhler (1990) Na-partitioning thermometer
{
  const s = L.prepare({ Cpx: { SiO2: 52.4, Al2O3: 4.1, FeOt: 3.1, MgO: 16.2, CaO: 20.3, Na2O: 1.2 }, Opx: { SiO2: 56.8, Al2O3: 0.9, FeOt: 6.1, MgO: 34.1, CaO: 0.85, Na2O: 0.12 } });
  const D = s.Opx.cat.Na / s.Cpx.cat.Na;
  close(L.evaluate("T_Brey1990_Na", s, { P_kbar: 30 }), (35000 + 61.5 * 30) / (Math.log(D) ** 2 + 19.8), 1e-12, "Brey & Köhler T_Na");
}
// Brey & Köhler (1990) eq. 9 (T_BKN) and Table 3 (P_BKN), written out here from the paper
{
  const smp = { Cpx: { SiO2: 52.4, TiO2: 0.35, Al2O3: 4.1, Cr2O3: 0.9, FeOt: 3.1, MnO: 0.09, MgO: 16.2, CaO: 20.3, Na2O: 1.2 },
    Opx: { SiO2: 56.8, TiO2: 0.08, Al2O3: 0.9, Cr2O3: 0.3, FeOt: 6.1, MnO: 0.13, MgO: 34.1, CaO: 0.85, Na2O: 0.12 },
    Grt: { SiO2: 41.9, TiO2: 0.1, Al2O3: 22.1, Cr2O3: 2.2, FeOt: 7.4, MnO: 0.35, MgO: 20.6, CaO: 5.1, Na2O: 0.03 } };
  const s = L.prepare(smp), c = s.Cpx.cat, o = s.Opx.cat, g = s.Grt.cat;
  const KD = (1 - c.Ca / (1 - c.Na)) / (1 - o.Ca / (1 - o.Na));
  close(L.evaluate("T_Brey1990", s, { P_kbar: 30 }), (23664 + (24.9 + 126.3 * c.Fe / (c.Fe + c.Mg)) * 30) / (13.38 + Math.log(KD) ** 2 + 11.59 * o.Fe / (o.Fe + o.Mg)), 1e-12, "T_BKN eq. 9");
  const T = 1373.15, jd = o.Na - o.Cr - 2 * o.Ti, xAlTS = jd < 0 ? (o.Al + jd) / 2 : (o.Al - jd) / 2;
  const m1 = 1 - (o.Al + o.Na - o.Cr - 2 * o.Ti) / 2 - o.Cr - o.Ti, m2 = 1 - o.Ca - o.Na - o.Mn, xmf = o.Mg / (o.Mg + o.Fe);
  const gs = g.Ca + g.Mg + g.Fe + g.Mn, ca = g.Ca / gs, fe = g.Fe / gs, al = g.Al / (g.Al + g.Cr), cr = g.Cr / (g.Al + g.Cr);
  const C1 = -8.3143 * T * Math.log(((1 - ca) ** 3 * al ** 2) / (m1 * m2 ** 2 * xAlTS)) - 5510 + 88.91 * T - 19 * T ** 1.2 + 3 * ca ** 2 * 82458
    + m1 * xmf * m1 * (1 - xmf) * (80942 - 46.7 * T) - 3 * fe * ca * 17793 - ca * cr * (1.164e6 - 420.4 * T) - fe * cr * (-1.25e6 + 565 * T);
  const C2 = -0.832 - 8.78e-5 * (T - 298) + 3 * ca ** 2 * 3.305 - ca * cr * 13.45 + fe * cr * 10.5, C3 = 16.6e-4;
  close(L.evaluate("P_Brey1990", s, { T_K: T }), (-C2 - Math.sqrt(C2 ** 2 + 4 * C3 * C1 / 1000)) / (2 * C3), 1e-12, "P_BKN Table 3");
}

// ---- Droop (1987): synthetic garnet Alm60 Prp20 Grs15 Adr5 with known Fe3+ = 0.10 apfu ----
{
  const em = { Alm: [0.60, { FeO: 3, Al2O3: 1, SiO2: 3 }], Prp: [0.20, { MgO: 3, Al2O3: 1, SiO2: 3 }],
    Grs: [0.15, { CaO: 3, Al2O3: 1, SiO2: 3 }], Adr: [0.05, { CaO: 3, Fe2O3: 1, SiO2: 3 }] };
  const A = L.ATOMIC_WEIGHT, mw = { FeO: L.OX.FeOt.mw, Fe2O3: 2 * A.Fe + 3 * A.O, Al2O3: L.OX.Al2O3.mw, SiO2: L.OX.SiO2.mw, MgO: L.OX.MgO.mw, CaO: L.OX.CaO.mw };
  const wt = {};
  for (const [x, ox] of Object.values(em)) for (const o in ox) wt[o] = (wt[o] || 0) + x * ox[o] * mw[o];
  const comp = { SiO2: wt.SiO2, Al2O3: wt.Al2O3, MgO: wt.MgO, CaO: wt.CaO, FeOt: wt.FeO + wt.Fe2O3 * (2 * mw.FeO) / mw.Fe2O3 };
  const r = L.droopRecalc(comp, 12, 8);
  close(r.cat.Fe3, 0.10, 1e-3, "Droop Fe3+");
  close(r.cat.Fe2, 1.80, 1e-3, "Droop Fe2+");
  close(r.cat.Si, 3.0, 1e-9, "Droop Si");
}

// ---- metamorphic equations, closed-form checks on a pelite ----
const pelite = {
  Grt: { SiO2: 37.52, TiO2: 0.05, Al2O3: 21.4, Cr2O3: 0.02, FeOt: 29.8, MnO: 1.85, MgO: 4.2, CaO: 4.5, Na2O: 0.03, K2O: 0.01 },
  Bt: { SiO2: 35.8, TiO2: 2.85, Al2O3: 18.5, FeOt: 18.2, MnO: 0.15, MgO: 11.2, CaO: 0.08, Na2O: 0.25, K2O: 9.4 },
  Pl: { SiO2: 60.1, Al2O3: 25.0, CaO: 6.6, Na2O: 7.6, K2O: 0.15 }
};
{
  const s = L.prepare(pelite);
  const K = (s.Grt.XPrp / s.Grt.XAlm) / (s.Bt.XMg / (1 - s.Bt.XMg));
  close(L.evaluate("T_FerrySpear1978", s, { P_kbar: 6 }), (2089 + 9.56 * 6) / (0.782 - Math.log(K)), 1e-12, "Ferry & Spear");
  const r = L.solvePT("T_FerrySpear1978", "P_Koziol1988_GASP", s, { Pmin: 0, Pmax: 20 });
  assert.ok(r.converged); passed++;
  close(L.evaluate("P_Koziol1988_GASP", s, { T_K: r.T_K }), r.P_kbar, 1e-6, "solver self-consistency");
}

// ---- Monte Carlo: seeded reproducibility and positive spread ----
{
  const a = L.monteCarloPT("T_FerrySpear1978", "P_Koziol1988_GASP", pelite, { N: 200, seed: 7, Pmax: 20 });
  const b = L.monteCarloPT("T_FerrySpear1978", "P_Koziol1988_GASP", pelite, { N: 200, seed: 7, Pmax: 20 });
  assert.strictEqual(a.T_C.mean, b.T_C.mean); passed++;
  assert.ok(a.T_C.sd > 0 && a.P_kbar.sd > 0 && Math.abs(a.rho) <= 1); passed++;
}

// ---- input validation ----
assert.throws(() => L.evaluate("T_FerrySpear1978", L.prepare({ Grt: pelite.Grt }), { P_kbar: 5 }), /requires phase Bt/); passed++;

// ---- accessory-mineral saturation, printed forms (Watson & Harrison 1983; Boehnke et al. 2013; Harrison & Watson 1984) ----
{
  const liq = { SiO2: 72, TiO2: 0.3, Al2O3: 14, FeOt: 2, MgO: 0.5, CaO: 1.5, Na2O: 3.8, K2O: 4.2, P2O5: 0.12, Zr_ppm: 150 };
  const s = L.prepare({ Liq: liq }), c = s.Liq.cf, M = (c.Na + c.K + 2 * c.Ca) / (c.Al * c.Si), lnD = Math.log(497644 / 150);
  close(L.evaluate("T_Watson1983_Zrc", s, {}), 12900 / (lnD + 3.80 + 0.85 * (M - 1)), 1e-12, "W&H83");
  close(L.evaluate("T_Boehnke2013_Zrc", s, {}), 10108 / (lnD + 1.16 * (M - 1) + 1.48), 1e-12, "Boehnke13");
  close(L.evaluate("T_Harrison1984_Ap", s, {}), (8400 + (0.72 - 0.5) * 2.64e4) / (Math.log(42 / 0.12) + 3.1 + 12.4 * (0.72 - 0.5)), 1e-12, "H&W84");
  assert.ok(Math.abs(L.evaluate("T_Boehnke2013_Zrc", s, {}) - 273.15 - 800) < 80); passed++; // sanity: granite ~ 750–850 °C
}

// ---- robustness: invalid input, invalid bounds, implausible output ----
assert.throws(() => L.prepare({ Grt: { SiO2: 37, FeOt: -1 } }), /negative/); passed++;
assert.throws(() => L.solvePT("T_FerrySpear1978", "P_Koziol1988_GASP", L.prepare(pelite), { Pmin: 20, Pmax: 5 }), /invalid pressure bounds/); passed++;
assert.strictEqual(L.plausible("T_FerrySpear1978", -5000), false); passed++;
assert.strictEqual(L.plausible("T_FerrySpear1978", 973), true); passed++;

// ---- worked examples printed in the source papers ----
const near = (a, b, abs, msg) => { assert.ok(Math.abs(a - b) <= abs, `${msg}: ${a} vs ${b}`); passed++; };
{ // Putirka (2008) Table 1 (melt), Table 2 (orthopyroxene), Table 3 (clinopyroxene)
  const l = L.prepare({ Liq: { SiO2: 47.05, TiO2: 0.89, Al2O3: 16.11, FeOt: 7.96, MnO: 0.15, MgO: 12.78, CaO: 11.13, Na2O: 2.18, K2O: 0.04 } }).Liq;
  [["Si", 0.4327], ["Al", 0.1746], ["Fe", 0.0612], ["Mg", 0.1752], ["Ca", 0.1096], ["Na", 0.0389]].forEach(([k, v]) => near(l.p[k], v, 1.5e-4, "Putirka T1 " + k));
  near(l.CNM, 0.3472, 1.5e-4, "Putirka T1 C_NM"); near(l.NF, -0.7148, 2e-4, "Putirka T1 NF");
  const o = L.prepare({ Opx: { SiO2: 55.7, TiO2: 0.03, Al2O3: 1.88, FeOt: 13.82, MgO: 27.7, CaO: 1.47, Na2O: 0.44 } }).Opx.P;
  near(o.NaAlSi2O6, 0.0302, 1.5e-4, "Putirka T2 Jd"); near(o.FmAl2SiO6, 0.0185, 1.5e-4, "Putirka T2 FmAl2SiO6"); near(o.Fm2Si2O6, 0.8973, 1.5e-4, "Putirka T2 Fm2Si2O6");
  const c = L.prepare({ Cpx: { SiO2: 52.5, TiO2: 0.33, Al2O3: 1.58, FeOt: 9.89, MnO: 0.24, MgO: 13.29, CaO: 22.5, Na2O: 0.37, Cr2O3: 0.05 } }).Cpx.P;
  near(c.Jd, 0.0247, 1.5e-4, "Putirka T3 Jd"); near(c.CaTi, 0.0223, 1.5e-4, "Putirka T3 CaTi"); near(c.DiHd, 0.8747, 1.5e-4, "Putirka T3 DiHd"); near(c.EnFs, 0.0856, 1.5e-4, "Putirka T3 EnFs");
}
{ // Masotta et al. (2013) supplementary spreadsheet, pair MB-22: Talk2012 = 854.01 °C, Palk2012 = 1.0059 kbar
  const s = L.prepare({ Cpx: { SiO2: 52.3, TiO2: 0.86, Al2O3: 0.85, FeOt: 11.3, MnO: 1.14, MgO: 11.9, CaO: 20.8, Na2O: 0.92 },
    Liq: { SiO2: 60.7, TiO2: 0.67, Al2O3: 19.4, FeOt: 3.1, MnO: 0.16, MgO: 0.28, CaO: 0.6, Na2O: 9.8, K2O: 5.34, H2O: 3.12 } });
  near(L.evaluate("T_Mas2013_Talk2012", s, {}) - 273.15, 854.010, 0.05, "Masotta Talk2012");
  near(L.evaluate("P_Mas2013_Palk2012", s, {}), 1.0059, 0.002, "Masotta Palk2012");
}
{ // Ridolfi et al. (2010) Amp-TB spreadsheet, sample RE_1amp1: Al_T = 1.543 (13 cations), P = 176.6 MPa
  const s = L.prepare({ Amp: { SiO2: 45.474, TiO2: 2.529, Al2O3: 9.07, Cr2O3: 0.026, FeOt: 12.682, MnO: 0.235, MgO: 14.214, CaO: 11.315, Na2O: 2.038, K2O: 0.62 } });
  near(s.Amp.c13.Al, 1.543, 1e-3, "Ridolfi Al_T"); near(L.evaluate("P_Ridolfi2010", s, {}) * 100, 176.6, 0.3, "Ridolfi 2010 P");
}
{ // Putirka (2016) Table 4 worked example
  const s = L.prepare({ Amp: { SiO2: 40.57, TiO2: 2.45, Al2O3: 12.82, FeOt: 13.11, MnO: 0.26, MgO: 13.02, CaO: 11.63, Na2O: 2.2, K2O: 0.92 } });
  near(s.Amp.c23.Si, 6.09, 0.006, "Putirka 2016 Si"); near(s.Amp.c23.Al, 2.27, 0.006, "Putirka 2016 Al");
  near(L.evaluate("T_Put2016_eq5", s, {}) - 273.15, 956, 0.6, "Putirka 2016 eq5");
  near(L.evaluate("T_Put2016_eq6", s, { P_kbar: 6.2 }) - 273.15, 952, 0.6, "Putirka 2016 eq6");
  near(L.evaluate("T_Put2016_SiHbl", s, {}) - 273.15, 972, 0.6, "Putirka 2016 Si-in-Hbl");
  [["P_Hammarstrom1986_eq1", 7.5], ["P_Hollister1987", 8.0], ["P_Johnson1989", 6.1], ["P_Schmidt1992", 7.8]].forEach(([id, v]) => near(L.evaluate(id, s, {}), v, 0.06, id));
}
{ // equilibrium tests and redox: basalt with Fo-rich olivine in Fe–Mg equilibrium (K_D = 0.30)
  const liq = { SiO2: 50.5, TiO2: 1.2, Al2O3: 15.8, FeOt: 9.6, MnO: 0.17, MgO: 7.6, CaO: 11.2, Na2O: 2.6, K2O: 0.45, Fe3Fet: 0.15 };
  const s = L.prepare({ Liq: liq, Ol: { SiO2: 39.5, FeOt: 16.9, MgO: 43.4 } });
  const t = L.equilibriumTests(s)[0];
  assert.ok(t && t.name.startsWith("Ol–liq") && t.value > 0.2 && t.value < 0.45); passed++;
  const d = L.evaluate("fO2_Kress1991", s, { T_K: 1473.15, P_kbar: 0.001 });
  assert.ok(d > -1 && d < 2, "Kress ΔFMQ for Fe3+/ΣFe = 0.15 at 1200 °C should be near FMQ: " + d); passed++;
  const lo = L.evaluate("fO2_Kress1991", L.prepare({ Liq: Object.assign({}, liq, { Fe3Fet: 0.08 }) }), { T_K: 1473.15, P_kbar: 0.001 });
  assert.ok(lo < d, "more reduced melt gives lower fO2"); passed++;
}
// Wang et al. (2021) eq. 1 against the authors' calculation sheet (Supplement Table S2, row SV89 of Villiger et al., 2007): 8.01644 kbar
near(L.evaluate("P_Wang2021_eq1", L.prepare({ Cpx: { SiO2: 52.45, TiO2: 0.25, Al2O3: 5.08, Cr2O3: 1.02, FeOt: 5.64, MnO: 0.22, MgO: 19.86, CaO: 16.53, Na2O: 0.31, K2O: 0 } }), {}), 8.01644, 0.001, "Wang 2021 eq. 1, SV89");
// Montierth et al. (1995) eq. 2: T(°C) = 23.0 MgO + 1012
near(L.evaluate("T_Montierth1995", L.prepare({ Liq: { SiO2: 51, TiO2: 2.2, Al2O3: 13.5, FeOt: 10, MgO: 7, CaO: 11, Na2O: 2.3, K2O: 0.4 } }), {}) - 273.15, 1173, 1e-9, "Montierth 1995");
// every equation is registered once, belongs to a system and has a parsable or explicitly absent SEE
{
  const ids = new Set();
  for (const e of L.EQUATIONS) { assert.ok(!ids.has(e.id), "duplicate " + e.id); ids.add(e.id); assert.ok(L.SYSTEMS[e.system], e.id + " system"); assert.ok(L.seeOf(e) || e.see === "not stated", e.id + " SEE: " + e.see); }
  passed++;
}

// ---- decision support: phase guess, ranking, intersection geometry, report ----
{
  const A = {
    Grt: { SiO2: 37.52, TiO2: 0.05, Al2O3: 21.4, Cr2O3: 0.02, FeOt: 29.8, MnO: 1.85, MgO: 4.2, CaO: 4.5, Na2O: 0.03, K2O: 0.01 },
    Bt: { SiO2: 35.8, TiO2: 2.85, Al2O3: 18.5, FeOt: 18.2, MnO: 0.15, MgO: 11.2, CaO: 0.08, Na2O: 0.25, K2O: 9.4 },
    Pl: { SiO2: 60.1, Al2O3: 25.0, CaO: 6.6, Na2O: 7.6, K2O: 0.15 },
    Cpx: { SiO2: 52.4, TiO2: 0.35, Al2O3: 4.1, Cr2O3: 0.9, FeOt: 3.1, MnO: 0.09, MgO: 16.2, CaO: 20.3, Na2O: 1.2, K2O: 0.01 },
    Opx: { SiO2: 56.8, TiO2: 0.08, Al2O3: 0.9, Cr2O3: 0.3, FeOt: 6.1, MnO: 0.13, MgO: 34.1, CaO: 0.85, Na2O: 0.12 },
    Ol: { SiO2: 40.8, FeOt: 9.2, MnO: 0.13, MgO: 49.5, CaO: 0.05 },
    Sp: { TiO2: 0.1, Al2O3: 50.0, Cr2O3: 17.0, FeOt: 12.5, MnO: 0.1, MgO: 20.0 },
    Amp: { SiO2: 40.57, TiO2: 2.45, Al2O3: 12.82, FeOt: 13.11, MnO: 0.26, MgO: 13.02, CaO: 11.63, Na2O: 2.2, K2O: 0.92 },
    Ms: { SiO2: 46.5, TiO2: 0.4, Al2O3: 35.5, FeOt: 1.2, MgO: 0.7, Na2O: 1.1, K2O: 9.6 },
    Kfs: { SiO2: 64.8, Al2O3: 18.6, CaO: 0.1, Na2O: 1.5, K2O: 14.5 },
    Liq: { SiO2: 72.0, TiO2: 0.3, Al2O3: 14.0, FeOt: 2.0, MgO: 0.5, CaO: 1.5, Na2O: 3.8, K2O: 4.2 }
  };
  for (const [ph, comp] of Object.entries(A)) { assert.strictEqual(L.classifyMineral(comp).phase, ph, "classifyMineral " + ph); passed++; }
  assert.strictEqual(L.classifyMineral(A.Ms).supported, false, "muscovite has no equations"); passed++;

  const pelite = { Grt: A.Grt, Bt: A.Bt, Pl: A.Pl }, opt = { Pmin: 0, Pmax: 70, eqOpt: { gammaGrs: 1, gammaAn: 1 } };
  const rec = L.recommendModels(pelite, Object.assign({ P_kbar: 6, T_K: 923.15 }, opt));
  assert.ok(rec.pairs.length >= 1 && rec.thermometers.length >= 1 && rec.barometers.length >= 1, "recommendModels returns ranked lists");
  assert.ok(rec.pairs.every((p, i, a) => !i || a[i - 1].score >= p.score), "pairs sorted by score");
  assert.ok(rec.thermometers.every((t) => t.score >= 0 && t.score <= 100 && t.parts.phases + t.parts.domain + t.parts.health + t.parts.precision === +t.raw.toFixed(1)), "score is the sum of its parts");
  passed += 3;

  // geometry: two straight lines with known slopes cross at the angle given by their SEE-scaled directions
  const det = L.solvePT("T_FerrySpear1978", "P_Koziol1988_GASP", L.prepare(pelite), opt);
  const g = L.intersectionGeometry("T_FerrySpear1978", "P_Koziol1988_GASP", L.prepare(pelite), det, opt);
  const a1 = Math.atan2(1 / g.scaleP, g.dTdP / g.scaleT), a2 = Math.atan2(g.dPdT / g.scaleP, 1 / g.scaleT);
  close(g.angle, Math.abs(a1 - a2) * 180 / Math.PI, 1e-9, "intersection angle");
  assert.strictEqual(g.condition, "well-conditioned"); passed++;

  // zero perturbation: no spread, so the correlation is undefined rather than a division by zero
  const mc0 = L.monteCarloPT("T_FerrySpear1978", "P_Koziol1988_GASP", pelite, Object.assign({ N: 20, rel: 0, floor: 0 }, opt));
  assert.ok(Number.isNaN(mc0.rho) && mc0.T_C.sd < 1e-9, "rho undefined without spread"); passed++;

  const R = require("../lithopt-report.js");
  const rep = R.build({ L, sample: pelite, system: "grt_bt", cond: { P_kbar: 6, T_C: 650 }, eqOpt: opt.eqOpt, date: "test",
    pt: { tId: "T_FerrySpear1978", pId: "P_Koziol1988_GASP", det, solveOpt: opt, mc: { N: 200, rel: 0.02, floor: 0.02, seed: 42 } }, ens: L.ensemblePT(pelite, opt) });
  for (const must of ["## 1. Summary", "## 2. Compositions", "## 3. Equations", "## 4. Uncertainty", "## 5. Coupled solution", "## 6. Diagram", "Variance budget", "X_Alm 0.663", "Fe–Mg cation exchange", "Net-transfer reaction", "intermediate T/P"])
    assert.ok(rep.markdown.includes(must), "report contains: " + must);
  assert.ok(rep.mcTotal.T_C.sd > rep.mcAnalytical.T_C.sd, "calibration error widens the Monte Carlo spread");
  const html = R.toHtml(rep.markdown + "\n\n<script>alert(1)</script>");
  assert.ok(html.includes("<table>") && html.includes("<h2>") && !html.includes("<script>"), "report HTML is built and escaped");
  const noPt = R.build({ L, sample: { Amp: A.Amp }, system: "amp_only", cond: { P_kbar: 5, T_C: 950 } });
  assert.ok(noPt.markdown.includes("No coupled P–T solution") && noPt.markdown.includes("Empirical single-phase"), "report without a P–T solution");
  passed += 4;
}

console.log(`core.test.js: ${passed} assertions passed`);
