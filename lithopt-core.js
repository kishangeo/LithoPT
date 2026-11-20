/**
 * LithoPT core engine v4.2.1
 * Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
 *
 * Pure, DOM-free calculation library: stoichiometry, mineral components, thermobarometric
 * equations, coupled P–T solver, Monte Carlo propagation and model-choice ensembles.
 * Runs unchanged in browsers (window.LithoPT) and Node.js (module.exports).
 *
 * Every equation is implemented directly from its original publication (see each entry's
 * DOI or reference) and checked against the printed equation; no third-party thermobarometry
 * code or data is included. Molar masses are computed from IUPAC standard atomic weights.
 * Conventions: T in kelvin and P in kbar inside all equations; oxide inputs in wt%;
 * total iron reported as FeOt.
 * License: MIT
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LithoPT = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VERSION = "4.2.1";
  const R = 8.314462618; // J mol⁻¹ K⁻¹ (CODATA 2018)
  const ln = Math.log, log10 = Math.log10;

  // ---------------------------------------------------------------------------
  // 1. Oxides. Molar masses from IUPAC (CIAAW 2021) conventional/standard atomic weights.
  // ---------------------------------------------------------------------------
  const ATOMIC_WEIGHT = { O: 15.999, Si: 28.085, Ti: 47.867, Al: 26.9815384, Cr: 51.9961, Fe: 55.845, Mn: 54.938043, Mg: 24.305, Ca: 40.078, Na: 22.98976928, K: 39.0983, P: 30.973761998 };
  const OXIDE_FORMULA = { SiO2: ["Si", 1, 2], TiO2: ["Ti", 1, 2], Al2O3: ["Al", 2, 3], Cr2O3: ["Cr", 2, 3], FeOt: ["Fe", 1, 1], MnO: ["Mn", 1, 1], MgO: ["Mg", 1, 1], CaO: ["Ca", 1, 1], Na2O: ["Na", 2, 1], K2O: ["K", 2, 1], P2O5: ["P", 2, 5] };
  const OX = {};
  for (const [o, [el, cat, ox]] of Object.entries(OXIDE_FORMULA)) OX[o] = { el, cat, ox, mw: cat * ATOMIC_WEIGHT[el] + ox * ATOMIC_WEIGHT.O };
  const MINERAL_OXIDES = ["SiO2", "TiO2", "Al2O3", "Cr2O3", "FeOt", "MnO", "MgO", "CaO", "Na2O", "K2O"];
  const LIQUID_OXIDES = MINERAL_OXIDES.concat(["P2O5"]);

  const num = (v) => { const x = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(x) ? x : 0; };

  /** Moles of each cation per 100 g, and moles of oxygen. */
  function molar(comp, oxides) {
    const cat = {}; let oxygen = 0;
    for (const o of oxides) {
      const n = num(comp[o]) / OX[o].mw;
      cat[OX[o].el] = n * OX[o].cat;
      oxygen += n * OX[o].ox;
    }
    return { cat, oxygen };
  }
  /** Cations per formula unit on a basis of nOx oxygens. Returns {Si, Ti, …, sum}. */
  function cationsPerOxygen(comp, nOx, oxides = MINERAL_OXIDES) {
    const m = molar(comp, oxides);
    if (!(m.oxygen > 0)) throw new Error("Composition has no oxygen-bearing oxides");
    const out = { sum: 0 };
    for (const el in m.cat) { out[el] = (m.cat[el] * nOx) / m.oxygen; out.sum += out[el]; }
    return out;
  }
  /** Anhydrous cation fractions (cations sum to 1). */
  function cationFractions(comp, oxides = LIQUID_OXIDES) {
    const { cat } = molar(comp, oxides);
    const total = Object.values(cat).reduce((a, b) => a + b, 0);
    if (!(total > 0)) throw new Error("Composition is empty");
    for (const el in cat) cat[el] /= total;
    return cat;
  }
  /**
   * Droop (1987, Mineral. Mag. 51, 431–435) Fe3+ estimate. With S cations per X oxygens
   * (all Fe as Fe2+) and an ideal cation total T: F = 2X(1 − T/S); all cations are rescaled
   * by T/S and Fe2+ = Fe − F. No Fe3+ when S ≤ T.
   */
  function droopRecalc(comp, nOx, nCat) {
    const c = cationsPerOxygen(comp, nOx), S = c.sum;
    const scale = S > nCat ? nCat / S : 1, out = {};
    for (const k in c) if (k !== "sum") out[k] = c[k] * scale;
    out.Fe3 = S > nCat ? Math.min(out.Fe, 2 * nOx * (1 - nCat / S)) : 0;
    out.Fe2 = out.Fe - out.Fe3;
    out.sum = Math.min(S, nCat);
    return { cat: out, observedSum: S, rescaled: S > nCat };
  }

  // ---------------------------------------------------------------------------
  // 2. Mineral and melt components
  // ---------------------------------------------------------------------------
  function garnet(comp) { // 12 O
    const c = cationsPerOxygen(comp, 12), x = c.Fe + c.Mg + c.Ca + c.Mn, fmc = c.Fe + c.Mg + c.Ca;
    return {
      cat: c, XAlm: c.Fe / x, XPrp: c.Mg / x, XGrs: c.Ca / x, XSps: c.Mn / x,
      XCa_FMC: c.Ca / fmc, MgNo: c.Mg / (c.Mg + c.Fe), XAl: c.Al / (c.Al + c.Cr), XCr: c.Cr / (c.Al + c.Cr)
    };
  }
  function biotite(comp) { const c = cationsPerOxygen(comp, 22); return { cat: c, XMg: c.Mg / (c.Mg + c.Fe) }; }
  function pyroxene(comp) { // 6 O; tetrahedral Al fills Si to 2
    const c = cationsPerOxygen(comp, 6);
    c.Al_IV = Math.min(c.Al, Math.max(0, 2 - c.Si));
    c.Al_VI = c.Al - c.Al_IV;
    return c;
  }
  /** Clinopyroxene; optional Fe3+ by charge balance, Lindsley (1983, Am. Mineral. 68, 477–493). */
  function clinopyroxene(comp) {
    const c = pyroxene(comp);
    const Fe3 = Math.min(c.Fe, Math.max(0, c.Al_IV + c.Na + (c.K || 0) - c.Al_VI - c.Cr - 2 * c.Ti));
    return { cat: c, Fe3_Lindsley: Fe3, Fe2_Lindsley: c.Fe - Fe3, P: putirkaCpx(c) };
  }
  function orthopyroxene(comp) { const c = pyroxene(comp); return { cat: c, P: putirkaOpx(c) }; }
  function feldspar(comp) {
    const c = cationsPerOxygen(comp, 8), s = c.Ca + c.Na + c.K;
    return { cat: c, cf: cationFractions(comp, MINERAL_OXIDES), An: c.Ca / s, Ab: c.Na / s, Or: c.K / s };
  }
  function olivine(comp) { const c = cationsPerOxygen(comp, 4); return { cat: c, cf: cationFractions(comp, PUT_OX), Fo: c.Mg / (c.Mg + c.Fe) }; }

  // Putirka (2008, Rev. Mineral. Geochem. 69, 61–120) components. Table 1: melt (and olivine) cation fractions on an
  // anhydrous basis over nine oxides, total Fe as FeO, no P2O5 or Cr2O3; oxide mole fractions over the same oxides.
  const PUT_OX = ["SiO2", "TiO2", "Al2O3", "FeOt", "MnO", "MgO", "CaO", "Na2O", "K2O"];
  /** Table 3: clinopyroxene components from cations on 6 O (Al(IV) = 2 − Si is not limited, as in the table). */
  function putirkaCpx(c) {
    const AlIV = 2 - c.Si, AlVI = c.Al - AlIV;
    const Jd = Math.min(AlVI, c.Na);
    const CaTs = AlVI - Jd > 0 ? AlVI - Jd : 0;
    const CaTi = AlIV > CaTs ? (AlIV - CaTs) / 2 : 0;
    const CrCaTs = c.Cr / 2, DiHd = c.Ca - CaTi - CaTs - CrCaTs;
    return { AlIV, AlVI, Fe3: c.Na + AlIV - AlVI - 2 * c.Ti - c.Cr, Jd, CaTs, CaTi, CrCaTs, DiHd, EnFs: (c.Fe + c.Mg - DiHd) / 2 };
  }
  /** Table 2: orthopyroxene components from cations on 6 O; En and Di as defined with eq. 36. */
  function putirkaOpx(o) {
    const AlIV = 2 - o.Si, AlVI = o.Al - AlIV;
    const NaAlSi2O6 = Math.min(AlVI, o.Na), FmAl2SiO6 = AlVI - NaAlSi2O6 - o.Cr;
    const Fm2Si2O6 = (o.Fe + o.Mn + o.Mg - o.Ti - FmAl2SiO6 - o.Ca) / 2, m = o.Mg / (o.Mg + o.Fe + o.Mn);
    return { AlIV, AlVI, NaAlSi2O6, FmTiAlSiO6: o.Ti, CrAl2SiO6: o.Cr, FmAl2SiO6, CaFmSi2O6: o.Ca, Fm2Si2O6, En: Fm2Si2O6 * m, Di: o.Ca * m };
  }
  function spinel(comp) { // 4 O, 3 cations, Droop Fe3+
    const c = droopRecalc(comp, 4, 3).cat, r3 = c.Al + c.Cr + c.Fe3;
    return { cat: c, CrNo: c.Cr / (c.Cr + c.Al), XFe2: c.Fe2 / (c.Fe2 + c.Mg), XFe3: c.Fe3 / r3, XAl: c.Al / r3 };
  }
  function liquid(comp) {
    const p = cationFractions(comp, PUT_OX), mf = {};
    let n = 0;
    for (const o of PUT_OX) { mf[o] = num(comp[o]) / OX[o].mw; n += mf[o]; }
    for (const o of PUT_OX) mf[o] /= n;
    return {
      cf: cationFractions(comp, LIQUID_OXIDES), // all oxides, for zircon saturation
      p, mf, mfAll: (() => { const m = {}; let t = 0; for (const o of LIQUID_OXIDES) { m[o] = num(comp[o]) / OX[o].mw; t += m[o]; } for (const o in m) m[o] /= t; return m; })(),
      H2O: num(comp.H2O), MgNo: p.Mg / (p.Mg + p.Fe),
      CNM: p.Fe + p.Mn + p.Mg + p.Ca, NF: 3.5 * ln(1 - p.Al) + 7 * ln(1 - p.Ti) // Beattie (1993) terms, Putirka Table 1
    };
  }

  const MINERAL_BASIS = {
    Garnet: { nOx: 12, nCat: 8 }, Clinopyroxene: { nOx: 6, nCat: 4 }, Orthopyroxene: { nOx: 6, nCat: 4 },
    Olivine: { nOx: 4, nCat: 3 }, Spinel: { nOx: 4, nCat: 3 }, Plagioclase: { nOx: 8, nCat: 5 },
    "Alkali feldspar": { nOx: 8, nCat: 5 }, Biotite: { nOx: 22, nCat: null }, Amphibole: { nOx: 23, nCat: null }
  };
  /** Structural formula; Droop Fe3+ only where the ideal cation total is fixed. */
  function structuralFormula(mineral, comp) {
    const b = MINERAL_BASIS[mineral];
    if (!b) throw new Error("Unknown mineral " + mineral);
    if (b.nCat) { const r = droopRecalc(comp, b.nOx, b.nCat); return { basis: b, cat: r.cat, observedSum: r.observedSum, fe3Method: "Droop (1987)" }; }
    const c = cationsPerOxygen(comp, b.nOx);
    return { basis: b, cat: Object.assign({}, c, { Fe2: c.Fe, Fe3: 0 }), observedSum: c.sum, fe3Method: "none (all Fe as Fe2+)" };
  }

  // ---------------------------------------------------------------------------
  // 3. Equation registry
  //    kind "T" returns K (needs P, kbar); "P" returns kbar (needs T, K); "fO2" returns ΔFMQ (needs T, P).
  //    Papers that print T in °C with −273 are reproduced exactly (+0.15 K).
  // ---------------------------------------------------------------------------
  const SYSTEMS = {
    grt_bt: { name: "Garnet–biotite Fe–Mg exchange", phases: ["Grt", "Bt"] },
    grt_cpx: { name: "Garnet–clinopyroxene Fe–Mg exchange", phases: ["Grt", "Cpx"] },
    grt_opx: { name: "Garnet–orthopyroxene", phases: ["Grt", "Opx"] },
    gasp: { name: "GASP (garnet–Al2SiO5–plagioclase–quartz)", phases: ["Grt", "Pl"] },
    two_px: { name: "Two-pyroxene", phases: ["Cpx", "Opx"] },
    ol_sp: { name: "Olivine–spinel", phases: ["Ol", "Sp"] },
    trace: { name: "Trace-element thermometry", phases: ["Trace"] },
    liq_only: { name: "Liquid-only (saturation thermometry)", phases: ["Liq"] },
    cpx_liq: { name: "Clinopyroxene–liquid", phases: ["Cpx", "Liq"] },
    cpx_only: { name: "Clinopyroxene-only", phases: ["Cpx"] },
    opx_liq: { name: "Orthopyroxene–liquid", phases: ["Opx", "Liq"] },
    opx_only: { name: "Orthopyroxene-only", phases: ["Opx"] },
    ol_liq: { name: "Olivine–liquid", phases: ["Ol", "Liq"] },
    plag_liq: { name: "Plagioclase–liquid", phases: ["Pl", "Liq"] },
    kfs_liq: { name: "Alkali feldspar–liquid", phases: ["Kfs", "Liq"] },
    two_fsp: { name: "Two-feldspar", phases: ["Pl", "Kfs"] },
    amp_only: { name: "Amphibole-only", phases: ["Amp"] },
    grt_only: { name: "Garnet-only (mantle xenocrysts: Ni)", phases: ["Grt"] }
  };
  /** Calcic amphibole on 13 cations, Si + Ti + Al + Cr + Fe + Mn + Mg = 13 (Leake et al., 1997), as used by Ridolfi & Renzulli (2012). */
  function amphibole(comp) {
    const { cat } = molar(comp, MINERAL_OXIDES);
    const s = cat.Si + cat.Ti + cat.Al + cat.Cr + cat.Fe + cat.Mn + cat.Mg;
    if (!(s > 0)) throw new Error("Composition is empty");
    const c13 = {};
    for (const el in cat) c13[el] = (13 * cat[el]) / s;
    return { c13, c23: cationsPerOxygen(comp, 23), MgNo: cat.Mg / (cat.Mg + cat.Fe) };
  }
  const PHASE_MODEL = {
    Grt: garnet, Bt: biotite, Cpx: clinopyroxene, Opx: orthopyroxene, Pl: feldspar, Kfs: feldspar, Ol: olivine, Sp: spinel, Liq: liquid, Amp: amphibole,
    Trace: (t) => Object.assign({}, t)
  };

  // helpers shared by several equations
  const pos = (x) => (x > 0 ? x : NaN);
  const liqWt = (s, o) => num(s.raw.Liq[o]);
  function kdGrtCpx(s) { // (Fe/Mg)Grt / (Fe2+/Mg)Cpx
    const fe = s.cpxFe2 === "lindsley" ? s.Cpx.Fe2_Lindsley : s.Cpx.cat.Fe;
    return (s.Grt.cat.Fe / s.Grt.cat.Mg) / (fe / s.Cpx.cat.Mg);
  }
  /** GASP: 3 An = Grs + 2 Al2SiO5 + Qz; ΔG°(J, T in °C) + RT ln K + ΔV·P = 0 with ΔV < 0. */
  function gaspP(s, T, opt, dG0, dV) {
    const gG = (opt && opt.gammaGrs) || 1, gA = (opt && opt.gammaAn) || 1;
    const lnK = ln((gG * s.Grt.XGrs) ** 3 / (gA * s.Pl.An) ** 3);
    return (dG0(T - 273.15) + R * T * lnK) / dV / 1000;
  }
  /** Zircon saturation parameter M = (Na + K + 2Ca)/(Al·Si), melt cation fractions (Watson & Harrison, 1983). */
  const zirconM = (l) => (l.Na + l.K + 2 * l.Ca) / (l.Al * l.Si);
  /**
   * Brey & Köhler (1990) Table 3 site occupancies for orthopyroxene (6 O) and garnet.
   * Fe3+ in orthopyroxene is taken as zero (all Fe as Fe2+).
   */
  function breyOpxGrt(o, gc) {
    const fe3 = 0;
    const jd = o.Na - o.Cr - fe3 - 2 * o.Ti;
    const xAlM1 = (o.Al + o.Na - o.Cr - fe3 - 2 * o.Ti) / 2;
    const xAlTS = jd < 0 ? (o.Al + jd) / 2 : (o.Al - jd) / 2;
    const xMF = o.Mg / (o.Mg + o.Fe);
    const xMFM1 = 1 - xAlM1 - o.Cr - fe3 - o.Ti, xMFM2 = 1 - o.Ca - o.Na - o.Mn;
    const g = gc.Ca + gc.Mg + gc.Fe + gc.Mn;
    return {
      xAlTS, xMFM1, xMFM2, xMgM1: xMFM1 * xMF, xFeM1: xMFM1 * (1 - xMF),
      gCa: gc.Ca / g, gFe: gc.Fe / g, gAl: gc.Al / (gc.Al + gc.Cr), gCr: gc.Cr / (gc.Al + gc.Cr)
    };
  }

  const PUB = "Published";
  const EQUATIONS = [
    // ---- Metamorphic exchange and net-transfer ---------------------------------------------
    { id: "T_FerrySpear1978", system: "grt_bt", kind: "T", src: PUB, name: "Ferry & Spear (1978)", doi: "10.1007/BF00372150", see: "±50 °C",
      range: "Grt with X(Ca+Mn) < 0.2; 550–800 °C",
      // 12,454 − 4.662 T + 0.057 P(bar) + 3RT ln K = 0, K = (Mg/Fe)Grt/(Mg/Fe)Bt
      fn: (s, P) => { const K = (s.Grt.XPrp / s.Grt.XAlm) / (s.Bt.XMg / (1 - s.Bt.XMg)); return (2089 + 9.56 * P) / (0.782 - ln(K)); } },
    { id: "T_EllisGreen1979", system: "grt_cpx", kind: "T", src: PUB, name: "Ellis & Green (1979)", doi: "10.1007/BF00371878", see: "±50 °C",
      range: "750–1300 °C, 24–30 kbar experiments", fn: (s, P) => (3104 * s.Grt.XCa_FMC + 3030 + 10.86 * P) / (ln(kdGrtCpx(s)) + 1.9034) },
    { id: "T_Powell1985", system: "grt_cpx", kind: "T", src: PUB, name: "Powell (1985)", doi: "10.1111/j.1525-1314.1985.tb00319.x", see: "±50 °C",
      range: "Recalibration of Ellis & Green (1979)", fn: (s, P) => (2790 + 10 * P + 3140 * s.Grt.XCa_FMC) / (ln(kdGrtCpx(s)) + 1.735) },
    { id: "T_Krogh1988", system: "grt_cpx", kind: "T", src: PUB, name: "Krogh (1988)", doi: "10.1007/BF00399364", see: "±50 °C",
      range: "Eclogites, X_Grs < 0.5",
      fn: (s, P) => { const x = s.Grt.XGrs; return (-6173 * x * x + 6731 * x + 1879 + 10 * P) / (ln(kdGrtCpx(s)) + 1.393) + 0.15; } },
    { id: "T_Ravna2000", system: "grt_cpx", kind: "T", src: PUB, name: "Ravna (2000)", doi: "10.1046/j.1525-1314.2000.00247.x", see: "±65 °C",
      range: "600–1400 °C, 0–60 kbar",
      fn: (s, P) => {
        const g = s.Grt, m = g.MgNo;
        return (1939.9 + 3270 * g.XGrs - 1396 * g.XGrs ** 2 + 3319 * g.XSps - 3535 * g.XSps ** 2 + 1105 * m - 3561 * m ** 2 + 2324 * m ** 3 + 169.4 * P / 10)
          / (ln(kdGrtCpx(s)) + 1.223) + 0.15;
      } },
    { id: "T_Harley1984", system: "grt_opx", kind: "T", src: PUB, name: "Harley (1984)", doi: "10.1007/BF01187140", see: "±60 °C",
      range: "800–1200 °C, 5–30 kbar (FMAS–CFMAS)",
      fn: (s, P) => { const K = (s.Grt.XAlm / s.Grt.XPrp) / (s.Opx.cat.Fe / s.Opx.cat.Mg); return (3740 + 1400 * s.Grt.XCa_FMC + 22.86 * P) / (1.987 * ln(K) + 1.96) + 0.15; } },
    { id: "P_Brey1990", system: "grt_opx", kind: "P", src: PUB, name: "Brey & Köhler (1990) Al-in-Opx (P_BKN)", doi: "10.1093/petrology/31.6.1353", see: "±2.2 kbar",
      range: "Garnet peridotites, 900–1400 °C, 10–60 kbar; Opx Fe3+ taken as 0",
      // Table 3: P = [−C2 − √(C2² + 4·C3·C1/1000)] / (2·C3), R = 8.3143 J/(K mol)
      fn: (s, T) => {
        const b = breyOpxGrt(s.Opx.cat, s.Grt.cat);
        const KD = ((1 - b.gCa) ** 3 * b.gAl ** 2) / (b.xMFM1 * b.xMFM2 ** 2 * b.xAlTS);
        const C1 = -8.3143 * T * ln(KD) - 5510 + 88.91 * T - 19 * T ** 1.2 + 3 * b.gCa ** 2 * 82458
          + b.xMgM1 * b.xFeM1 * (80942 - 46.7 * T) - 3 * b.gFe * b.gCa * 17793
          - b.gCa * b.gCr * (1.164e6 - 420.4 * T) - b.gFe * b.gCr * (-1.25e6 + 565 * T);
        const C2 = -0.832 - 8.78e-5 * (T - 298) + 3 * b.gCa ** 2 * 3.305 - b.gCa * b.gCr * 13.45 + b.gFe * b.gCr * 10.5;
        const C3 = 16.6e-4;
        return (-C2 - Math.sqrt(C2 * C2 + (4 * C3 * C1) / 1000)) / (2 * C3);
      } },
    { id: "P_Koziol1988_GASP", system: "gasp", kind: "P", src: PUB, name: "Koziol & Newton (1988) GASP, kyanite", doi: null, ref: "Am. Mineral. 73, 216–223",
      see: "±1–2 kbar (activity-model dependent)", range: "Kyanite + quartz present; a_Grs = (γ·X_Grs)³, a_An = γ·X_An", needs: ["gammaGrs", "gammaAn"],
      // ΔG°(J; T in °C) = 141.59 T − 6788, ΔV = −6.210 J/bar (their Appendix B)
      fn: (s, T, opt = {}) => gaspP(s, T, opt, (t) => 141.59 * t - 6788, 6.210) },
    { id: "P_Koziol1988_GASP_sil", system: "gasp", kind: "P", src: PUB, name: "Koziol & Newton (1988) GASP, sillimanite", doi: null, ref: "Am. Mineral. 73, 216–223",
      see: "±1–2 kbar (activity-model dependent)", range: "Sillimanite + quartz present; Ky–Sil after Holdaway (1971)", needs: ["gammaGrs", "gammaAn"],
      // ΔG°(J; T in °C) = −0.0009648 T² + 120.67 T − 130, ΔV = −5.154 J/bar (their eqs B5, 5b)
      fn: (s, T, opt = {}) => gaspP(s, T, opt, (t) => -0.0009648 * t * t + 120.67 * t - 130, 5.154) },

    // ---- Two pyroxenes (Brey & Köhler, 1990) ----------------------------------------------
    { id: "T_Brey1990", system: "two_px", kind: "T", src: PUB, name: "Brey & Köhler (1990) two-pyroxene (T_BKN)", doi: "10.1093/petrology/31.6.1353", see: "±15 °C",
      range: "Four-phase lherzolites, 900–1400 °C, 10–60 kbar",
      // eq. (9): T = [23 664 + (24.9 + 126.3 X_Fe^cpx)P] / [13.38 + (ln K_D*)² + 11.59 X_Fe^opx];
      // eqs (7)–(8): Ca* = Ca/(1 − Na), K_D* = (1 − Ca*)cpx/(1 − Ca*)opx; X_Fe = Fe/(Fe + Mg)
      fn: (s, P) => {
        const c = s.Cpx.cat, o = s.Opx.cat, caStar = (x) => x.Ca / (1 - x.Na);
        const KD = (1 - caStar(c)) / (1 - caStar(o));
        return (23664 + (24.9 + 126.3 * c.Fe / (c.Fe + c.Mg)) * P) / (13.38 + ln(KD) ** 2 + 11.59 * o.Fe / (o.Fe + o.Mg));
      } },
    { id: "T_Brey1990_CaOpx", system: "two_px", kind: "T", src: PUB, name: "Brey & Köhler (1990) Ca-in-Opx", doi: "10.1093/petrology/31.6.1353", see: "±19 °C",
      range: "Opx coexisting with Cpx; 900–1400 °C", fn: (s, P) => (6425 + 26.4 * P) / (-ln(s.Opx.cat.Ca) + 1.843) },
    { id: "T_Brey1990_Na", system: "two_px", kind: "T", src: PUB, name: "Brey & Köhler (1990) Na partitioning", doi: "10.1093/petrology/31.6.1353", see: "±56 °C",
      range: "Natural lherzolites; D_Na = Na(opx)/Na(cpx); ±56 °C is the agreement with T_BKN (eq. 11)", fn: (s, P) => (35000 + 61.5 * P) / (ln(s.Opx.cat.Na / s.Cpx.cat.Na) ** 2 + 19.8) },

    // ---- Olivine–spinel oxybarometry ---------------------------------------------------------
    { id: "fO2_Ballhaus1991", system: "ol_sp", kind: "fO2", src: PUB, name: "Ballhaus et al. (1991) ΔFMQ", doi: "10.1007/BF00311183", see: "±0.4 log units",
      range: "Spinel peridotites; Opx-saturated; Fe3+ from spinel stoichiometry",
      fn: (s, T, P) => {
        const xFe = 1 - s.Ol.Fo, sp = s.Sp;
        return 0.27 + 2505 / T - 400 * (P / 10) / T - 6 * log10(xFe) - 3200 * (1 - xFe) ** 2 / T
          + 2 * log10(sp.XFe2) + 4 * log10(sp.XFe3) + 2630 * sp.XAl ** 2 / T;
      } },

    // ---- Trace-element thermometers (ppm and activities) --------------------------------------
    { id: "T_Watson2006_TiZrc", system: "trace", kind: "T", src: PUB, name: "Ti-in-zircon, Watson et al. (2006)", doi: "10.1007/s00410-006-0068-5", see: "±10 °C",
      range: "a_TiO2 ≈ 1, a_SiO2 = 1", inputs: ["Ti_zrc"], fn: (s) => 5080 / (6.01 - log10(s.Trace.Ti_zrc)) },
    { id: "T_FerryWatson2007_TiZrc", system: "trace", kind: "T", src: PUB, name: "Ti-in-zircon, Ferry & Watson (2007)", doi: "10.1007/s00410-007-0201-0", see: "±10 °C",
      range: "Activity-corrected", inputs: ["Ti_zrc", "aTiO2", "aSiO2"],
      fn: (s) => { const t = s.Trace; return 4800 / (5.711 - log10(t.Ti_zrc) - log10(t.aSiO2) + log10(t.aTiO2)); } },
    { id: "T_Watson2006_ZrRt", system: "trace", kind: "T", src: PUB, name: "Zr-in-rutile, Watson et al. (2006)", doi: "10.1007/s00410-006-0068-5", see: "±10 °C",
      range: "Rutile + zircon + quartz", inputs: ["Zr_rt"], fn: (s) => 4470 / (7.36 - log10(s.Trace.Zr_rt)) },
    { id: "T_FerryWatson2007_ZrRt", system: "trace", kind: "T", src: PUB, name: "Zr-in-rutile, Ferry & Watson (2007)", doi: "10.1007/s00410-007-0201-0", see: "±10 °C",
      range: "Activity-corrected", inputs: ["Zr_rt", "aSiO2"], fn: (s) => 4530 / (7.420 - log10(s.Trace.aSiO2) - log10(s.Trace.Zr_rt)) },
    ...[["alpha", "α-quartz", 83.9, 0.410, 0.1428], ["beta", "β-quartz", 85.7, 0.473, 0.1453], ["coe", "coesite", 88.1, 0.206, 0.1412]].map(([k, lbl, a, b, c]) => ({
      id: "T_Tomkins2007_" + k, system: "trace", kind: "T", src: PUB, name: `Zr-in-rutile, Tomkins et al. (2007), ${lbl} field`, doi: "10.1111/j.1525-1314.2007.00724.x", see: "±20 °C",
      range: `Rutile + zircon + ${lbl}; α/β-quartz boundary ≈ T(°C) = 430 + 25P(kbar)`, inputs: ["Zr_rt"],
      fn: (s, P) => (a + b * P) / (c - 0.0083144 * ln(s.Trace.Zr_rt)) + 0.15 })),
    { id: "T_Hayden2008_ZrTtn", system: "trace", kind: "T", src: PUB, name: "Zr-in-titanite, Hayden et al. (2008)", doi: "10.1007/s00410-007-0256-y", see: "±20 °C",
      range: "Titanite + rutile/zircon/quartz buffered", inputs: ["Zr_ttn", "aTiO2", "aSiO2"],
      fn: (s, P) => { const t = s.Trace; return (7708 + 960 * P / 10) / (10.52 - log10(t.Zr_ttn) - log10(t.aTiO2) - log10(t.aSiO2)) + 0.15; } },
    { id: "T_Henry2005_TiBt", system: "trace", kind: "T", src: PUB, name: "Ti-in-biotite, Henry et al. (2005)", doi: "10.2138/am.2005.1498", see: "±24 °C",
      range: "Graphitic peraluminous metapelites with ilmenite/rutile, 4–6 kbar; Ti 0.04–0.6 apfu, X_Mg 0.275–1 (22 O)", inputs: ["Ti_bt_apfu", "XMg_bt"],
      fn: (s) => { const t = s.Trace; return Math.pow((ln(t.Ti_bt_apfu) + 2.3594 + 1.7283 * t.XMg_bt ** 3) / 4.6482e-9, 0.333) + 273.15; } },
    { id: "T_Thomas2010_TiQz", system: "trace", kind: "T", src: PUB, name: "Ti-in-quartz, Thomas et al. (2010)", doi: "10.1007/s00410-010-0505-3", see: "±20 °C",
      range: "5–20 kbar, 700–940 °C experiments", inputs: ["Ti_qz", "aTiO2"],
      fn: (s, P) => {
        const t = s.Trace, mTi = t.Ti_qz / ATOMIC_WEIGHT.Ti;
        const X = mTi / (mTi + (1e6 - t.Ti_qz * OX.TiO2.mw / ATOMIC_WEIGHT.Ti) / OX.SiO2.mw); // mole fraction TiO2 in quartz
        return (60952 + 1741 * P) / (1.520 - R * ln(X) + R * ln(t.aTiO2));
      } },
    { id: "T_Huang2012_TiQz", system: "trace", kind: "T", src: PUB, name: "Ti-in-quartz, Huang & Audétat (2012)", doi: "10.1016/j.gca.2012.01.009", see: "±30 °C",
      range: "Rutile-saturated; 1–10 kbar", inputs: ["Ti_qz"], fn: (s, P) => (2794.3 + 660.53 * Math.pow(P, 0.35)) / (5.6459 - log10(s.Trace.Ti_qz)) },

    // ---- Accessory-mineral saturation; D_Zr = 497,644 ppm (stoichiometric Zr in zircon) / Zr_melt; apatite 42 wt% P2O5 ----
    { id: "T_Watson1983_Zrc", system: "liq_only", kind: "T", src: PUB, name: "Zircon saturation, Watson & Harrison (1983)", doi: "10.1016/0012-821X(83)90211-X", see: "±30 °C",
      range: "Zircon-saturated crustal melts; requires Zr (ppm) in melt", fn: (s) => 12900 / (ln(497644 / pos(liqWt(s, "Zr_ppm"))) + 3.80 + 0.85 * (zirconM(s.Liq.cf) - 1)) },
    { id: "T_Boehnke2013_Zrc", system: "liq_only", kind: "T", src: PUB, name: "Zircon saturation, Boehnke et al. (2013)", doi: "10.1016/j.chemgeo.2013.05.028", see: "±30 °C",
      range: "Zircon-saturated crustal melts; requires Zr (ppm) in melt", fn: (s) => 10108 / (ln(497644 / pos(liqWt(s, "Zr_ppm"))) + 1.48 + 1.16 * (zirconM(s.Liq.cf) - 1)) },
    { id: "T_Harrison1984_Ap", system: "liq_only", kind: "T", src: PUB, name: "Apatite saturation, Harrison & Watson (1984)", doi: "10.1016/0016-7037(84)90403-4", see: "±50 °C",
      range: "Apatite-saturated metaluminous melts, 45–75 wt% SiO2",
      fn: (s) => { const x = liqWt(s, "SiO2") / 100 - 0.5; return (8400 + x * 2.64e4) / (ln(42 / pos(liqWt(s, "P2O5"))) + 3.1 + 12.4 * x); } }
  ];

  // ---- Putirka (2008), Rev. Mineral. Geochem. 69, 61–120; equation numbers are the paper's ----------------------
  // l = melt cation fractions (Table 1); X_Al^cpx etc. are cations on 6 O; Mg# = Mg/(Mg + Fe) with total Fe.
  const P08 = "10.2138/rmg.2008.69.3", K = 273.15;
  const p08 = (id, system, kind, name, see, range, fn) => ({ id, system, kind, src: PUB, name: `Putirka (2008) ${name}`, doi: P08, see, range, fn });
  const dMg = (s) => s.Ol.cf.Mg / s.Liq.p.Mg; // D_Mg(ol/liq), cation fractions
  const anCaAlSi = (s) => { const l = s.Liq.p; return ln(s.Pl.An / (l.Ca * l.Al ** 2 * l.Si ** 2)); };
  /** Fe3+ by charge balance after Papike et al. (1974), limited to 0 ≤ Fe3+ ≤ Fe (eqs 38–39). */
  const papikeFe2 = (c, P) => c.Fe - Math.min(c.Fe, Math.max(0, P.AlIV + c.Na - P.AlVI - c.Cr - 2 * c.Ti));
  function aEnOpxWB(o, P) { // eq. 38: enstatite activity in opx after Wood & Banno (1973), 6 O
    const fe2 = papikeFe2(o, P), fe3 = o.Fe - fe2;
    return (0.5 * o.Mg / (o.Ca + 0.5 * o.Mg + 0.5 * fe2 + o.Mn + o.Na)) * (0.5 * o.Mg / (0.5 * fe2 + fe3 + P.AlVI + o.Ti + o.Cr + 0.5 * o.Mg));
  }
  const twoPxTerms = (s) => {
    const c = s.Cpx.cat, o = s.Opx.cat, cp = s.Cpx.P, op = s.Opx.P;
    return { c, o, cp, op, Kf: o.Ca / (1 - c.Ca), lnEnFs: ln(cp.EnFs / op.Fm2Si2O6) };
  };
  EQUATIONS.push(
    // Liquid-only (saturation) thermometers
    p08("T_Put2008_eq13", "liq_only", "T", "eq. 13, olivine-saturated MgO", "±71 °C", "Olivine-saturated liquids; MgO in wt%", (s) => 26.3 * liqWt(s, "MgO") + 994.4 + K),
    p08("T_Put2008_eq14", "liq_only", "T", "eq. 14, olivine-saturated (P-independent)", "±51 °C", "Olivine-saturated liquids, 0.0001–14.4 GPa, 729–2000 °C; oxides in wt%",
      (s) => 754 + 190.6 * s.Liq.MgNo + 25.52 * liqWt(s, "MgO") + 9.585 * liqWt(s, "FeOt") + 14.87 * (liqWt(s, "Na2O") + liqWt(s, "K2O")) - 9.176 * s.Liq.H2O + K),
    p08("T_Put2008_eq15", "liq_only", "T", "eq. 15, olivine-saturated (P-dependent)", "±60 °C", "Olivine-saturated liquids, 0.0001–14.4 GPa, 729–2000 °C; oxides in wt%",
      (s, P) => 815.3 + 265.5 * s.Liq.MgNo + 15.37 * liqWt(s, "MgO") + 8.61 * liqWt(s, "FeOt") + 6.646 * (liqWt(s, "Na2O") + liqWt(s, "K2O")) + 39.16 * (P / 10) - 12.83 * s.Liq.H2O + K),
    p08("T_Put2008_eq16", "liq_only", "T", "eq. 16, Ol + Pl + Cpx saturated", "±19–26 °C", "Liquids saturated in olivine + plagioclase + clinopyroxene; oxide mole fractions",
      (s, P) => { const m = s.Liq.mf; return -583 + 3141 * m.SiO2 + 15779 * m.Al2O3 + 1338.6 * m.MgO - 31440 * m.SiO2 * m.Al2O3 + 77.67 * (P / 10) + K; }),
    p08("T_Put2008_eq28b_opx_sat", "liq_only", "T", "eq. 28b, orthopyroxene saturation", "±48 °C", "Orthopyroxene-saturated liquids, 750–1600 °C",
      (s, P) => { const l = s.Liq, Pg = P / 10; return (5573.8 + 587.9 * Pg - 61 * Pg ** 2) / (5.3 - 0.633 * ln(l.MgNo) - 3.97 * l.CNM + 0.06 * l.NF + 24.7 * l.p.Ca ** 2 + 0.081 * l.H2O + 0.156 * Pg) + K; }),
    p08("T_Put2008_eq34_cpx_sat", "liq_only", "T", "eq. 34, clinopyroxene saturation", "±45 °C", "Clinopyroxene-saturated liquids, P < 70 kbar",
      (s, P) => { const l = s.Liq.p; return 1e4 / (6.39 + 0.076 * s.Liq.H2O - 5.55 * l.Ca * l.Si - 0.386 * ln(l.Mg) - 0.046 * P + 2.2e-4 * P ** 2); }),
    p08("T_Put2008_eq26_plag_sat", "liq_only", "T", "eq. 26, plagioclase saturation", "±37 °C", "Plagioclase-saturated liquids",
      (s, P) => { const l = s.Liq.p; return 1e4 / (10.86 - 9.7654 * l.Si + 4.241 * l.Ca - 55.56 * l.Ca * l.Al + 37.50 * l.K * l.Al + 11.206 * l.Si ** 3 - 3.151e-2 * P + 0.1709 * s.Liq.H2O); }),
    p08("T_Put2008_eq24c_kspar_sat", "liq_only", "T", "eq. 24c, alkali feldspar saturation", "not stated", "Alkali feldspar-saturated liquids",
      (s, P) => { const l = s.Liq.p; return 1e4 / (14.6 + 0.055 * s.Liq.H2O - 0.06 * P - 99.6 * l.Na * l.Al - 2313 * l.Ca * l.Al + 395 * l.K * l.Al - 151 * l.K * l.Si + 15037 * l.Ca ** 2); }),

    // Olivine–liquid
    p08("T_Put2008_eq19", "ol_liq", "T", "eq. 19 (Beattie, 1993, recast)", "±53 °C", "Anhydrous systems; D_Mg = X_Mg(ol)/X_Mg(liq), cation fractions",
      // printed "(P(GPa)·10⁹ − 10⁻⁵)": the 1-bar reference is 10⁵ Pa (the printed exponent is a typesetting slip; effect < 0.01 K)
      (s, P) => { const l = s.Liq; return (13603 + 4.943e-7 * ((P / 10) * 1e9 - 1e5)) / (6.26 + 2 * ln(dMg(s)) + 2 * ln(1.5 * l.CNM) + 2 * ln(3 * l.p.Si) - l.NF); }),
    p08("T_Put2008_eq21", "ol_liq", "T", "eq. 21", "±52 °C", "Hydrous and anhydrous; H2O and Na2O + K2O in wt%",
      (s, P) => (55.09 * (P / 10) + 4430) / (ln(dMg(s)) + 2.158 + 6.213e-2 * s.Liq.H2O - 5.115e-2 * (liqWt(s, "Na2O") + liqWt(s, "K2O"))) + K),
    p08("T_Put2008_eq22", "ol_liq", "T", "eq. 22", "±43 °C", "Hydrous and anhydrous; best when H2O is present",
      (s, P) => { const l = s.Liq, Pg = P / 10; return (15294.6 + 1318.8 * Pg + 2.4834 * Pg ** 2) / (8.048 + 2.8352 * ln(dMg(s)) + 2.097 * ln(1.5 * l.CNM) + 2.575 * ln(3 * l.p.Si) - 1.41 * l.NF + 0.222 * l.H2O + 0.5 * Pg) + K; }),

    // Plagioclase–liquid, alkali feldspar–liquid, two feldspars
    p08("T_Put2008_eq23", "plag_liq", "T", "eq. 23", "±43 °C", "Plagioclase–liquid; H2O in wt%",
      (s, P) => { const l = s.Liq.p; return 1e4 / (6.12 + 0.257 * anCaAlSi(s) - 3.166 * l.Ca - 3.137 * (l.Al / (l.Al + l.Si)) + 1.216 * s.Pl.Ab ** 2 - 2.475e-2 * P + 0.2166 * s.Liq.H2O); }),
    p08("T_Put2008_eq24a", "plag_liq", "T", "eq. 24a", "±36 °C", "Plagioclase–liquid, global calibration; H2O in wt%",
      (s, P) => { const l = s.Liq.p; return 1e4 / (6.4706 + 0.3128 * anCaAlSi(s) - 8.103 * l.Si + 4.872 * l.K + 1.5346 * s.Pl.Ab ** 2 + 8.661 * l.Si ** 2 - 3.341e-2 * P + 0.18047 * s.Liq.H2O); }),
    p08("P_Put2008_eq25", "plag_liq", "P", "eq. 25a (Putirka, 2005)", "±3.8 kbar", "Plagioclase–liquid barometer; not recommended outside well-studied natural compositions",
      (s, T) => { const l = s.Liq.p, pl = s.Pl; return -42.2 + 4.94e-2 * T + 1.16e-2 * T * ln((pl.Ab * l.Al * l.Ca) / (pl.An * l.Na * l.Si)) - 382.3 * l.Si ** 2 + 514.2 * l.Si ** 3 - 19.6 * ln(pl.Ab) - 139.8 * l.Ca + 287.2 * l.Na + 163.9 * l.K; }),
    p08("H_Put2008_eq25b", "plag_liq", "H2O", "eq. 25b hygrometer", "±1.1 wt%", "Plagioclase–liquid; very sensitive to T (±38 °C ≈ ±1 wt%)",
      (s, T, P) => { const l = s.Liq.p; return 25.95 - 0.0032 * (T - K) * anCaAlSi(s) - 18.9 * l.K + 14.5 * l.Mg - 40.3 * l.Ca + 5.7 * s.Pl.An ** 2 + 0.108 * P; }),
    p08("T_Put2008_eq24b", "kfs_liq", "T", "eq. 24b", "±23 °C", "Alkali feldspar–liquid, natural compositions, T < 1050 °C",
      (s, P) => { const l = s.Liq.p; return 1e4 / (17.3 - 1.03 * ln(s.Kfs.Ab / (l.Na * l.Al * l.Si ** 3)) - 200 * l.Ca - 2.42 * l.Na - 29.8 * l.K + 13500 * (l.Ca - 0.0037) ** 2 - 550 * (l.K - 0.056) * (l.Na - 0.089) - 0.078 * P); }),
    p08("T_Put2008_eq27a", "two_fsp", "T", "eq. 27a", "±23–44 °C", "Plagioclase + alkali feldspar; ±23 °C calibration, ±44 °C test data",
      (s, P) => { const a = s.Kfs, pl = s.Pl; return 1e4 / (9.8 - 0.098 * P - 2.46 * ln(a.Ab / pl.Ab) - 14.2 * a.cf.Si + 423 * a.cf.Ca - 2.42 * ln(a.An) - 11.4 * pl.An * pl.Ab) + K; }),
    p08("T_Put2008_eq27b", "two_fsp", "T", "eq. 27b", "±30 °C", "Plagioclase + alkali feldspar, global calibration",
      (s, P) => { const a = s.Kfs, pl = s.Pl; return (-442 - 3.72 * P) / (-0.11 + 0.1 * ln(a.Ab / pl.Ab) - 3.27 * a.An + 0.098 * ln(a.An) + 0.52 * pl.An * pl.Ab) + K; }),

    // Orthopyroxene–liquid and orthopyroxene-only
    p08("T_Put2008_eq28a", "opx_liq", "T", "eq. 28a", "±26–41 °C", "750–1600 °C, 0.0001–11 GPa, 33–77 wt% SiO2, 0–14.2 wt% H2O; Fm = Fe + Mn + Mg",
      (s, P) => { const l = s.Liq.p, o = s.Opx; return 1e4 / (4.07 - 0.329 * (P / 10) + 0.12 * s.Liq.H2O + 0.567 * ln(o.P.Fm2Si2O6 / (l.Si ** 2 * (l.Fe + l.Mn + l.Mg) ** 2)) - 3.06 * l.Mg - 6.17 * l.K + 1.89 * s.Liq.MgNo + 2.57 * o.cat.Fe) + K; }),
    p08("P_Put2008_eq29a", "opx_liq", "P", "eq. 29a", "±2.6 kbar", "Opx–liquid; underestimates P above 30 kbar",
      (s, T) => { const l = s.Liq.p, o = s.Opx, Tc = T - K; return -13.97 + 0.0129 * Tc + 0.001416 * Tc * ln(o.P.NaAlSi2O6 / (l.Na * l.Al * l.Si ** 2)) - 19.64 * l.Si + 47.49 * l.Mg + 6.99 * o.cat.Fe + 37.37 * o.P.FmAl2SiO6 + 0.748 * s.Liq.H2O + 79.67 * (l.Na + l.K); }),
    p08("P_Put2008_eq29b", "opx_liq", "P", "eq. 29b", "±2.6 kbar", "Opx–liquid; SEE not stated separately (±2.6 kbar given for eq. 29a); Fm = Fe + Mn + Mg",
      (s, T) => { const l = s.Liq.p, o = s.Opx, Tc = T - K; return 1.788 + 0.0375 * Tc + 1.295e-3 * Tc * ln(o.P.FmAl2SiO6 / ((l.Fe + l.Mn + l.Mg) * l.Al ** 2 * l.Si)) - 33.42 * l.Al + 9.795 * s.Liq.MgNo + 36.08 * (l.Na + l.K) + 0.784 * s.Liq.H2O - 26.2 * o.cat.Si + 14.21 * o.cat.Fe; }),
    p08("P_Put2008_eq29c", "opx_only", "P", "eq. 29c", "±2.5–3.6 kbar", "Opx-only; requires Cr in opx; ±2.5 kbar calibration, ±3.6 kbar global data",
      (s, T) => { const o = s.Opx.cat, Tc = T - K; return 2064 + 0.321 * Tc - 343.4 * ln(Tc) + 31.52 * o.Al - 12.28 * o.Ca - 290 * o.Cr + 1.54 * ln(o.Cr) - 177.2 * (o.Al - 0.1715) ** 2 - 372 * (o.Al - 0.1715) * (o.Ca - 0.0736); }),

    // Clinopyroxene–liquid and clinopyroxene-only
    p08("T_Put2008_eq33", "cpx_liq", "T", "eq. 33", "±45 °C", "Global calibration, P < 70 kbar; hydrous and anhydrous; Fm = Fe + Mn + Mg",
      (s, P) => { const l = s.Liq.p, c = s.Cpx; return 1e4 / (7.53 - 0.14 * ln((c.P.Jd * l.Ca * (l.Fe + l.Mn + l.Mg)) / (c.P.DiHd * l.Na * l.Al)) + 0.07 * s.Liq.H2O - 14.9 * l.Ca * l.Si - 0.08 * ln(l.Ti) - 3.62 * (l.Na + l.K) - 1.1 * s.Liq.MgNo - 0.18 * ln(c.P.EnFs) - 0.027 * P); }),
    p08("P_Put2008_eq30", "cpx_liq", "P", "eq. 30", "±3.6 kbar", "Cpx–liquid, P < 40 kbar (±1.6 kbar on calibration data)",
      (s, T) => { const l = s.Liq.p, c = s.Cpx; return -48.7 + 271 * T / 1e4 + 32 * (T / 1e4) * ln(c.P.Jd / (l.Na * l.Al * l.Si ** 2)) - 8.2 * ln(l.Fe) + 4.6 * ln(l.Mg) - 0.96 * ln(l.K) - 2.2 * ln(c.P.DiHd) - 31 * s.Liq.MgNo + 56 * (l.Na + l.K) + 0.76 * s.Liq.H2O; }),
    p08("P_Put2008_eq31", "cpx_liq", "P", "eq. 31", "±2.9 kbar", "Cpx–liquid, global calibration, P < 40 kbar, excluding 1-atm data",
      (s, T) => { const l = s.Liq.p, c = s.Cpx; return -40.73 + 358 * T / 1e4 + 21.69 * (T / 1e4) * ln(c.P.Jd / (l.Na * l.Al * l.Si ** 2)) - 105.7 * l.Ca - 165.5 * (l.Na + l.K) ** 2 - 50.15 * l.Si * (l.Fe + l.Mg) - 3.178 * ln(c.P.DiHd) - 2.205 * ln(c.P.EnFs) + 0.864 * ln(c.cat.Al) + 0.3962 * s.Liq.H2O; }),
    p08("P_Put2008_eq32c", "cpx_liq", "P", "eq. 32c (Al partitioning)", "±1.5–5 kbar", "Cpx–liquid; ±1.5 kbar on calibration data, ±5 kbar on all data",
      (s, T) => { const l = s.Liq.p, c = s.Cpx; return -57.9 + 0.0475 * T - 40.6 * l.Fe - 47.7 * c.P.CaTs + 0.676 * s.Liq.H2O - 153 * l.Ca * l.Si + 6.89 * (c.cat.Al / l.Al); }),
    p08("P_Put2008_eq32a", "cpx_only", "P", "eq. 32a", "±3.1 kbar", "Cpx-only, 0.001–80 kbar; systematic error for hydrous compositions",
      (s, T) => { const c = s.Cpx.cat, p = s.Cpx.P; return 3205 + 0.384 * T - 518 * ln(T) - 5.62 * c.Mg + 83.2 * c.Na + 68.2 * p.DiHd + 2.52 * ln(p.AlVI) - 51.1 * p.DiHd ** 2 + 34.8 * p.EnFs ** 2; }),
    p08("T_Put2008_eq32d", "cpx_only", "T", "eq. 32d", "±58 °C", "Cpx-only (±58 °C anhydrous, ±87 °C hydrous); a_En after Nimis & Taylor (2000)",
      (s, P) => { const c = s.Cpx.cat, aEn = (1 - c.Ca - c.Na - c.K) * (1 - 0.5 * (c.Al + c.Cr + c.Na + c.K)); return (93100 + 544 * P) / (61.1 + 36.6 * c.Ti + 10.9 * c.Fe - 0.95 * (c.Al + c.Cr - c.Na - c.K) + 0.395 * ln(aEn) ** 2); }),

    // Two pyroxenes (eqs 36, 37 are printed as 10⁴/T(°C); eq. 39 uses T in °C)
    p08("T_Put2008_eq36", "two_px", "T", "eq. 36", "±56 °C", "Cpx–Opx, global calibration (±45 °C for Mg#cpx > 0.75)",
      (s, P) => { const t = twoPxTerms(s); return 1e4 / (11.2 - 1.96 * t.lnEnFs - 3.3 * t.c.Ca - 25.8 * t.cp.CrCaTs + 33.2 * t.o.Mn - 23.6 * t.o.Na - 2.08 * t.op.En - 8.33 * t.op.Di - 0.05 * P) + K; }),
    p08("T_Put2008_eq37", "two_px", "T", "eq. 37", "±38 °C", "Cpx–Opx with Mg#cpx > 0.75; X_Di(cpx) taken as DiHd·Mg/(Mg + Fe + Mn), by analogy with X_Di(opx)",
      (s, P) => { const t = twoPxTerms(s), mgno = t.c.Mg / (t.c.Mg + t.c.Fe), diCpx = t.cp.DiHd * t.c.Mg / (t.c.Mg + t.c.Fe + t.c.Mn); return 1e4 / (13.4 - 3.4 * t.lnEnFs + 5.59 * ln(t.c.Mg) - 8.8 * mgno + 23.85 * t.o.Mn + 6.48 * t.op.FmAl2SiO6 - 2.38 * diCpx - 0.044 * P) + K; }),
    p08("P_Put2008_eq38", "two_px", "P", "eq. 38", "±3.7 kbar", "Cpx–Opx with Mg#cpx > 0.75; T-independent; K_f = Ca(opx)/(1 − Ca(cpx))",
      (s) => { const t = twoPxTerms(s); return -279.8 + 293 * t.op.AlVI + 455 * t.o.Na + 229 * t.o.Cr + 519 * t.op.Fm2Si2O6 - 563 * t.op.En + 371 * t.op.Di + 327 * aEnOpxWB(t.o, t.op) + 1.19 / t.Kf; }),
    p08("P_Put2008_eq39", "two_px", "P", "eq. 39", "±2.8 kbar", "Cpx–Opx with Mg#cpx > 0.75",
      (s, T) => {
        const t = twoPxTerms(s), fe2 = papikeFe2(t.c, t.cp), aDi = t.c.Ca / (t.c.Ca + 0.5 * t.c.Mg + 0.5 * fe2 + t.c.Mn + t.c.Na);
        return -94.25 + 0.045 * (T - K) + 187.7 * t.op.AlVI + 246.8 * t.op.Fm2Si2O6 - 212.5 * t.op.En + 127.5 * aEnOpxWB(t.o, t.op) - 1.66 / t.Kf - 69.4 * t.cp.EnFs - 133.9 * aDi;
      })
  );

  // ---- Putirka et al. (1996), Contrib. Mineral. Petrol. 123, 92–108, Table 5 (T in K, Fm = FeO + MgO) -----------------
  // DiHd: Ca left after forming CaTs and CaTiAl2O6 (their normative scheme; no CrCaTs term).
  const P96 = "10.1007/s004100050145";
  const p96 = (s) => {
    const l = s.Liq.p, c = s.Cpx.P, DiHd = c.DiHd + c.CrCaTs;
    return { l, lnKJd: ln(c.Jd / (l.Si ** 2 * l.Na * l.Al)), lnKex: ln((c.Jd * l.Ca * (l.Fe + l.Mg)) / (DiHd * l.Na * l.Al)), mgLiq: l.Mg / (l.Mg + l.Fe) };
  };
  EQUATIONS.push(
    { id: "P_Put1996_eqP1", system: "cpx_liq", kind: "P", src: PUB, name: "Putirka et al. (1996) P1", doi: P96, see: "±1.36 kbar", range: "Cpx–liquid, 8–30 kbar, anhydrous mafic melts",
      fn: (s, T) => { const t = p96(s); return -54.3 + 299 * T / 1e4 + 36.4 * (T / 1e4) * t.lnKJd + 367 * t.l.Na * t.l.Al; } },
    { id: "P_Put1996_eqP2", system: "cpx_liq", kind: "P", src: PUB, name: "Putirka et al. (1996) P2", doi: P96, see: "±1.51 kbar", range: "Cpx–liquid, 8–30 kbar, anhydrous mafic melts",
      fn: (s, T) => { const t = p96(s); return -50.7 + 394 * T / 1e4 + 36.4 * (T / 1e4) * t.lnKJd - 20.0 * (T / 1e4) * ln(1 / (t.l.Na * t.l.Al)); } },
    { id: "T_Put1996_eqT1", system: "cpx_liq", kind: "T", src: PUB, name: "Putirka et al. (1996) T1", doi: P96, see: "±40 °C", range: "Cpx–liquid, anhydrous; P-independent",
      fn: (s) => { const t = p96(s); return 1e4 / (6.73 - 0.26 * t.lnKex - 0.86 * ln(t.mgLiq) + 0.52 * ln(t.l.Ca)); } },
    { id: "T_Put1996_eqT2", system: "cpx_liq", kind: "T", src: PUB, name: "Putirka et al. (1996) T2", doi: P96, see: "±30 °C", range: "Cpx–liquid, anhydrous",
      fn: (s, P) => { const t = p96(s); return 1e4 / (6.59 - 0.16 * t.lnKex - 0.65 * ln(t.mgLiq) + 0.23 * ln(t.l.Ca) - 0.02 * P); } }
  );

  // ---- Masotta et al. (2013), Contrib. Mineral. Petrol. 166, 1545–1561 -------------------------------------------------
  // Recalibrations of Putirka et al. (1996) T1, T2, P1, P2 and Putirka (2008) eqs 33, 32c with the coefficients of their Table 3,
  // and the new Talk2012 / Palk2012. Coefficients at full precision from the authors' supplementary spreadsheet (rounded in their Table 3).
  const MAS = "10.1007/s00410-013-0927-9", MAS_RANGE = "Alkaline differentiated (trachytic–phonolitic) magmas only; barometers calibrated with experiments at 0.5–15 kbar";
  const kdFeMg = (s) => (s.Cpx.cat.Fe / s.Cpx.cat.Mg) / (s.Liq.p.Fe / s.Liq.p.Mg);
  const mas = (id, kind, name, see, fn) => ({ id, system: "cpx_liq", kind, src: PUB, name: `Masotta et al. (2013) ${name}`, doi: MAS, see, range: MAS_RANGE, restricted: true, fn }); // restricted: left out of ensembles unless asked for
  EQUATIONS.push(
    mas("T_Mas2013_eqTalk1", "T", "Talk1", "±31.6 °C", (s) => { const t = p96(s); return 1e4 / (6.742313 - 0.023237 * t.lnKex - 0.688394 * ln(t.mgLiq) - 0.153193 * ln(t.l.Ca)); }),
    mas("T_Mas2013_eqTalk2", "T", "Talk2", "±31.2 °C", (s, P) => { const t = p96(s); return 1e4 / (6.523963 - 0.039654 * t.lnKex - 0.680639 * ln(t.mgLiq) - 0.145757 * ln(t.l.Ca) + 0.079058 * P); }),
    mas("T_Mas2013_eqalk33", "T", "Talk33", "±24.0 °C", (s, P) => {
      const l = s.Liq.p, c = s.Cpx;
      return 1e4 / (6.807289 + 0.002683 * ln((c.P.Jd * l.Ca * (l.Fe + l.Mg)) / (c.P.DiHd * l.Na * l.Al)) + 0.050099 * s.Liq.H2O - 25.042979 * l.Ca * l.Si - 0.304201 * ln(l.Ti) + 2.254442 * (l.Na + l.K) - 1.914496 * s.Liq.MgNo - 0.021073 * ln(c.P.EnFs) + 0.061473 * P);
    }),
    mas("T_Mas2013_Talk2012", "T", "Talk2012", "±18.2 °C", (s) => {
      const l = s.Liq.p, c = s.Cpx.P;
      return 1e4 / (2.908156 - 0.400828 * ln((c.Jd * l.Ca * (l.Fe + l.Mg)) / (c.DiHd * l.Na * l.Al)) + 0.037572 * s.Liq.H2O - 1.638328 * (l.Mg / (l.Mg + l.Fe)) / c.DiHd
        + 1.011298 * l.Na / (l.Na + l.K) - 0.217667 * ln(l.Ti) + 0.46615 * ln(c.Jd / (l.Na * l.Al * l.Si ** 2)) + 1.616268 * kdFeMg(s) + 23.385505 * l.Ca * l.Si);
    }),
    mas("P_Mas2013_eqPalk1", "P", "Palk1", "±1.71 kbar", (s, T) => { const t = p96(s); return -8.837635 + 79.049772 * T / 1e4 + 11.647441 * (T / 1e4) * t.lnKJd + 8.633126 * t.l.Na * t.l.Al; }),
    mas("P_Mas2013_eqPalk2", "P", "Palk2", "±1.70 kbar", (s, T) => { const t = p96(s); return -6.283323 + 38.179622 * T / 1e4 + 9.421053 * (T / 1e4) * t.lnKJd + 6.156419 * (T / 1e4) * ln(1 / (t.l.Na * t.l.Al)); }), // P2 form: d·(T/10⁴)·ln[1/(Na·Al)]
    mas("P_Mas2013_eqalk32c", "P", "Palk32c", "±1.67 kbar", (s, T) => {
      const l = s.Liq.p, c = s.Cpx; return -16.344654 + 0.014144 * T - 12.390951 * l.Fe - 9.192207 * c.P.CaTs + 0.214042 * s.Liq.H2O + 38.734046 * l.Ca * l.Si + 1.59442 * (c.cat.Al / l.Al);
    }),
    mas("P_Mas2013_Palk2012", "P", "Palk2012", "±1.15 kbar", (s) => {
      const l = s.Liq.p; return -3.88904 + 0.277651 * (s.Cpx.P.Jd / (l.Na * l.Al * l.Si ** 2)) + 0.074029 * s.Liq.H2O + 5.009121 * l.Na / (l.Na + l.K) + 6.394514 * kdFeMg(s);
    })
  );

  // ---- Ridolfi & Renzulli (2012), Contrib. Mineral. Petrol. 163, 877–895, Table 3 -----------------------------------------
  // Amphibole cations on 13 cations; P in MPa (converted to kbar here). Coefficients: constant, Si, Ti, Al, Fe, Mg, Ca, Na, K.
  const RR12 = "10.1007/s00410-011-0704-6", RR_RANGE = "Calcic amphibole in calc-alkaline and alkaline magmas, 800–1130 °C, 130–2200 MPa";
  const rr = (a, c) => a[0] + a[1] * c.Si + a[2] * c.Ti + a[3] * c.Al + a[4] * c.Fe + a[5] * c.Mg + a[6] * c.Ca + a[7] * c.Na + a[8] * c.K;
  const RR_P = {
    "1a": [true, "±19.3 %", "130–2200 MPa", [125.93, -9.5876, -10.116, -8.1735, -9.2261, -8.7934, -1.6659, 2.4835, 2.5192]],
    "1b": [true, "±13.1 %", "130–500 MPa", [38.723, -2.6957, -2.3565, -1.3006, -2.7780, -2.4838, -0.6614, -0.2705, 0.1117]],
    "1c": [false, "±14.9 %", "130–500 MPa", [24023, -1925.3, -1720.6, -1478.5, -1843.2, -1746.9, -158.28, -40.444, 253.52]],
    "1d": [false, "±17.3 %", "400–1500 MPa", [26106, -1991.9, -3035.0, -1472.2, -2454.8, -2125.8, -830.64, 2708.8, 2204.1]],
    "1e": [true, "±11.4 %", "930–2200 MPa", [26.543, -1.2085, -3.8593, -1.1054, -2.9068, -2.6483, 0.5134, 2.9752, 1.8147]]
  };
  for (const [k, [isLn, see, prange, a]] of Object.entries(RR_P)) EQUATIONS.push({
    id: `P_Ridolfi2012_${k}`, system: "amp_only", kind: "P", src: PUB, name: `Ridolfi & Renzulli (2012) eq. ${k}`, doi: RR12, see,
    range: `${RR_RANGE}; calibrated for ${prange}; T-independent. The paper's combined procedure for choosing among eqs 1b–1e is not yet implemented.`,
    fn: (s) => { const v = rr(a, s.Amp.c13); return (isLn ? Math.exp(v) : v) / 100; }
  });
  EQUATIONS.push({ id: "T_Ridolfi2012", system: "amp_only", kind: "T", src: PUB, name: "Ridolfi & Renzulli (2012) eq. 2", doi: RR12, see: "±23.5 °C", range: RR_RANGE,
    // T(°C) = Table 3 sum + 24.410·ln P(MPa)
    fn: (s, P) => rr([17098, -1322.3, -1035.1, -1208.2, -1230.4, -1152.9, -130.40, 200.54, 29.408], s.Amp.c13) + 24.410 * ln(P * 100) + K });

  // ======================= Equations added from their original papers (see each DOI/reference) =======================
  const add = (id, system, kind, name, doi, see, range, fn, ref) => EQUATIONS.push({ id, system, kind, src: PUB, name, doi: doi || null, ref, see, range, fn });

  // ---- Al-in-hornblende barometers: Al_T = total Al per 23 O. Valid only for the buffering granitoid assemblage
  //      quartz + plagioclase + K-feldspar + biotite + hornblende + titanite + Fe–Ti oxide + melt + fluid.
  const AL_HBL = "Granitoids with qz + pl + kfs + bt + hbl + ttn + Fe–Ti oxide, near the solidus; Al_T per 23 O";
  const alT = (s) => s.Amp.c23.Al;
  add("P_Hammarstrom1986_eq1", "amp_only", "P", "Hammarstrom & Zen (1986)", null, "±3 kbar", AL_HBL, (s) => -3.92 + 5.03 * alT(s), "Am. Mineral. 71, 1297–1313");
  add("P_Hollister1987", "amp_only", "P", "Hollister et al. (1987)", null, "±1 kbar", AL_HBL, (s) => -4.76 + 5.64 * alT(s), "Am. Mineral. 72, 231–239");
  add("P_Johnson1989", "amp_only", "P", "Johnson & Rutherford (1989)", "10.1130/0091-7613(1989)017<0837:ECOTAI>2.3.CO;2", "±0.5 kbar", AL_HBL, (s) => -3.46 + 4.23 * alT(s));
  add("P_Schmidt1992", "amp_only", "P", "Schmidt (1992)", "10.1007/BF00310745", "±0.6 kbar", AL_HBL, (s) => -3.01 + 4.76 * alT(s));
  add("P_Anderson1995", "amp_only", "P", "Anderson & Smith (1995)", "10.2138/am-1995-5-614", "±0.6 kbar", AL_HBL + "; T-corrected",
    (s, T) => { const a = alT(s), dT = T - K - 675; return 4.76 * a - 3.01 - (dT / 85) * (0.530 * a + 0.005294 * dT); });
  // ---- Ridolfi et al. (2010) eq. 4: P(MPa) = 19.209·exp(1.438·Al_T), Al_T on 13 cations
  add("P_Ridolfi2010", "amp_only", "P", "Ridolfi et al. (2010) eq. 4", "10.1007/s00410-009-0465-7", "±14 %", "Calc-alkaline volcanic amphibole, Al# ≤ 0.21, 130–1000 MPa; ±14 % below 450 MPa, up to 33 % at 1 GPa",
    (s) => 19.209 * Math.exp(1.438 * s.Amp.c13.Al) / 100);
  // ---- Putirka (2016): amphibole cations per 23 O, total Fe as FeO
  const P16 = "10.2138/am-2016-5506";
  add("T_Put2016_eq5", "amp_only", "T", "Putirka (2016) eq. 5", P16, "±30 °C", "Igneous amphibole; P-independent; cations per 23 O",
    (s) => { const c = s.Amp.c23; return 1781 - 132.74 * c.Si + 116.6 * c.Ti - 69.41 * c.Fe + 101.62 * c.Na + K; });
  add("T_Put2016_eq6", "amp_only", "T", "Putirka (2016) eq. 6", P16, "±30 °C", "Igneous amphibole; cations per 23 O",
    (s, P) => { const c = s.Amp.c23; return 1687 - 118.7 * c.Si + 131.56 * c.Ti - 71.41 * c.Fe + 86.13 * c.Na + 22.44 * (P / 10) + K; });
  add("T_Put2016_SiHbl", "amp_only", "T", "Putirka (2016) Si-in-hornblende", P16, "±44 °C", "Illustrative single-variable model, not recommended by its author; Si per 23 O", (s) => 1977 - 165 * s.Amp.c23.Si + K);

  // ---- Clinopyroxene–liquid and clinopyroxene-only ----
  add("P_Put2003", "cpx_liq", "P", "Putirka et al. (2003) model A", "10.2138/am-2003-1017", "±1.7 kbar", "Mafic to evolved, hydrous and anhydrous melts; 1 bar–40 kbar (±4 kbar over the full range)",
    (s, T) => { const l = s.Liq.p, c = s.Cpx.P; return -88.3 + 2.82e-3 * T * ln(c.Jd / (l.Na * l.Al * l.Si ** 2)) + 2.19e-2 * T - 25.1 * ln(l.Ca * l.Si) + 7.03 * (l.Mg / (l.Mg + l.Fe)) + 12.4 * ln(l.Ca); });
  add("T_Put2003", "cpx_liq", "T", "Putirka et al. (2003) model B", "10.2138/am-2003-1017", "±33 °C", "Mafic to evolved, hydrous and anhydrous melts; Fm = FeO + MgO",
    (s, P) => { const l = s.Liq.p, c = s.Cpx.P; return 1e4 / (4.60 - 4.37e-1 * ln((c.Jd * l.Ca * (l.Fe + l.Mg)) / (c.DiHd * l.Na * l.Al)) - 6.54e-1 * ln(l.Mg / (l.Mg + l.Fe)) - 3.26e-1 * ln(l.Na) - 6.32e-3 * P - 0.92 * ln(l.Si) + 2.74e-1 * ln(c.Jd)); });
  add("P_Neave2017", "cpx_liq", "P", "Neave & Putirka (2017)", "10.2138/am-2017-5968", "±1.4 kbar", "Ultramafic to intermediate, hydrous and anhydrous melts; 1 atm–20 kbar",
    // The printed equation shows (X_Na·X_K)²; the authors' supplementary spreadsheet (5968_suppCalc.xlsx) computes (X_Na + X_K)²,
    // which is also the form of Putirka (2008) eq. 31. Coefficients at the spreadsheet's precision.
    (s, T) => { const l = s.Liq.p, c = s.Cpx.P; return -26.2712 + 39.16138 * (T / 1e4) * ln(c.Jd / (l.Na * l.Al * l.Si ** 2)) - 4.21676 * ln(c.DiHd) + 78.43463 * l.Al + 393.8126 * (l.Na + l.K) ** 2; });
  add("P_Wang2021_eq1", "cpx_only", "P", "Wang et al. (2021) eq. 1", "10.5194/ejm-33-621-2021", "±1.66 kbar", "Mafic to intermediate melts (< 60 wt% SiO2), 1 bar–12 kbar; Al(VI) > 0; T-independent",
    // Coefficients from the authors' calculation sheet (Supplement, Table S2). The paper (Table 2) prints the intercept as 23.00; the
    // sheet uses 25.0019, which reproduces the 559 calibration experiments of Table S1 without bias (RMSE 1.59 kbar; 23.00 gives −1.9 kbar).
    (s) => { const c = s.Cpx.cat, a = s.Cpx.P.AlVI, nlt = 1.4844 * a / (1.4844 * a + 7.7408 * c.Ti + 1.1675 * c.Cr + 1.0604 * c.Fe + 0.0387 * c.Mn - 0.0628 * c.Mg); return -7.9509 * nlt * ln(a) + 0.6492 * c.Si - 5.9522 * c.Fe - 11.1942 * c.Mg - 24.2802 * c.Ca + 108.663 * c.Na + 25.0019; });

  // ---- Two pyroxenes: ideal two-site activities of Wood & Banno (1973, eqs 24–25): Ca, Na, Mn on M2; Al(VI), Cr, Ti (and Fe3+,
  //      from charge balance, Papike et al., 1974, limited to 0–Fe) on M1; Mg and Fe2+ distributed randomly over the remaining sites.
  const fe3Px = (c) => { const a4 = 2 - c.Si, a6 = Math.max(0, c.Al - a4); return Math.min(c.Fe, Math.max(0, c.Na + a4 - a6 - 2 * c.Ti - c.Cr)); };
  const aEn2site = (c) => { const f3 = fe3Px(c), mg = c.Mg / (c.Mg + c.Fe - f3), alVI = Math.max(0, c.Al - (2 - c.Si)); return (1 - c.Ca - c.Na - c.Mn) * mg * (1 - alVI - c.Cr - c.Ti - f3) * mg; };
  const lnKEn = (s) => ln(aEn2site(s.Cpx.cat) / aEn2site(s.Opx.cat));
  const xFeOpx = (s) => { const o = s.Opx.cat, fe2 = o.Fe - fe3Px(o); return fe2 / (fe2 + o.Mg); }; // Fe2+/(Fe2+ + Mg)
  add("T_Wood1973", "two_px", "T", "Wood & Banno (1973) eq. 27", "10.1007/BF00371501", "±60 °C", "Cpx–Opx; Fe3+ from charge balance",
    (s) => { const x = xFeOpx(s); return -10202 / (lnKEn(s) - 7.65 * x + 3.88 * x * x - 4.6); });
  add("T_Wells1977", "two_px", "T", "Wells (1977) eq. 5", "10.1007/BF00372872", "±70 °C", "Cpx–Opx, 785–1500 °C; Fe3+ from charge balance; 90 % of calibration data within 70 °C",
    (s) => 7341 / (3.355 + 2.44 * xFeOpx(s) - lnKEn(s)));

  // ---- Olivine–liquid and orthopyroxene–liquid, Beattie (1993) eqs 10–11 with Table 2 (ΔH kJ, ΔS J/K, ΔV cm³; P in Pa) ----
  const beattie = (dH, dS, dV, P) => [dH * 1e3 / R + (P * 1e8 - 1e5) * dV * 1e-6 / R, dS / R];
  add("T_Beattie1993", "ol_liq", "T", "Beattie (1993) eq. 10, olivine–liquid", "10.1007/BF00712982", "±14 °C", "Komatiitic to rhyolitic melts, 1060–1860 °C, to 4 GPa (anhydrous); D_Mg from olivine and liquid cation fractions",
    (s, P) => { const [n, d] = beattie(113.1, 52.05, 4.11, P), l = s.Liq; return n / (d + 2 * ln(dMg(s)) + 2 * ln(1.5 * l.CNM) + 2 * ln(3 * l.p.Si) - l.NF); });
  add("T_Beattie1993_opx", "opx_liq", "T", "Beattie (1993) eq. 11, orthopyroxene–liquid", "10.1007/BF00712982", "±15 °C", "Anhydrous melts; D_Mg from orthopyroxene and liquid cation fractions",
    (s, P) => { const [n, d] = beattie(125.9, 67.92, 6.50, P), l = s.Liq, o = s.Opx.cat; return n / (d + 2 * ln((o.Mg / o.sum) / l.p.Mg) + 2 * ln(2 * l.CNM) - l.NF); });
  // ---- Gavrilenko et al. (2016) Ca-in-olivine hygrometer, eqs 2–7; melt normalised anhydrous ----
  add("H_Gavr2016", "ol_liq", "H2O", "Gavrilenko et al. (2016) Ca-in-olivine hygrometer", "10.1093/petrology/egw062", "±1.4–1.8 wt%", "Olivine + melt inclusion; ±1.4 wt% (low-MgO melts), ±1.8 wt% (high-MgO melts)",
    (s) => {
      const liq = s.raw.Liq, tot = LIQUID_OXIDES.reduce((a, o) => a + num(liq[o]), 0), mgo = 100 * num(liq.MgO) / tot, cao = 100 * num(liq.CaO) / tot;
      const D = num(s.raw.Ol.CaO) / cao, low = D > 0.00462 * mgo - 0.027; // eq. 7 separates the two populations
      return low ? 188 * (-0.0043 * mgo + 0.072 - D) : 397 * (0.00042 * mgo + 0.0196 - D);
    });
  // ---- Masotta & Mollo (2019) eq. 2, plagioclase–liquid hygrometer for trachytic melts (T in °C) ----
  add("H_Masotta2019", "plag_liq", "H2O", "Masotta & Mollo (2019) hygrometer", "10.3390/min9060375", "±0.29 wt%", "Trachytic melts, 850–1020 °C, 1.2–7.6 wt% H2O (±0.84 wt% on test data)",
    (s, T) => { const l = s.Liq.p; return 46.22 - 0.33 * anCaAlSi(s) - 0.035 * (T - K) - 12.31 * s.Pl.Ab - 1.31 * l.Na / (l.Na + l.K); });

  // ---- Olivine–spinel Al exchange: k_d = Al2O3(olivine)/Al2O3(spinel) in wt%; Cr# = Cr/(Cr + Al) of spinel ----
  const kdAl = (s) => pos(num(s.raw.Ol.Al2O3)) / num(s.raw.Sp.Al2O3);
  add("T_Wan2008", "ol_sp", "T", "Wan et al. (2008) eq. 3, Al-in-olivine", "10.2138/am.2008.2758", "±22 °C", "1250–1450 °C; spinel Cr# 0.07–0.69; needs precise Al2O3 in olivine",
    (s) => 1e4 / (0.512 + 0.873 * s.Sp.CrNo - 0.91 * ln(kdAl(s))) + 0.15);
  add("T_Coogan2014", "ol_sp", "T", "Coogan et al. (2014) eq. 6, Al-in-olivine", "10.1016/j.chemgeo.2014.01.004", "±25 °C", "Spinel Cr# 0–0.69; needs precise Al2O3 in olivine; extrapolate Al to zero P if olivine is P-rich",
    (s) => 1e4 / (0.575 + 0.884 * s.Sp.CrNo - 0.897 * ln(kdAl(s))));

  // ---- Liquid-only thermometers ----
  add("T_Helz1987_MgO", "liq_only", "T", "Helz & Thornber (1987) MgO", "10.1007/BF01080357", "not stated", "Kilauea Iki tholeiitic glass saturated in olivine; MgO in wt%", (s) => 20.1 * liqWt(s, "MgO") + 1014 + K);
  add("T_Helz1987_CaO", "liq_only", "T", "Helz & Thornber (1987) CaO", "10.1007/BF01080357", "not stated", "Kilauea Iki glass saturated in olivine + augite + plagioclase; CaO in wt%", (s) => 16.6 * liqWt(s, "CaO") + 968 + K);
  add("T_Montierth1995", "liq_only", "T", "Montierth et al. (1995) MgO", "10.1029/GM092p0207", "±10 °C", "Mauna Loa glass at 1 atm, 1110–1310 °C, with olivine ± plagioclase or pigeonite + augite + plagioclase; MgO in wt%", (s) => 23.0 * liqWt(s, "MgO") + 1012 + K);
  add("T_Shea2022_MgO", "liq_only", "T", "Shea et al. (2022) MgO", "10.1007/s00410-022-01969-8", "±13 °C", "Hawaiian tholeiitic glass, 1060–1500 °C; MgO in wt%", (s) => 21.2 * liqWt(s, "MgO") + 1017 + K);
  add("T_Sug2000_eq1", "liq_only", "T", "Sugawara (2000) eq. 1", "10.1029/2000JB900010", "not stated", "Olivine-saturated liquids at 0.1 MPa; MgO in mol%", (s) => 1316 + 12.95 * 100 * s.Liq.mf.MgO);
  add("T_Put1999", "liq_only", "T", "Putirka (1999) eq. 3.8, clinopyroxene saturation", "10.1007/s004100050503", "±51 °C", "Clinopyroxene-saturated liquids to 100 kbar; Fm = FeO + MgO",
    (s, P) => { const l = s.Liq.p, fm = l.Fe + l.Mg; return 1e4 / (3.12 - 2.59e-2 * P - 0.37 * ln(l.Mg / fm) + 0.47 * ln(l.Ca * fm * l.Si ** 2) - 0.78 * ln(fm ** 2 * l.Si ** 2) - 0.34 * ln(l.Ca * l.Al ** 2 * l.Si)); });
  add("T_Molina2015_amp_sat", "liq_only", "T", "Molina et al. (2015) amphibole saturation", "10.1016/j.lithos.2015.06.027", "±37–42 °C", "Amphibole-saturated liquids; anhydrous cation fractions",
    (s) => { const l = s.Liq.p; return 107 * ln(l.Mg) - 108 * ln(l.Ca / (l.Ca + l.Al)) + 1184 + K; });
  // ---- Kress & Carmichael (1991) eq. 7 with Table 7: melt fO2 from Fe3+/ΣFe; reported relative to FMQ of Frost (1991) ----
  add("fO2_Kress1991", "liq_only", "fO2", "Kress & Carmichael (1991) melt fO2 from Fe3+/ΣFe", "10.1007/BF00307328", "not stated", "Natural silicate melts, 1200–1630 °C; requires measured Fe3+/ΣFe; ΔFMQ uses the FMQ buffer of Frost (1991)",
    (s, T, P) => {
      const f = num(s.raw.Liq.Fe3Fet), x = s.Liq.mfAll, Pa = (P || 0) * 1e8, T0 = 1673;
      if (!(f > 0 && f < 1)) return NaN;
      const rest = 1.1492e4 / T - 6.675 - 2.243 * x.Al2O3 - 1.828 * x.FeOt + 3.201 * x.CaO + 5.854 * x.Na2O + 6.215 * x.K2O
        - 3.36 * (1 - T0 / T - ln(T / T0)) - 7.01e-7 * Pa / T - 1.54e-10 * (T - T0) * Pa / T + 3.85e-17 * Pa * Pa / T;
      const logfO2 = (ln(f / (2 * (1 - f))) - rest) / 0.196 / Math.LN10; // X_Fe2O3/X_FeO = f/[2(1 − f)]
      return logfO2 - (-25096.3 / T + 8.735 + 0.110 * ((P || 0) * 1000 - 1) / T);
    });

  // ---- Ni-in-garnet thermometers for mantle garnet; Ni in coexisting olivine from opt.niOl (default 3000 ppm) ----
  const niGrt = (s) => pos(num(s.raw.Grt.Ni_ppm)), niOl = (opt) => (opt && opt.niOl > 0 ? opt.niOl : 3000);
  add("T_Ryan1996", "grt_only", "T", "Ryan et al. (1996) Ni-in-garnet", "10.1029/95JB03207", "±50 °C", "Peridotitic garnet; assumes constant Ni in olivine; Ni in ppm", (s) => 1000 / (1.506 - 0.189 * ln(niGrt(s))) + 0.15);
  add("T_Canil1999", "grt_only", "T", "Canil (1999) Ni-in-garnet", "10.1007/s004100050535", "not stated", "Peridotitic garnet; D = Ni(grt)/Ni(ol), olivine Ni assumed (default 3000 ppm)", (s, P, opt) => 8772 / (2.53 - ln(niGrt(s) / niOl(opt))));
  add("T_Sudholz2021", "grt_only", "T", "Sudholz et al. (2021) Ni-in-garnet", "10.1007/s00410-021-01791-8", "±55 °C", "Garnet peridotite, 1100–1325 °C experiments; olivine Ni assumed (default 3000 ppm)",
    (s, P, opt) => { const g = s.Grt; return -8254.568 / (g.XCa_FMC * 3.023 + g.XCr * 2.307 + ln(niGrt(s) / niOl(opt)) - 2.639) + 0.15; });

  const EQ = Object.fromEntries(EQUATIONS.map((e) => [e.id, e]));

  // ---------------------------------------------------------------------------
  // 4. Sample preparation and evaluation
  // ---------------------------------------------------------------------------
  function validateSample(sample) {
    for (const [ph, comp] of Object.entries(sample)) {
      if (!comp || typeof comp !== "object") continue;
      for (const [k, v] of Object.entries(comp)) {
        if (v === "" || v === null || v === undefined) continue;
        if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`${ph} ${k}: value is not a finite number`);
        const x = typeof v === "number" ? v : parseFloat(v);
        if (Number.isFinite(x) && x < 0) throw new Error(`${ph} ${k}: negative value (${v})`);
      }
    }
  }
  /** sample: { Grt:{SiO2…}, Cpx:{…}, Liq:{…, Zr_ppm}, Trace:{Ti_zrc…}, cpxFe2: "total"|"lindsley" } */
  function prepare(sample) {
    validateSample(sample);
    const s = { cpxFe2: sample.cpxFe2 || "total", raw: sample };
    for (const ph in PHASE_MODEL) if (sample[ph]) s[ph] = PHASE_MODEL[ph](sample[ph]);
    return s;
  }
  /**
   * Fe–Mg exchange tests of equilibrium, K_D = (Fe/Mg)mineral / (Fe2+/Mg)liquid, with the ranges given by Putirka (2008):
   * olivine–liquid 0.30 ± 0.03 (Roeder & Emslie, 1970); clinopyroxene–liquid 0.28 ± 0.08; orthopyroxene–liquid
   * 0.4805 − 0.3733·X_Si(liq) ± 0.06; clinopyroxene–orthopyroxene 1.09 ± 0.14. Melt Fe2+ uses Fe3+/ΣFe when entered.
   */
  function equilibriumTests(s) {
    const tests = [], add = (name, value, lo, hi) => { if (Number.isFinite(value)) tests.push({ name, value, lo: +lo.toFixed(3), hi: +hi.toFixed(3), pass: value >= lo && value <= hi }); };
    const liqFeMg = s.Liq ? (s.Liq.p.Fe * (1 - Math.min(0.99, num(s.raw.Liq.Fe3Fet)))) / s.Liq.p.Mg : NaN;
    if (s.Ol && s.Liq) add("Ol–liq K_D(Fe–Mg), Roeder & Emslie (1970)", (s.Ol.cat.Fe / s.Ol.cat.Mg) / liqFeMg, 0.27, 0.33);
    if (s.Cpx && s.Liq) add("Cpx–liq K_D(Fe–Mg), Putirka (2008)", (s.Cpx.cat.Fe / s.Cpx.cat.Mg) / liqFeMg, 0.20, 0.36);
    if (s.Opx && s.Liq) { const k = 0.4805 - 0.3733 * s.Liq.p.Si; add("Opx–liq K_D(Fe–Mg), Putirka (2008)", (s.Opx.cat.Fe / s.Opx.cat.Mg) / liqFeMg, k - 0.06, k + 0.06); }
    if (s.Cpx && s.Opx) add("Cpx–Opx K_D(Fe–Mg), Putirka (2008)", (s.Cpx.cat.Fe / s.Cpx.cat.Mg) / (s.Opx.cat.Fe / s.Opx.cat.Mg), 0.95, 1.23);
    return tests;
  }
  /** Evaluate one equation. cond: {T_K, P_kbar, opt}. */
  function evaluate(eqId, s, cond = {}) {
    const e = EQ[eqId];
    if (!e) throw new Error("Unknown equation " + eqId);
    for (const ph of SYSTEMS[e.system].phases) if (!s[ph]) throw new Error(`${e.name} requires phase ${ph}`);
    if (e.kind === "T") return e.fn(s, cond.P_kbar, cond.opt);
    if (e.kind === "P") return e.fn(s, cond.T_K, cond.opt);
    return e.fn(s, cond.T_K, cond.P_kbar, cond.opt);
  }

  // ---------------------------------------------------------------------------
  // 5. Coupled P–T: root of g(P) = P_eq(T_eq(P)) − P, bracketed on a grid, then bisection
  // ---------------------------------------------------------------------------
  function solvePT(tId, pId, s, opt = {}) {
    const lo = opt.Pmin ?? 0, hi = opt.Pmax ?? 60, tol = opt.tol ?? 1e-6, n = opt.grid ?? 120;
    if (!(hi > lo)) throw new Error(`invalid pressure bounds: P_max (${hi}) must exceed P_min (${lo})`);
    const fT = opt.fT ? (P) => opt.fT(s, P, opt.eqOpt) : (P) => evaluate(tId, s, { P_kbar: P, opt: opt.eqOpt });
    const fP = opt.fP ? (T) => opt.fP(s, T, opt.eqOpt) : (T) => evaluate(pId, s, { T_K: T, opt: opt.eqOpt });
    const g = (P) => fP(fT(P)) - P;
    let a = lo, ga = g(a), b = lo, gb = ga, found = false;
    for (let i = 1; i <= n && !found; i++) {
      b = lo + ((hi - lo) * i) / n; gb = g(b);
      if (Number.isFinite(ga) && Number.isFinite(gb) && ga * gb <= 0) found = true; else { a = b; ga = gb; }
    }
    if (!found) return { converged: false, reason: `no intersection between ${lo} and ${hi} kbar` };
    let it = 0;
    for (; b - a > tol && it < 200; it++) {
      const m = (a + b) / 2, gm = g(m);
      if (ga * gm <= 0) b = m; else { a = m; ga = gm; }
    }
    const P = (a + b) / 2;
    return { converged: true, P_kbar: P, T_K: fT(P), iterations: it };
  }

  // ---------------------------------------------------------------------------
  // 6. Monte Carlo propagation of analytical (and optionally calibration) uncertainty
  // ---------------------------------------------------------------------------
  function mulberry32(seed) { // small seeded PRNG (public-domain algorithm)
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussian(rng) { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * ln(u)) * Math.cos(2 * Math.PI * rng()); } // Box–Muller
  /** Perturb every input of every phase independently: σ = max(rel·x, floor); activities are held fixed. */
  function perturbSample(sample, rng, rel, floor) {
    const out = {};
    for (const k in sample) {
      const v = sample[k];
      if (!v || typeof v !== "object") { out[k] = v; continue; }
      out[k] = {};
      for (const o in v) {
        const x = num(v[o]), fixed = o === "aTiO2" || o === "aSiO2" || o === "Fe3Fet"; // activities and the redox ratio are inputs, not analyses
        const sig = fixed ? 0 : Math.max(rel * x, x > 0 && OX[o] ? floor : 0);
        out[k][o] = Math.max(0, x + sig * gaussian(rng));
      }
    }
    return out;
  }
  function stats(arr) {
    const a = arr.slice().sort((x, y) => x - y), n = a.length, mean = a.reduce((p, q) => p + q, 0) / n;
    const sd = Math.sqrt(a.reduce((p, q) => p + (q - mean) ** 2, 0) / (n - 1));
    const q = (f) => { const i = (n - 1) * f, j = Math.floor(i); return a[j] + (a[Math.min(j + 1, n - 1)] - a[j]) * (i - j); };
    return { mean, sd, median: q(0.5), p16: q(0.16), p84: q(0.84) };
  }
  /** SEE string → {abs} (K, kbar, log units) or {rel} for percentages; upper bound of a range. */
  function seeOf(e) {
    const m = String(e.see).match(/±\s*([\d.]+)(?:\s*[–-]\s*([\d.]+))?\s*(%|°C|kbar|wt%|log)?/);
    if (!m) return null;
    const v = parseFloat(m[2] || m[1]);
    return m[3] === "%" ? { rel: v / 100 } : { abs: v };
  }
  function withOffsets(tId, pId, dT, dP) {
    const eT = EQ[tId], eP = EQ[pId];
    return {
      T: (s, P, opt) => { const v = eT.fn(s, P, opt); return v + (dT.abs || 0) + v * (dT.rel || 0); },
      P: (s, T, opt) => { const v = eP.fn(s, T, opt); return v + (dP.abs || 0) + v * (dP.rel || 0); }
    };
  }
  function monteCarloPT(tId, pId, sample, opt = {}) {
    const N = opt.N ?? 1000, rel = opt.rel ?? 0.02, floor = opt.floor ?? 0.02, rng = mulberry32(opt.seed ?? 42);
    const seT = opt.calibration ? seeOf(EQ[tId]) : null, seP = opt.calibration ? seeOf(EQ[pId]) : null;
    const pts = []; let failed = 0;
    for (let i = 0; i < N; i++) {
      try {
        let o2 = opt;
        if (seT || seP) {
          const z1 = gaussian(rng), z2 = gaussian(rng);
          const w = withOffsets(tId, pId, seT ? (seT.rel ? { rel: seT.rel * z1 } : { abs: seT.abs * z1 }) : {}, seP ? (seP.rel ? { rel: seP.rel * z2 } : { abs: seP.abs * z2 }) : {});
          o2 = Object.assign({}, opt, { fT: w.T, fP: w.P });
        }
        const r = solvePT(tId, pId, prepare(perturbSample(sample, rng, rel, floor)), o2);
        if (r.converged && Number.isFinite(r.T_K) && Number.isFinite(r.P_kbar)) pts.push(r); else failed++;
      } catch (e) { failed++; }
    }
    if (pts.length < 3) return { points: pts, failed, N };
    const T = pts.map((p) => p.T_K - 273.15), P = pts.map((p) => p.P_kbar), sT = stats(T), sP = stats(P);
    const cov = T.reduce((acc, t, i) => acc + (t - sT.mean) * (P[i] - sP.mean), 0) / (pts.length - 1);
    const den = sT.sd * sP.sd; // zero spread (e.g. no perturbation) has no defined correlation
    return { points: pts, failed, N, T_C: sT, P_kbar: sP, cov, rho: sT.sd > 1e-9 * Math.abs(sT.mean) && sP.sd > 1e-9 * Math.abs(sP.mean) ? Math.max(-1, Math.min(1, cov / den)) : NaN }; // spread at rounding level is no spread
  }

  // ---------------------------------------------------------------------------
  // 7. Plausibility, depth, calibration domain
  // ---------------------------------------------------------------------------
  const PLAUSIBLE = { T: [473.15, 2473.15], P: [-2, 150], H2O: [0, 25], fO2: [-10, 10] };
  function plausible(eqId, v) { const r = PLAUSIBLE[EQ[eqId].kind]; return Number.isFinite(v) && v >= r[0] && v <= r[1]; }

  /** Pressure (kbar) to depth (km) for a constant density (kg/m³): z = P/(ρg). */
  const DEPTH_MODELS = { constant: { name: "Constant density", fn: (P, rho = 2700) => (P * 1e8) / (rho * 9.81) / 1000 } };
  function pressureToDepth(P, model = "constant", rho) { return DEPTH_MODELS[model].fn(P, rho); }

  // Calibration-domain summaries (mean, precision matrix, D² percentiles of each calibration dataset) are loaded
  // from lithopt-domains.js when present. None are distributed at present.
  let DOMAINS = null;
  try { DOMAINS = typeof module === "object" && module.exports ? require("./lithopt-domains.js") : (typeof self !== "undefined" ? self.LithoPT_DOMAINS || null : null); } catch (e) { DOMAINS = null; }
  const DOMAIN_OF = {};
  if (DOMAINS) for (const [k, d] of Object.entries(DOMAINS)) for (const id of d.equations) DOMAIN_OF[id] = k;
  /** Squared Mahalanobis distance of a sample from an equation's calibration data, vs. the 95th/99th percentiles of that data. */
  function applicability(eqId, sample) {
    const key = DOMAIN_OF[eqId];
    if (!key) return null;
    const d = DOMAINS[key];
    const x = d.features.map((f, i) => { const [ph, ox] = f.split("_"); return num(sample[ph] && sample[ph][ox]) - d.mean[i]; });
    let d2 = 0;
    for (let i = 0; i < x.length; i++) for (let j = 0; j < x.length; j++) d2 += x[i] * d.precision[i][j] * x[j];
    return { dataset: d.label, n: d.n, d2, p95: d.d2_p95, p99: d.d2_p99, status: d2 <= d.d2_p95 ? "inside" : d2 <= d.d2_p99 ? "marginal" : "outside" };
  }

  // ---------------------------------------------------------------------------
  // 8. Model-choice uncertainty: every compatible thermometer × barometer pair
  // ---------------------------------------------------------------------------
  function phasesPresent(sample, e) { return SYSTEMS[e.system].phases.every((ph) => sample[ph] && Object.values(sample[ph]).some((v) => num(v) > 0)); }
  function ensemblePT(sample, opt = {}) {
    const s = prepare(sample);
    // Left out by default: unverified equations, calibrations restricted to particular magma types, and liquid-only saturation
    // thermometers (they assume saturation in a phase that may be absent) unless that system is asked for explicitly.
    const ok = (e) => phasesPresent(sample, e) && e.src !== "Pending" && (opt.restricted || !e.restricted) && (opt.systems ? true : e.system !== "liq_only") && (!opt.systems || opt.systems.includes(e.system)) && (!opt.exclude || !opt.exclude.includes(e.id));
    const Ts = EQUATIONS.filter((e) => e.kind === "T" && ok(e)), Ps = EQUATIONS.filter((e) => e.kind === "P" && ok(e));
    const pairs = [];
    for (const t of Ts) for (const p of Ps) {
      let r;
      try { r = solvePT(t.id, p.id, s, opt); } catch (err) { r = { converged: false }; }
      pairs.push({ T: t.id, P: p.id, converged: !!r.converged, T_C: r.converged ? r.T_K - 273.15 : NaN, P_kbar: r.converged ? r.P_kbar : NaN,
        inDomain: [applicability(t.id, sample), applicability(p.id, sample)].every((a) => !a || a.status !== "outside") });
    }
    for (const q of pairs) q.plausible = q.converged && plausible(q.T, q.T_C + 273.15) && plausible(q.P, q.P_kbar);
    const good = pairs.filter((q) => q.plausible), inD = good.filter((q) => q.inDomain);
    const sum = (arr) => ({ T_C: stats(arr.map((q) => q.T_C)), P_kbar: stats(arr.map((q) => q.P_kbar)), n: arr.length });
    return { pairs, nSolved: good.length, summary: good.length >= 2 ? sum(good) : null, summaryInDomain: inD.length >= 2 ? sum(inD) : null };
  }

  // ---------------------------------------------------------------------------
  // 9. Decision support: intersection geometry, phase guess from oxides, model ranking
  // ---------------------------------------------------------------------------
  /**
   * Local slopes of the two curves at a P–T solution (central differences) and the angle between them after scaling
   * T and P by the standard errors of the two equations (so the angle measures how strongly errors are amplified).
   */
  function intersectionGeometry(tId, pId, s, det, opt = {}) {
    const hT = 1, hP = 0.05, o = opt.eqOpt, T0 = det.T_K, P0 = det.P_kbar;
    const dTdP = (evaluate(tId, s, { P_kbar: P0 + hP, opt: o }) - evaluate(tId, s, { P_kbar: P0 - hP, opt: o })) / (2 * hP);
    const dPdT = (evaluate(pId, s, { T_K: T0 + hT, opt: o }) - evaluate(pId, s, { T_K: T0 - hT, opt: o })) / (2 * hT);
    const seT = seeOf(EQ[tId]), seP = seeOf(EQ[pId]);
    const sT = seT && seT.abs ? seT.abs : 50, sP = seP ? (seP.abs || seP.rel * Math.abs(P0)) || 1 : 1;
    // direction vectors in (T/sT, P/sP): thermometer (dTdP·dP, dP), barometer (dT, dPdT·dT)
    const a = [dTdP / sT, 1 / sP], b = [1 / sT, dPdT / sP];
    const cos = Math.abs(a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b));
    const angle = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
    return { dTdP, dPdT, angle, scaleT: sT, scaleP: sP, condition: !Number.isFinite(angle) ? "undefined" : angle >= 30 ? "well-conditioned" : angle >= 15 ? "oblique" : "grazing" };
  }

  // ponytail: stoichiometric windows, not a full classifier; Fe3+-rich, altered or mixed analyses can be misassigned,
  // and glass cannot always be told from amphibole or pyroxene by stoichiometry alone,
  // which is why callers show the score and let the user override. Upgrade path: discriminant trained on a mineral database.
  const CLASS_RULES = { // [basis O, checks [[fn, lo, hi]…], expected total range]
    Grt: [12, [[(c) => c.Si, 2.85, 3.15], [(c) => c.Al + c.Cr, 1.7, 2.2], [(c) => c.Fe + c.Mg + c.Ca + c.Mn, 2.7, 3.2], [(c) => c.sum, 7.9, 8.1]], [98, 102]],
    Cpx: [6, [[(c) => c.Si, 1.7, 2.05], [(c) => c.sum, 3.92, 4.08], [(c) => c.Ca, 0.25, 1.05], [(c) => c.Al - c.Na, -0.3, 0.4]], [98, 102]],
    Opx: [6, [[(c) => c.Si, 1.75, 2.05], [(c) => c.sum, 3.92, 4.08], [(c) => c.Ca, 0, 0.25], [(c) => c.Fe + c.Mg, 1.5, 2.1]], [98, 102]],
    Ol: [4, [[(c) => c.Si, 0.95, 1.05], [(c) => c.Fe + c.Mg + c.Mn, 1.9, 2.1], [(c) => c.sum, 2.95, 3.05]], [98, 102]],
    Pl: [8, [[(c) => c.Si + c.Al, 3.9, 4.1], [(c) => c.Ca + c.Na + c.K, 0.85, 1.1], [(c) => c.K / (c.Ca + c.Na + c.K), 0, 0.5], [(c) => c.Fe + c.Mg, 0, 0.1]], [98, 102]],
    Kfs: [8, [[(c) => c.Si + c.Al, 3.9, 4.1], [(c) => c.Ca + c.Na + c.K, 0.85, 1.1], [(c) => c.K / (c.Ca + c.Na + c.K), 0.5, 1], [(c) => c.Fe + c.Mg, 0, 0.1]], [98, 102]],
    Bt: [11, [[(c) => c.Si, 2.5, 3.1], [(c) => c.K + c.Na, 0.7, 1.1], [(c) => c.Fe + c.Mg, 1.2, 3], [(c) => c.Ca, 0, 0.1]], [92, 98]],
    Ms: [11, [[(c) => c.Si, 2.9, 3.6], [(c) => c.Al, 2.0, 3.1], [(c) => c.K + c.Na, 0.7, 1.1], [(c) => c.Fe + c.Mg, 0, 0.6]], [92, 97]],
    Amp: [23, [[(c) => c.Si, 5.5, 8.0], [(c) => c.sum, 15.0, 16.2], [(c) => c.Ca + c.Na + c.K, 1.5, 3.2], [(c) => c.Fe + c.Mg, 3, 5.5], [(c) => c.Ca, 0, 2.1], [(c) => c.K, 0, 0.6]], [95, 98.8]],
    Sp: [4, [[(c) => c.Si, 0, 0.15], [(c) => c.sum, 2.9, 3.15], [(c) => c.Ti, 0, 0.6]], [95, 102]],
    Ilm: [3, [[(c) => c.Ti, 0.8, 1.1], [(c) => c.sum, 1.9, 2.1], [(c) => c.Si, 0, 0.05]], [95, 102]]
  };
  const CLASS_NAME = { Grt: "garnet", Cpx: "clinopyroxene", Opx: "orthopyroxene", Ol: "olivine", Pl: "plagioclase", Kfs: "alkali feldspar", Bt: "biotite", Ms: "muscovite", Amp: "amphibole", Sp: "spinel", Ilm: "ilmenite", Liq: "glass / whole rock" };
  /**
   * Guess the mineral from an oxide analysis. Each candidate is scored 0–1 by how well cations on its oxygen basis and the
   * analytical total fit the windows above (1 inside a window, falling linearly to 0 half a window-width outside it, or 1 wt% for the total).
   * Returns { phase, name, score, supported, ambiguous, candidates }. Falls back to Liq when nothing fits (score < 0.85).
   */
  function classifyMineral(comp) {
    const total = MINERAL_OXIDES.reduce((a, o) => a + num(comp[o]), 0);
    const fit = (v, lo, hi, w = Math.max((hi - lo) / 2, 0.05)) => { if (!Number.isFinite(v)) return 0; if (v >= lo && v <= hi) return 1; const d = v < lo ? lo - v : v - hi; return Math.max(0, 1 - d / w); };
    const cands = [];
    for (const [ph, [nOx, checks, tot]] of Object.entries(CLASS_RULES)) {
      let c;
      try { c = cationsPerOxygen(comp, nOx); } catch (e) { continue; }
      const parts = checks.map(([f, lo, hi]) => fit(f(c), lo, hi)).concat(fit(total, tot[0], tot[1], 1));
      cands.push({ phase: ph, score: Math.min(...parts) * 0.5 + (parts.reduce((a, b) => a + b, 0) / parts.length) * 0.5 });
    }
    cands.sort((a, b) => b.score - a.score);
    const best = cands[0] && cands[0].score >= 0.85 ? cands[0] : { phase: "Liq", score: cands[0] ? 1 - cands[0].score : 0 };
    return { phase: best.phase, name: CLASS_NAME[best.phase], score: best.score, total, supported: !!PHASE_MODEL[best.phase],
      ambiguous: !!(best.phase !== "Liq" && cands[1] && cands[0].score - cands[1].score < 0.1), candidates: cands.slice(0, 3) };
  }

  const TOTAL_OK = { Bt: [92, 98], Amp: [95, 99.5], Liq: [0, 102] }; // others 98.5–101.5
  const sampleTotal = (c) => MINERAL_OXIDES.concat(["P2O5", "H2O"]).reduce((a, o) => a + num(c[o]), 0);
  const totalOk = (ph, c) => { const t = sampleTotal(c), r = TOTAL_OK[ph] || [98.5, 101.5]; return t >= r[0] && t <= r[1]; };
  /**
   * Rank the equations that can be evaluated for a sample. A transparent heuristic, not a substitute for petrography:
   *   phases present and result physically plausible  25
   *   calibration domain: inside 30, marginal 15, outside 0, no domain data 15 (not assessed)  30
   *   analytical totals of the phases used (10) and Fe–Mg equilibrium tests involving them (10)  20
   *   published SEE: thermometers 15 at ≤ 25 °C to 0 at ≥ 75 °C; barometers 15 at ≤ 1 kbar to 0 at ≥ 4 kbar  15
   * Single equations are scaled from 90 to 100. Pairs: mean of the two, plus up to 10 for the intersection angle (≥ 60° full).
   * opt: { P_kbar, T_K (conditions for single equations), eqOpt, Pmin, Pmax, restricted }
   */
  function recommendModels(sample, opt = {}) {
    const s = prepare(sample), tests = equilibriumTests(s), cond = { P_kbar: opt.P_kbar ?? 0, T_K: opt.T_K ?? 273.15, opt: opt.eqOpt };
    const lin = (v, best, worst) => Math.max(0, Math.min(1, (worst - v) / (worst - best)));
    const single = [];
    for (const e of EQUATIONS) {
      if (!phasesPresent(sample, e) || (e.restricted && !opt.restricted)) continue;
      let v;
      try { v = evaluate(e.id, s, cond); } catch (err) { continue; }
      if (!plausible(e.id, v)) continue;
      const why = [], phs = SYSTEMS[e.system].phases.filter((p) => p !== "Trace");
      const a = applicability(e.id, sample);
      const dom = !a ? 15 : a.status === "inside" ? 30 : a.status === "marginal" ? 15 : 0;
      why.push(!a ? "· calibration domain not assessed (no calibration data distributed for this equation)" : `${a.status === "inside" ? "✓" : "⚠"} ${a.status} the calibration data (D² = ${a.d2.toFixed(1)}, 95th percentile ${a.p95.toFixed(1)})`);
      const badTot = phs.filter((p) => !totalOk(p, sample[p]));
      why.push(badTot.length ? `⚠ analytical total outside the usual range: ${badTot.join(", ")}` : "✓ analytical totals in the usual range");
      const rel = tests.filter((t) => { const [x, y] = t.name.split(" ")[0].toLowerCase().split("–"); const has = (n) => phs.some((p) => p.toLowerCase() === n); return has(x) && has(y); });
      const failed = rel.filter((t) => !t.pass);
      if (rel.length) why.push(failed.length ? `⚠ fails ${failed.map((t) => t.name).join("; ")}` : "✓ passes the Fe–Mg equilibrium test");
      const se = seeOf(e), seAbs = se ? (se.abs ?? se.rel * Math.abs(v)) : NaN;
      const prec = !Number.isFinite(seAbs) ? 5 : e.kind === "T" ? 15 * lin(seAbs, 25, 75) : e.kind === "P" ? 15 * lin(seAbs, 1, 4) : 10;
      if (e.system === "liq_only") why.push("⚠ assumes the melt was saturated in the phase concerned");
      why.push(`· calibrated for: ${e.range}`);
      const health = (badTot.length ? 0 : 10) + (failed.length ? 0 : 10), raw = 25 + dom + health + prec;
      single.push({ id: e.id, kind: e.kind, value: v, see: e.see, raw, score: Math.round((raw / 90) * 100), parts: { phases: 25, domain: dom, health, precision: +prec.toFixed(1) }, why });
    }
    const by = (k) => single.filter((x) => x.kind === k).sort((a, b) => b.score - a.score);
    const Ts = by("T"), Ps = by("P"), pairs = [];
    for (const t of Ts) for (const p of Ps) {
      let r, g;
      try { r = solvePT(t.id, p.id, s, opt); } catch (err) { continue; }
      if (!r.converged || !plausible(t.id, r.T_K) || !plausible(p.id, r.P_kbar)) continue;
      try { g = intersectionGeometry(t.id, p.id, s, r, opt); } catch (err) { continue; }
      const geo = Number.isFinite(g.angle) ? 10 * Math.min(1, g.angle / 60) : 0;
      pairs.push({ T: t.id, P: p.id, T_C: r.T_K - 273.15, P_kbar: r.P_kbar, angle: g.angle, condition: g.condition, score: Math.round((t.raw + p.raw) / 2 + geo),
        why: [`${g.condition === "well-conditioned" ? "✓" : "⚠"} ${g.condition} intersection (${fx(g.angle)}° in SEE-scaled P–T space)`].concat([...new Set(t.why.concat(p.why).filter((w) => w[0] !== "·"))]) });
    }
    pairs.sort((a, b) => b.score - a.score);
    return { thermometers: Ts, barometers: Ps, others: single.filter((x) => x.kind !== "T" && x.kind !== "P"), pairs };
  }
  const fx = (v) => (Number.isFinite(v) ? v.toFixed(0) : "—");

  return {
    VERSION, OX, ATOMIC_WEIGHT, MINERAL_OXIDES, LIQUID_OXIDES, SYSTEMS, EQUATIONS, EQ, MINERAL_BASIS,
    cationsPerOxygen, cationFractions, droopRecalc, structuralFormula,
    phases: { garnet, biotite, clinopyroxene, orthopyroxene, feldspar, olivine, spinel, liquid },
    DEPTH_MODELS, pressureToDepth, applicability, ensemblePT, seeOf, plausible, PLAUSIBLE, DOMAINS: () => DOMAINS,
    prepare, evaluate, equilibriumTests, solvePT, monteCarloPT, perturbSample, mulberry32, stats,
    intersectionGeometry, classifyMineral, recommendModels, phasesPresent, totalOk
  };
});
