/**
 * LithoPT interpretation report v4.2.0
 * Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
 *
 * DOM-free: builds a Markdown report from a calculation (and converts that Markdown to HTML for the
 * on-screen preview and the print/PDF view). All numbers come from lithopt-core.js; this file only
 * arranges and explains them. Runs in browsers (window.LithoPTReport) and Node.js (module.exports).
 * License: MIT
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LithoPTReport = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
  const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => " --- ").join("|")}|`].concat(rows.map((r) => `| ${r.join(" | ")} |`)).join("\n");
  const median = (a) => { const b = a.slice().sort((x, y) => x - y), n = b.length; return n ? (b[(n - 1) >> 1] + b[n >> 1]) / 2 : NaN; };

  const BASIS_NAME = { Grt: "Garnet", Cpx: "Clinopyroxene", Opx: "Orthopyroxene", Ol: "Olivine", Sp: "Spinel", Pl: "Plagioclase", Kfs: "Alkali feldspar", Bt: "Biotite", Amp: "Amphibole" };
  const PHASE_NAME = Object.assign({ Liq: "Melt (glass)", Trace: "Trace-element data" }, BASIS_NAME);
  const METAMORPHIC = ["grt_bt", "gasp", "grt_cpx", "grt_opx"], MANTLE = ["two_px", "ol_sp", "grt_only"];
  const EXCHANGE_T = (e) => e.kind === "T" && (["grt_bt", "grt_cpx", "ol_sp"].includes(e.system) || e.id === "T_Harley1984");

  /** What kind of equilibrium an equation records, and what that implies for its use. */
  function mechanism(e) {
    if (EXCHANGE_T(e)) return ["Fe–Mg cation exchange", "Exchange reactions have a small volume change and a large entropy change, so they are sensitive to temperature and only weakly to pressure. Fe–Mg diffusion continues during slow cooling, so the result can record a closure temperature below the peak."];
    if (e.kind === "P" && ["gasp", "grt_opx"].includes(e.system)) return ["Net-transfer reaction", "Net-transfer reactions change the modes of the phases and involve a large volume change, which makes them pressure-sensitive. Resetting them requires reaction progress, not only diffusion, so they tend to retain conditions closer to the peak than exchange thermometers."];
    if (["two_px", "two_fsp"].includes(e.system)) return ["Solvus (miscibility gap)", "The compositions of two coexisting minerals of the same family approach each other as temperature rises. Both must have grown together and escaped later exsolution."];
    if (["trace", "grt_only"].includes(e.system)) return ["Trace-element solubility or partitioning", "The concentration of a trace element in a single mineral depends on temperature when the mineral coexists with the buffering phases named in the calibration (and, for partitioning, a partner of assumed composition). The result is only as good as that assumption."];
    if (e.kind === "fO2") return ["Redox equilibrium", "The oxygen fugacity is obtained from the Fe3+ content of spinel, itself estimated from stoichiometry; analytical error in the spinel total therefore dominates."];
    if (e.system === "liq_only") return ["Melt saturation", "The equation gives the temperature at which the melt would be saturated in the phase concerned. It is a real temperature only if that phase was present and in equilibrium with the melt."];
    if (e.system.endsWith("_liq")) return ["Mineral–melt equilibrium", "The partitioning of components between a mineral and its host melt was fitted to experiments. The mineral and the melt must have been in equilibrium (see the Fe–Mg exchange tests) and resemble the calibration compositions."];
    return ["Empirical single-phase calibration", "The equation was fitted to the composition of a single mineral in experiments; it assumes the mineral grew with the phases present in those experiments."];
  }

  /**
   * ctx: { L, sample, system, cond: {P_kbar, T_C}, eqOpt, label, date, shareUrl, figure (PNG data URL),
   *        rho (kg/m³), pt: { tId, pId, det, solveOpt, mc: {N, rel, floor, seed, calibration} }, ens (result of L.ensemblePT) }
   * Returns { title, markdown }.
   */
  function build(ctx) {
    const L = ctx.L, sample = ctx.sample, s = L.prepare(Object.assign({}, sample, { cpxFe2: (ctx.eqOpt && ctx.eqOpt.cpxFe2) || "total" }));
    const pt = ctx.pt && ctx.pt.det && ctx.pt.det.converged ? ctx.pt : null;
    const rho = ctx.rho || 2700, sys = L.SYSTEMS[ctx.system], out = [];
    const P = pt ? pt.det.P_kbar : ctx.cond.P_kbar, Tc = pt ? pt.det.T_K - 273.15 : ctx.cond.T_C;
    const phases = Object.keys(PHASE_NAME).filter((ph) => sample[ph] && Object.values(sample[ph]).some((v) => v > 0));
    const avail = L.EQUATIONS.filter((e) => L.phasesPresent(sample, e));
    const title = `LithoPT report: ${ctx.label || sys.name}`;
    out.push(`# ${title}`, `LithoPT v${L.VERSION} · generated ${ctx.date || new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · phases entered: ${phases.map((p) => PHASE_NAME[p]).join(", ") || "none"}`);

    // ---- 1. summary
    out.push("## 1. Summary and geological meaning");
    let eT, eP, geo = null, mcA = null, mcT = null;
    if (pt) {
      eT = L.EQ[pt.tId]; eP = L.EQ[pt.pId];
      const depth = L.pressureToDepth(P, "constant", rho);
      out.push(`The ${eT.name} thermometer and the ${eP.name} barometer intersect at **${f(Tc)} °C (${f(Tc + 273.15)} K) and ${f(P, 2)} kbar (${f(P / 10, 3)} GPa)**.`);
      if (P > 0) {
        out.push(`For a constant overburden density of ${rho} kg/m³ this pressure corresponds to a depth of **${f(depth)} km**, and to an apparent average gradient of ${f(Tc / depth)} °C/km (${f(Tc / (P / 10), 0)} °C/GPa) between the surface and that depth. The gradient is an average along an assumed lithostatic column, not a measured geotherm.`);
        if (METAMORPHIC.includes(eT.system) || METAMORPHIC.includes(eP.system)) {
          const g = Tc / (P / 10), cls = g < 375 ? ["low", "the cold conditions of subduction (blueschist to eclogite)"] : g <= 775 ? ["intermediate", "thickened crust, as in collisional (Barrovian-type) belts"] : ["high", "hot crust, as in arcs, back-arcs and extensional settings (Buchan-type to granulite)"];
          out.push(`In the thermobaric-ratio classification of metamorphism (Brown & Johnson, 2018, Am. Mineral. 103, 181–196, https://doi.org/10.2138/am-2018-6166: low T/P below 375 °C/GPa, high above 775 °C/GPa), ${f(g, 0)} °C/GPa is **${cls[0]} T/P** metamorphism, typical of ${cls[1]}. A single P–T point does not define a P–T path: whether it records the peak depends on the textural position of the analysed compositions.`);
        } else if (MANTLE.includes(eT.system) || MANTLE.includes(eP.system)) {
          out.push(`For mantle assemblages the depth should be compared with the local crustal thickness and a conductive geotherm; LithoPT does not fit a geotherm. A density of ${rho} kg/m³ underestimates the density of the mantle column, so the depth above is a maximum for the mantle part of the path.`);
        } else {
          const z = depth < 10 ? "upper crust (< 10 km)" : depth < 25 ? "middle crust (10–25 km)" : depth < 40 ? "lower crust (25–40 km)" : "below a nominal 40 km Moho";
          out.push(`For a magmatic assemblage this is a storage or crystallisation depth in the **${z}** of a nominal continental section. The value applies to the moment the analysed mineral composition last equilibrated with the melt (or, for single-phase equations, grew), which for zoned crystals differs between core and rim.`);
        }
      } else out.push("The pressure is not positive, so no depth or gradient is given. Check the barometer's requirements and the analyses.");
      try { geo = L.intersectionGeometry(pt.tId, pt.pId, s, pt.det, pt.solveOpt); } catch (e) { geo = null; }
    } else {
      out.push(`No coupled P–T solution is available. The results below are single-equation estimates: thermometers evaluated at an assumed ${f(ctx.cond.P_kbar, 2)} kbar and barometers at an assumed ${f(ctx.cond.T_C)} °C. Solve a thermometer–barometer pair in the P–T tab to remove that assumption and to obtain depth, gradient and uncertainty sections.`);
    }

    // ---- 2. inputs
    out.push("## 2. Compositions, stoichiometry and equilibrium");
    const oxides = L.LIQUID_OXIDES.concat(["H2O"]), minerals = phases.filter((p) => p !== "Trace");
    if (minerals.length) {
      const tot = (p) => oxides.reduce((a, o) => a + (+sample[p][o] || 0), 0);
      out.push("Oxides in wt%; total iron as FeOt.", table(["Oxide"].concat(minerals), oxides.filter((o) => minerals.some((p) => +sample[p][o] > 0)).map((o) => [o].concat(minerals.map((p) => (sample[p][o] > 0 ? f(+sample[p][o], 2) : "—"))))
        .concat([["**Total**"].concat(minerals.map((p) => `**${f(tot(p), 2)}**`))])));
      const withBasis = minerals.filter((p) => BASIS_NAME[p]), sf = {}, flags = [];
      for (const p of withBasis) { try { sf[p] = L.structuralFormula(BASIS_NAME[p], sample[p]); } catch (e) { /* empty analysis */ } }
      const keys = ["Si", "Ti", "Al", "Cr", "Fe3", "Fe2", "Mn", "Mg", "Ca", "Na", "K"], cols = withBasis.filter((p) => sf[p]);
      if (cols.length) {
        out.push("Cations per formula unit. Fe³⁺ by the charge-balance method of Droop (1987) where the ideal cation total is fixed; all Fe as Fe²⁺ in biotite and amphibole.",
          table(["Cation"].concat(cols.map((p) => `${p} (${sf[p].basis.nOx} O)`)), keys.map((k) => [k.replace(/^Fe(\d)$/, "Fe$1+")].concat(cols.map((p) => f(sf[p].cat[k], 3))))
            .concat([["Σ cations (all Fe²⁺)"].concat(cols.map((p) => f(sf[p].observedSum, 3))), ["Fe³⁺/ΣFe"].concat(cols.map((p) => (sf[p].basis.nCat && sf[p].cat.Fe > 0 ? f(sf[p].cat.Fe3 / sf[p].cat.Fe, 3) : "—")))])));
      }
      const comp = [];
      if (s.Grt) comp.push(`Garnet: X_Alm ${f(s.Grt.XAlm, 3)}, X_Prp ${f(s.Grt.XPrp, 3)}, X_Grs ${f(s.Grt.XGrs, 3)}, X_Sps ${f(s.Grt.XSps, 3)}, Mg# ${f(s.Grt.MgNo, 3)}`);
      if (s.Bt) comp.push(`Biotite: X_Mg ${f(s.Bt.XMg, 3)}, Ti ${f(s.Bt.cat.Ti, 3)} apfu (22 O)`);
      if (s.Cpx) comp.push(`Clinopyroxene: Al(IV) ${f(s.Cpx.cat.Al_IV, 3)}, Al(VI) ${f(s.Cpx.cat.Al_VI, 3)}, jadeite ${f(s.Cpx.P.Jd, 3)}, DiHd ${f(s.Cpx.P.DiHd, 3)}, EnFs ${f(s.Cpx.P.EnFs, 3)}, Mg# ${f(s.Cpx.cat.Mg / (s.Cpx.cat.Mg + s.Cpx.cat.Fe), 3)}`);
      if (s.Opx) comp.push(`Orthopyroxene: Mg# ${f(s.Opx.cat.Mg / (s.Opx.cat.Mg + s.Opx.cat.Fe), 3)}, Ca ${f(s.Opx.cat.Ca, 3)}, Al ${f(s.Opx.cat.Al, 3)} apfu`);
      if (s.Pl) comp.push(`Plagioclase: X_An ${f(s.Pl.An, 3)}, X_Ab ${f(s.Pl.Ab, 3)}, X_Or ${f(s.Pl.Or, 3)}`);
      if (s.Kfs) comp.push(`Alkali feldspar: X_Or ${f(s.Kfs.Or, 3)}, X_Ab ${f(s.Kfs.Ab, 3)}, X_An ${f(s.Kfs.An, 3)}`);
      if (s.Ol) comp.push(`Olivine: Fo ${f(s.Ol.Fo, 3)}`);
      if (s.Sp) comp.push(`Spinel: Cr# ${f(s.Sp.CrNo, 3)}, Fe³⁺/ΣR³⁺ ${f(s.Sp.XFe3, 3)}`);
      if (s.Amp) comp.push(`Amphibole: Si ${f(s.Amp.c23.Si, 2)}, Al ${f(s.Amp.c23.Al, 2)} apfu (23 O), Mg# ${f(s.Amp.MgNo, 3)}`);
      if (s.Liq) comp.push(`Melt: Mg# ${f(s.Liq.MgNo, 3)}, H₂O ${f(s.Liq.H2O, 2)} wt%`);
      out.push("Components used by the equations:", comp.map((c) => `- ${c}`).join("\n"));
      for (const p of minerals) if (!L.totalOk(p, sample[p])) flags.push(`${PHASE_NAME[p]}: analytical total ${f(tot(p), 2)} wt% is outside the range usual for this phase. Check for a missing element, beam damage or a mixed analysis.`);
      for (const p of cols) { const n = sf[p].basis.nCat, d = n ? sf[p].observedSum - n : 0; if (n && Math.abs(d) > 0.03) flags.push(`${PHASE_NAME[p]}: ${f(sf[p].observedSum, 3)} cations per ${sf[p].basis.nOx} O against an ideal ${n}. ${d > 0 ? "The excess is assigned to Fe³⁺ by charge balance; a large excess can also indicate an analytical problem." : "A deficit cannot be explained by Fe³⁺ and points to vacancies, an unanalysed element or a poor analysis."}`);
      }
      out.push(flags.length ? "**Stoichiometric flags**\n\n" + flags.map((x) => `- ${x}`).join("\n") : "No stoichiometric flags: totals and cation sums are within the usual ranges.");
    }
    if (sample.Trace && phases.includes("Trace")) out.push("Trace-element inputs: " + Object.entries(sample.Trace).filter(([, v]) => v > 0).map(([k, v]) => `${k} = ${v}`).join(", ") + ".");
    const tests = L.equilibriumTests(s);
    if (tests.length) {
      out.push("Fe–Mg exchange tests of equilibrium (ranges from Putirka, 2008, and Roeder & Emslie, 1970):", table(["Test", "K_D", "Accepted", "Result"], tests.map((t) => [t.name, f(t.value, 3), `${t.lo}–${t.hi}`, t.pass ? "pass" : "**fail**"])));
      out.push(tests.every((t) => t.pass) ? "All tests pass. This is necessary but not sufficient evidence of equilibrium: it does not test Al, Na or Ca exchange."
        : "At least one pair fails. The analysed compositions were probably not in equilibrium with each other: the crystal may be an antecryst or xenocryst, the analysis may be from a zone that did not grow from this melt, or the pair re-equilibrated after the peak. Results from equations that combine these phases should not be used without further evidence.");
    } else out.push("No Fe–Mg exchange test applies to the phases entered.");

    // ---- 3. equations
    out.push("## 3. Equations, their basis and calibration domain");
    const used = pt ? [eT, eP] : avail.filter((e) => e.system === ctx.system);
    if (pt) out.push("The coupled solution uses the two equations described first; all other equations that can be evaluated for the phases entered are listed in the table that follows.");
    for (const e of used) {
      const [kind, why] = mechanism(e), a = L.applicability(e.id, sample);
      out.push(`### ${e.name}`, `- Identifier: ${e.id} · system: ${L.SYSTEMS[e.system].name}\n- Source: ${e.doi ? "https://doi.org/" + e.doi : e.ref || "see the Equations tab"}\n- Published standard error: ${e.see}\n- Calibration range: ${e.range}\n- Type: ${kind}. ${why}\n- Calibration domain: ${a
        ? `${a.status} the ${a.dataset} (n = ${a.n}); squared Mahalanobis distance D² = ${f(a.d2)} against the 95th and 99th percentiles of the calibration data, ${f(a.p95)} and ${f(a.p99)}. ${a.status === "inside" ? "The composition resembles the calibration experiments." : a.status === "marginal" ? "The composition lies at the edge of the calibration data; expect an error larger than the published one." : "The composition is unlike the calibration experiments: the equation is being extrapolated and its published error does not apply."}`
        : "not assessed. No calibration dataset is distributed for this equation, so compare the composition with the calibration range above by hand."}`);
    }
    const cond = { P_kbar: P, T_K: Tc + 273.15, opt: ctx.eqOpt }, rows = [], thermo = [];
    for (const e of avail) {
      let v; try { v = L.evaluate(e.id, s, cond); } catch (err) { v = NaN; }
      const ok = L.plausible(e.id, v), a = L.applicability(e.id, sample);
      if (ok && e.kind === "T" && e.system !== "liq_only") thermo.push({ e, T: v - 273.15 });
      rows.push([e.name, L.SYSTEMS[e.system].name, !ok ? "—" : e.kind === "T" ? `${f(v - 273.15)} °C` : e.kind === "P" ? `${f(v, 2)} kbar` : e.kind === "H2O" ? `${f(v, 2)} wt% H₂O` : `${f(v, 2)} ΔFMQ`, e.see, a ? a.status : "not assessed"]);
    }
    out.push(`All equations for the phases entered, thermometers at ${f(P, 2)} kbar and barometers at ${f(Tc)} °C:`, table(["Equation", "System", "Result", "SEE (1σ)", "Calibration domain"], rows));

    // ---- 4. uncertainty
    out.push("## 4. Uncertainty");
    if (pt) {
      const o = Object.assign({}, pt.solveOpt, pt.mc), base = Object.assign({}, sample, { cpxFe2: (ctx.eqOpt && ctx.eqOpt.cpxFe2) || "total" });
      mcA = L.monteCarloPT(pt.tId, pt.pId, base, Object.assign({}, o, { calibration: false }));
      mcT = L.monteCarloPT(pt.tId, pt.pId, base, Object.assign({}, o, { calibration: true }));
      out.push("Three sources of uncertainty are kept apart.",
        `- **Calibration (published SEE)**: ${eT.name} ${eT.see}; ${eP.name} ${eP.see}. This is the scatter of the calibration data about each equation. It contains experimental error, the imperfect activity model and components the equation ignores, and it does not shrink with better analyses.\n- **Analytical**: the effect of microprobe precision, obtained by Monte Carlo: ${o.N} draws, each oxide of each phase perturbed independently with σ = max(${f(o.rel * 100, 1)} % of the value, ${o.floor} wt%), seed ${o.seed}; the coupled system is solved again for every draw.\n- **Model choice**: the spread among different published equations for the same assemblage (section 5).`);
      if (mcA.T_C && mcT.T_C) {
        const row = (n, m) => [n, `${f(m.T_C.mean)} / ${f(m.T_C.median)}`, f(m.T_C.sd), `${f(m.T_C.mean - 2 * m.T_C.sd)} to ${f(m.T_C.mean + 2 * m.T_C.sd)}`, `${f(m.P_kbar.mean, 2)} / ${f(m.P_kbar.median, 2)}`, f(m.P_kbar.sd, 2), `${f(m.P_kbar.mean - 2 * m.P_kbar.sd, 2)} to ${f(m.P_kbar.mean + 2 * m.P_kbar.sd, 2)}`, f(m.rho, 3), `${m.points.length}/${m.N}`];
        out.push(table(["Monte Carlo run", "T mean / median (°C)", "σ_T", "T ±2σ", "P mean / median (kbar)", "σ_P", "P ±2σ", "ρ(T,P)", "Draws solved"], [row("Analytical only", mcA), row("Analytical + calibration", mcT)]));
        const share = (a, t) => (t > 0 ? Math.max(0, Math.min(100, (100 * a * a) / (t * t))) : NaN), aT = share(mcA.T_C.sd, mcT.T_C.sd), aP = share(mcA.P_kbar.sd, mcT.P_kbar.sd);
        out.push(`**Variance budget.** Taking σ²(total) ≈ σ²(analytical) + σ²(calibration), analytical noise accounts for ${f(aT, 0)} % of the variance of T and ${f(aP, 0)} % of the variance of P; the calibration accounts for the remaining ${f(100 - aT, 0)} % and ${f(100 - aP, 0)} %. ${aT < 25 && aP < 25 ? "Better analyses would therefore hardly improve this result: it is limited by the equations." : aT > 75 || aP > 75 ? "Analytical precision is the main limit for at least one variable: more or better analyses would help." : "Both sources matter."}`);
        const r = mcT.rho;
        out.push(`**Correlation.** With both sources included, ρ(T,P) = ${f(r, 3)}. ${!Number.isFinite(r) ? "The correlation is undefined because one variable does not vary." : Math.abs(r) > 0.7 ? `The errors in T and P are strongly ${r > 0 ? "positively" : "negatively"} coupled: the solutions lie along a narrow ${r > 0 ? "rising" : "falling"} band in the P–T plane, so the separate ±σ values overstate the area of P–T space that is allowed. Quote the ellipse, not a rectangle.` : Math.abs(r) > 0.3 ? "The errors are moderately coupled; the 1σ ellipse is tilted and somewhat smaller than the rectangle given by the separate ±σ values." : "The errors are nearly independent; the separate ±σ values describe the uncertainty adequately."}`);
        if (mcT.failed) out.push(`${mcT.failed} of ${mcT.N} draws found no intersection in the pressure window and are not in the statistics; if this fraction is large the statistics are biased towards the solvable side.`);
      } else out.push("Too few Monte Carlo draws produced a solution to give statistics.");
    } else out.push(`Without a coupled solution only the published standard errors in the table above apply, and they exclude the error of the assumed pressure or temperature.`);

    // ---- 5. solver, ensemble, discrepancy
    out.push("## 5. Coupled solution and dependence on the choice of equations");
    if (pt) {
      out.push(`The thermometer gives T as a function of P and the barometer P as a function of T. LithoPT finds the pressure at which the two agree, P = P_baro(T_thermo(P)), by bracketing a sign change on a grid between ${pt.solveOpt.Pmin} and ${pt.solveOpt.Pmax} kbar and bisecting (${pt.det.iterations} iterations).`);
      if (geo) out.push(`At the solution the thermometer changes by ${f(geo.dTdP, 2)} °C per kbar and the barometer by ${f(geo.dPdT * 100, 2)} kbar per 100 °C. After scaling T by ${f(geo.scaleT, 0)} °C and P by ${f(geo.scaleP, 2)} kbar (the standard errors of the two equations) the curves cross at **${f(geo.angle, 0)}°**: the intersection is **${geo.condition}**. ${geo.condition === "well-conditioned" ? "Errors in one equation are not strongly amplified by the other." : "The curves are close to parallel, so a small shift of either one moves the intersection a long way; the Monte Carlo spread, not the published SEE, is the realistic error."}`);
    }
    const ens = ctx.ens;
    if (ens && ens.summary) {
      const m = ens.summary;
      out.push(`**Model-choice ensemble.** ${ens.nSolved} of ${ens.pairs.length} compatible thermometer–barometer pairs gave a plausible solution: T median ${f(m.T_C.median)} °C (16th–84th percentile ${f(m.T_C.p16)}–${f(m.T_C.p84)}), P median ${f(m.P_kbar.median, 2)} kbar (${f(m.P_kbar.p16, 2)}–${f(m.P_kbar.p84, 2)}).` + (pt ? ` The selected pair lies ${f(Tc - m.T_C.median)} °C and ${f(P - m.P_kbar.median, 2)} kbar from the ensemble medians.` : ""),
        table(["Thermometer", "Barometer", "T (°C)", "P (kbar)", "In calibration domain"], ens.pairs.filter((q) => q.plausible).slice(0, 40).map((q) => [L.EQ[q.T].name, L.EQ[q.P].name, f(q.T_C), f(q.P_kbar, 2), q.inDomain ? "yes / not assessed" : "no"])));
    } else out.push(ens ? "**Model-choice ensemble.** Fewer than two compatible pairs could be solved, so no spread is reported." : "**Model-choice ensemble.** Not run.");
    const ex = thermo.filter((x) => EXCHANGE_T(x.e)).map((x) => x.T), other = thermo.filter((x) => !EXCHANGE_T(x.e)).map((x) => x.T);
    if (ex.length && other.length) {
      const d = median(other) - median(ex);
      out.push(`**Exchange against other thermometers.** Fe–Mg exchange thermometers give a median of ${f(median(ex))} °C (n = ${ex.length}); thermometers of other types give ${f(median(other))} °C (n = ${other.length}). ${d > 60 ? `The exchange temperatures are ${f(d, 0)} °C lower. This pattern is the usual signature of Fe–Mg exchange continuing during cooling after the peak; the higher temperatures are then closer to peak conditions. Confirm with compositional profiles across grain contacts.` : Math.abs(d) < 30 ? "The two groups agree within 30 °C, which supports (but does not prove) that peak compositions are preserved." : `The groups differ by ${f(d, 0)} °C, within what their calibration errors allow; no systematic resetting can be inferred.`}`);
    } else if (thermo.length > 1) {
      const t = thermo.map((x) => x.T);
      out.push(`**Spread among thermometers.** The ${t.length} thermometers evaluated at ${f(P, 2)} kbar span ${f(Math.min(...t))}–${f(Math.max(...t))} °C. They are all of the same type, so the spread reflects calibration differences, not different closure behaviour.`);
    }

    // ---- 6. figure, citations, reproducibility
    out.push("## 6. Diagram, sources and reproducibility");
    if (ctx.figure) out.push(`![P–T diagram](${ctx.figure})`, "Thermometer and barometer curves, Monte Carlo draws with 1σ (solid) and 2σ (dashed) ellipses, ensemble pairs (diamonds) and the deterministic solution.");
    const src = new Map();
    for (const e of pt ? [eT, eP] : used) src.set(e.doi ? `https://doi.org/${e.doi}` : e.ref || e.name, e.name);
    out.push("Cite the original calibrations and the software:", [...src].map(([k, n]) => `- ${n}: ${k}`).concat([`- Tiwari, K. (2026). LithoPT: browser-based thermobarometry with calibration-domain diagnostics and model-choice uncertainty (Version v${L.VERSION}) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.24341232`]).join("\n"));
    if (ctx.shareUrl) out.push("Open this calculation again (all inputs are in the link):", ctx.shareUrl);
    out.push("*The text of this report is generated from the numbers by fixed rules. It describes what the calculation implies; it cannot see the thin section. Textural evidence decides which compositions were in equilibrium.*");
    return { title, markdown: out.join("\n\n") + "\n", geometry: geo, mcAnalytical: mcA, mcTotal: mcT };
  }

  /** Minimal Markdown → HTML for the subset used above (headings, tables, lists, images, bold, italic). Input is escaped. */
  function toHtml(md) {
    const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const inline = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>").replace(/(https?:\/\/[^\s<]+[^\s<.,)])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    const html = [];
    for (const block of md.split(/\n{2,}/)) {
      const b = block.trim(), lines = b.split("\n");
      if (!b) continue;
      const h = b.match(/^(#{1,3}) (.*)$/), img = b.match(/^!\[([^\]]*)\]\((data:image\/png;base64,[A-Za-z0-9+/=]+)\)$/);
      if (h) html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      else if (img) html.push(`<figure><img alt="${esc(img[1])}" src="${img[2]}"></figure>`);
      else if (lines.every((l) => l.startsWith("|"))) {
        const cells = (l) => l.slice(1, -1).split("|").map((c) => c.trim());
        html.push(`<table><thead><tr>${cells(lines[0]).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${lines.slice(2).map((l) => `<tr>${cells(l).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      } else if (lines.every((l) => l.startsWith("- "))) html.push(`<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join("")}</ul>`);
      else html.push(`<p>${inline(lines.join(" "))}</p>`);
    }
    return html.join("\n");
  }

  return { build, toHtml, mechanism };
});
