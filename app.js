/**
 * LithoPT user interface (v4 layout). All science lives in lithopt-core.js;
 * this file only reads inputs, calls the engine and renders results.
 * License: MIT
 */
(function () {
  "use strict";
  const L = window.LithoPT;
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "text") n.textContent = v;
      else if (k === "class") n.className = v;
      else n.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    return n;
  };

  const PHASE_LABEL = { Grt: "Garnet", Bt: "Biotite", Cpx: "Clinopyroxene", Opx: "Orthopyroxene", Liq: "Melt (glass)",
    Ol: "Olivine", Pl: "Plagioclase", Kfs: "Alkali feldspar", Amp: "Amphibole", Sp: "Spinel", Trace: "Trace-element data" };
  const PHASE_FIELDS = (ph) => ph === "Trace"
    ? ["Ti_zrc", "Zr_rt", "Zr_ttn", "Ti_qz", "Ti_bt_apfu", "XMg_bt", "aTiO2", "aSiO2"]
    : ph === "Liq" ? L.LIQUID_OXIDES.concat(["H2O", "Fe3Fet", "Zr_ppm"]) : ph === "Grt" ? L.MINERAL_OXIDES.concat(["Ni_ppm"]) : L.MINERAL_OXIDES;
  const FIELD_LABEL = { Ti_zrc: "Ti in zircon (ppm)", Zr_rt: "Zr in rutile (ppm)", Zr_ttn: "Zr in titanite (ppm)", Ti_qz: "Ti in quartz (ppm)",
    Ti_bt_apfu: "Ti in biotite (apfu, 22 O)", XMg_bt: "X_Mg biotite", aTiO2: "a(TiO2)", aSiO2: "a(SiO2)", Zr_ppm: "Zr (ppm)",
    H2O: "H₂O (wt%)", Fe3Fet: "Fe³⁺/ΣFe", Ni_ppm: "Ni (ppm)" };
  // extra (non-oxide) fields are only shown where an equation of the selected system uses them
  const FIELD_SYSTEMS = { Zr_ppm: ["liq_only"], Fe3Fet: ["liq_only", "ol_liq", "cpx_liq", "opx_liq"], Ni_ppm: ["grt_only"] };
  const TRACE_DEFAULTS = { aTiO2: 1, aSiO2: 1 };
  const SYSTEM_GROUPS = [
    ["Metamorphic rocks", ["grt_bt", "gasp", "grt_cpx", "grt_opx"]],
    ["Mantle rocks", ["two_px", "ol_sp", "grt_only"]],
    ["Magmas: mineral + melt", ["cpx_liq", "opx_liq", "ol_liq", "plag_liq", "kfs_liq"]],
    ["Magmas: minerals only", ["cpx_only", "opx_only", "amp_only", "two_fsp"]],
    ["Melt and accessory minerals", ["liq_only", "trace"]]];

  // ------------------------------------------------------------------ state
  const state = { system: "grt_bt", P: 5, T: 800, sample: {}, opt: { gammaGrs: 1, gammaAn: 1, cpxFe2: "total" } };

  const PRESETS = {
    pelite: { label: "Metapelite: Grt–Bt–Pl–Ky–Qz", system: "grt_bt", P: 6, T: 650, sample: {
      Grt: { SiO2: 37.52, TiO2: 0.05, Al2O3: 21.4, Cr2O3: 0.02, FeOt: 29.8, MnO: 1.85, MgO: 4.2, CaO: 4.5, Na2O: 0.03, K2O: 0.01 },
      Bt: { SiO2: 35.8, TiO2: 2.85, Al2O3: 18.5, FeOt: 18.2, MnO: 0.15, MgO: 11.2, CaO: 0.08, Na2O: 0.25, K2O: 9.4 },
      Pl: { SiO2: 60.1, Al2O3: 25.0, CaO: 6.6, Na2O: 7.6, K2O: 0.15 } }, pt: ["T_FerrySpear1978", "P_Koziol1988_GASP"] },
    lherzolite: { label: "Garnet lherzolite: Cpx–Opx–Grt (illustrative)", system: "two_px", P: 30, T: 1100, sample: {
      Cpx: { SiO2: 52.4, TiO2: 0.35, Al2O3: 4.1, Cr2O3: 0.9, FeOt: 3.1, MnO: 0.09, MgO: 16.2, CaO: 20.3, Na2O: 1.2, K2O: 0.01 },
      Opx: { SiO2: 56.8, TiO2: 0.08, Al2O3: 0.9, Cr2O3: 0.3, FeOt: 6.1, MnO: 0.13, MgO: 34.1, CaO: 0.85, Na2O: 0.12 },
      Grt: { SiO2: 41.9, TiO2: 0.1, Al2O3: 22.1, Cr2O3: 2.2, FeOt: 7.4, MnO: 0.35, MgO: 20.6, CaO: 5.1, Na2O: 0.03 } },
      pt: ["T_Brey1990", "P_Brey1990"] },
    eclogite: { label: "Eclogite: Grt–Cpx (illustrative)", system: "grt_cpx", P: 20, T: 750, sample: {
      Grt: { SiO2: 38.9, TiO2: 0.05, Al2O3: 21.9, FeOt: 22.5, MnO: 0.5, MgO: 8.1, CaO: 8.3 },
      Cpx: { SiO2: 55.2, TiO2: 0.1, Al2O3: 9.6, FeOt: 4.1, MgO: 9.2, CaO: 14.6, Na2O: 6.4 } } },
    spinel: { label: "Spinel peridotite: Ol–Sp oxybarometry (illustrative)", system: "ol_sp", P: 15, T: 1000, sample: {
      Ol: { SiO2: 40.8, FeOt: 9.2, MnO: 0.13, MgO: 49.5, CaO: 0.05 },
      Sp: { TiO2: 0.1, Al2O3: 50.0, Cr2O3: 17.0, FeOt: 12.5, MnO: 0.1, MgO: 20.0 } } },
    basalt: { label: "Basalt: Cpx–liquid (illustrative)", system: "cpx_liq", P: 5, T: 1180, sample: {
      Cpx: { SiO2: 50.8, TiO2: 0.7, Al2O3: 4.6, Cr2O3: 0.4, FeOt: 6.2, MnO: 0.14, MgO: 15.6, CaO: 20.4, Na2O: 0.38 },
      Liq: { SiO2: 50.5, TiO2: 1.2, Al2O3: 15.8, FeOt: 9.6, MnO: 0.17, MgO: 7.6, CaO: 11.2, Na2O: 2.6, K2O: 0.45, P2O5: 0.15, H2O: 0.5 } },
      pt: ["T_Put2008_eq33", "P_Neave2017"] },
    phonolite: { label: "Phonolite: Cpx–liquid (Masotta et al., 2013, example MB-22)", system: "cpx_liq", P: 1, T: 850, sample: {
      Cpx: { SiO2: 52.3, TiO2: 0.86, Al2O3: 0.85, FeOt: 11.3, MnO: 1.14, MgO: 11.9, CaO: 20.8, Na2O: 0.92 },
      Liq: { SiO2: 60.7, TiO2: 0.67, Al2O3: 19.4, FeOt: 3.1, MnO: 0.16, MgO: 0.28, CaO: 0.6, Na2O: 9.8, K2O: 5.34, H2O: 3.12 } },
      pt: ["T_Mas2013_Talk2012", "P_Mas2013_Palk2012"] },
    amphibole: { label: "Arc-magma amphibole (Putirka, 2016, worked example)", system: "amp_only", P: 5, T: 950, sample: {
      Amp: { SiO2: 40.57, TiO2: 2.45, Al2O3: 12.82, FeOt: 13.11, MnO: 0.26, MgO: 13.02, CaO: 11.63, Na2O: 2.2, K2O: 0.92 } },
      pt: ["T_Put2016_eq6", "P_Ridolfi2012_1b"] },
    mantleGrt: { label: "Mantle garnet xenocryst: Ni-in-garnet (illustrative)", system: "grt_only", P: 40, T: 1000, sample: {
      Grt: { SiO2: 41.9, TiO2: 0.1, Al2O3: 22.1, Cr2O3: 2.2, FeOt: 7.4, MnO: 0.35, MgO: 20.6, CaO: 5.1, Na2O: 0.03, Ni_ppm: 60 } } },
    granite: { label: "Granitic melt: zircon and apatite saturation (illustrative)", system: "liq_only", P: 2, T: 800, sample: {
      Liq: { SiO2: 72.0, TiO2: 0.3, Al2O3: 14.0, FeOt: 2.0, MgO: 0.5, CaO: 1.5, Na2O: 3.8, K2O: 4.2, P2O5: 0.12, Zr_ppm: 150 } } },
    zircon: { label: "Trace-element thermometers (illustrative)", system: "trace", P: 10, T: 700, sample: {
      Trace: { Ti_zrc: 10, Zr_rt: 100, Zr_ttn: 300, Ti_qz: 50, Ti_bt_apfu: 0.3, XMg_bt: 0.5, aTiO2: 1, aSiO2: 1 } } }
  };

  // ------------------------------------------------------------------ helpers
  const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
  const toast = (msg) => { const t = $("toastNotification"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2500); };
  const readNum = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
  const displayValue = (e, v) => e.kind === "T" ? `${fmt(v - 273.15)} °C` : e.kind === "P" ? `${fmt(v, 2)} kbar` : e.kind === "H2O" ? `${fmt(v, 2)} wt%` : `${fmt(v, 2)} ΔFMQ`;
  const KIND_NAME = { T: "Thermometer", P: "Barometer", H2O: "Hygrometer", fO2: "Oxybarometer" };
  const prevShown = {}; // last displayed value per equation, to highlight changes
  let lastRows = [];    // rows shown in the results table, reused by the share summary and feedback report
  const SRC_BADGE = { Published: ["badge-success", "checked vs. paper"], Pending: ["badge-warning", "pending"] };
  const REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isDark = () => document.documentElement.dataset.theme === "dark";
  // Oxide keys → label with subscripts (SiO2 → SiO₂, FeOt → FeOₜ); other fields use FIELD_LABEL text.
  function fieldLabel(f) {
    const lab = el("label");
    if (FIELD_LABEL[f]) lab.textContent = FIELD_LABEL[f];
    else lab.innerHTML = f.replace(/(\d+)/g, "<sub>$1</sub>").replace(/Ot$/, "O<sub>t</sub>");
    return lab;
  }
  // Animate a number up to its final text; the final text is exactly `final`.
  function countUp(node, to, d, unit, final) {
    if (REDUCED || !Number.isFinite(to)) { node.textContent = final; return; }
    const t0 = performance.now(), from = to * 0.9;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 650), e = 1 - Math.pow(1 - k, 3);
      node.textContent = k < 1 ? `${(from + (to - from) * e).toFixed(d)} ${unit}` : final;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // Show a spinner on the button while a synchronous job runs (lets the browser paint first).
  function busy(btn, fn) {
    btn.classList.add("is-busy"); btn.disabled = true;
    setTimeout(() => { try { fn(); } finally { btn.classList.remove("is-busy"); btn.disabled = false; } }, 30);
  }
  function applic(e) { try { return L.applicability(e.id, state.sample); } catch (err) { return null; } }
  function domainNode(a) {
    if (!a) return el("span", { class: "form-hint", text: "—" });
    const cls = { inside: "badge-success", marginal: "badge-warning", outside: "badge-danger" }[a.status];
    return el("span", { class: "badge " + cls, title: `${a.dataset} (n = ${a.n}); D² = ${a.d2.toFixed(1)}; 95th/99th percentile of calibration data: ${a.p95.toFixed(1)}/${a.p99.toFixed(1)}`, text: `${a.status} (D² ${a.d2.toFixed(0)})` });
  }
  const refNode = (e) => e.doi ? el("a", { href: "https://doi.org/" + e.doi, target: "_blank", rel: "noopener noreferrer", text: e.name }) : el("span", { text: `${e.name}, ${e.ref || ""}` });

  function prepared() { return L.prepare(Object.assign({}, state.sample, { cpxFe2: state.opt.cpxFe2 })); }
  function eqAvailable(e) { return L.SYSTEMS[e.system].phases.every((ph) => state.sample[ph] && Object.values(state.sample[ph]).some((v) => v > 0)); }

  // ------------------------------------------------------------------ calculator
  function buildSystemSelect() {
    const s = $("systemSelect");
    s.textContent = "";
    for (const [group, keys] of SYSTEM_GROUPS) {
      const og = el("optgroup", { label: group });
      for (const k of keys) og.appendChild(el("option", { value: k, text: `${L.SYSTEMS[k].name} (${L.EQUATIONS.filter((e) => e.system === k).length})` }));
      s.appendChild(og);
    }
    s.value = state.system;
    s.addEventListener("change", () => { state.system = s.value; renderPhaseInputs(); compute(); });
    $("condP").addEventListener("input", () => { state.P = readNum("condP"); compute(); });
    $("condT").addEventListener("input", () => { state.T = readNum("condT"); compute(); });
  }

  function renderSystemOptions() {
    const box = $("systemOptions");
    box.textContent = "";
    const sys = L.SYSTEMS[state.system], kinds = [...new Set(L.EQUATIONS.filter((e) => e.system === state.system).map((e) => KIND_NAME[e.kind].toLowerCase() + "s"))];
    const needs = $("systemNeeds"); needs.textContent = "";
    needs.append("You need: ", el("b", { text: sys.phases.map((ph) => PHASE_LABEL[ph].toLowerCase()).join(" + ") }), `. Gives ${kinds.join(", ")}.`);
    if (state.system === "gasp") {
      box.appendChild(el("p", { class: "form-hint", text: "GASP activities: a(Grs) = (γ·X_Grs)³, a(An) = γ·X_An. Ideal mixing (γ = 1) is a lower bound on the activity coefficients; enter γ from your preferred solution model." }));
      for (const [k, lbl] of [["gammaGrs", "γ Grs (garnet)"], ["gammaAn", "γ An (plagioclase)"]]) {
        const inp = el("input", { type: "number", class: "text-input", step: "0.05", min: "0.1", value: String(state.opt[k]) });
        inp.addEventListener("input", () => { state.opt[k] = parseFloat(inp.value) || 1; compute(); });
        box.appendChild(el("div", { class: "form-group" }, [el("label", { text: lbl }), inp]));
      }
    }
    if (state.system === "grt_only") {
      const inp = el("input", { type: "number", class: "text-input", step: "100", min: "1", value: String(state.opt.niOl ?? 3000) });
      inp.addEventListener("input", () => { state.opt.niOl = parseFloat(inp.value) || 3000; compute(); });
      box.appendChild(el("div", { class: "form-group" }, [el("label", { text: "Ni in coexisting olivine (ppm), for Canil (1999) and Sudholz et al. (2021)" }), inp]));
    }
    if (state.system === "grt_cpx") {
      const sel = el("select", { class: "select-input" }, [el("option", { value: "total", text: "All Fe in Cpx as Fe2+" }), el("option", { value: "lindsley", text: "Cpx Fe3+ by charge balance (Lindsley, 1983)" })]);
      sel.value = state.opt.cpxFe2;
      sel.addEventListener("change", () => { state.opt.cpxFe2 = sel.value; compute(); });
      box.appendChild(el("div", { class: "form-group" }, [el("label", { text: "Clinopyroxene Fe2+ for K_D" }), sel]));
    }
  }

  function renderPhaseInputs() {
    renderSystemOptions();
    const box = $("phaseInputs");
    box.textContent = "";
    for (const ph of L.SYSTEMS[state.system].phases) {
      state.sample[ph] = state.sample[ph] || (ph === "Trace" ? Object.assign({}, TRACE_DEFAULTS) : {});
      const fields = PHASE_FIELDS(ph).filter((f) => !FIELD_SYSTEMS[f] || FIELD_SYSTEMS[f].includes(state.system));
      const grid = el("div", { class: "grid-2col compact-grid" });
      for (const f of fields) {
        const inp = el("input", { type: "number", class: "text-input", step: "any", min: "0", "aria-label": `${PHASE_LABEL[ph]} ${f}` });
        const v = state.sample[ph][f];
        inp.value = v === undefined ? "" : String(v);
        inp.addEventListener("input", () => {
          const x = parseFloat(inp.value);
          if (Number.isFinite(x)) state.sample[ph][f] = x; else delete state.sample[ph][f];
          compute();
        });
        grid.appendChild(el("div", { class: "form-group" }, [fieldLabel(f), inp]));
      }
      const sum = el("span", { class: "badge", id: `sum_${ph}` });
      const head = el("div", { class: "diag-header" }, [el("span", { class: "phase-tag" }, [el("span", { class: "phase-abbr", text: ph }), el("strong", { text: PHASE_LABEL[ph] })]), sum]);
      const meter = ph === "Trace" ? null : el("div", { class: "sum-meter", id: `meter_${ph}` }, [el("span")]);
      box.appendChild(el("div", { class: "card-highlight" }, [head, meter, grid]));
    }
    compute();
  }

  function compute() {
    const tbody = $("resultsBody");
    tbody.textContent = "";
    const errs = [];
    for (const ph of L.SYSTEMS[state.system].phases) {
      if (ph === "Trace") continue;
      const total = L.MINERAL_OXIDES.concat(ph === "Liq" ? ["P2O5", "H2O"] : []).reduce((a, o) => a + (state.sample[ph]?.[o] || 0), 0);
      const b = $(`sum_${ph}`);
      const ok = total >= 98.5 && total <= 101.5;
      if (b) { b.textContent = `Σ ${total.toFixed(2)}`; b.className = "badge " + (ok ? "badge-success" : total > 0 ? "badge-warning" : ""); }
      const m = $(`meter_${ph}`);
      if (m) { m.className = "sum-meter " + (ok ? "ok" : total > 0 ? "warn" : ""); m.firstChild.style.width = `${Math.min(100, total)}%`; }
    }
    let s = null;
    try { s = prepared(); } catch (e) { errs.push(e.message); }
    const cond = { P_kbar: state.P ?? 0, T_K: (state.T ?? 0) + 273.15, opt: state.opt };
    const eqs = L.EQUATIONS.filter((x) => x.system === state.system);
    let nOk = 0, nIn = 0, nDom = 0;
    lastRows = [];
    for (const e of eqs) {
      let v = NaN, note = "";
      if (s) {
        try { v = L.evaluate(e.id, s, cond); } catch (err) { note = err.message; }
        if (!note && !Number.isFinite(v)) note = "undefined for this composition (e.g. log of a non-positive component)";
        else if (!note && !L.plausible(e.id, v)) note = "physically implausible — composition far outside the calibration of this equation";
      }
      if (s && !note) nOk++;
      const a = applic(e);
      if (a) { nDom++; if (a.status === "inside") nIn++; }
      const txt = note ? "—" : displayValue(e, v);
      const val = el("strong", { text: txt });
      if (prevShown[e.id] !== undefined && prevShown[e.id] !== txt && !REDUCED) val.classList.add("flash");
      prevShown[e.id] = txt;
      lastRows.push({ e, txt, note, a });
      const cells = [el("td", {}, [el("div", { class: "eq-name" }, [el("span", { class: `kind-dot kind-${e.kind}`, title: KIND_NAME[e.kind] }), refNode(e)]), el("div", { class: "eq-meta" }, [el("span", { class: "badge " + SRC_BADGE[e.src][0], text: SRC_BADGE[e.src][1] }), el("span", { class: "form-hint", text: e.range })])]),
        el("td", { "data-label": "Result" }, [val, note ? el("div", { class: "form-hint", text: note }) : null]),
        el("td", { "data-label": "1σ (SEE)", text: e.see }), el("td", { "data-label": "Calibration domain" }, [domainNode(a)])];
      tbody.appendChild(el("tr", {}, cells));
    }
    const eb = $("calcErrors");
    eb.hidden = errs.length === 0;
    eb.textContent = errs.join(" · ");

    const tests = $("eqTests");
    tests.textContent = "";
    const list = s ? L.equilibriumTests(s) : [];
    if (!list.length) tests.textContent = "None of the equations for the entered phases defines an equilibrium test.";
    for (const t of list) tests.appendChild(el("div", { class: "eq-row" }, [el("span", { class: "badge " + (t.pass ? "badge-success" : "badge-danger"), text: t.pass ? "pass" : "fail" }), ` ${t.name}: ${fmt(t.value, 3)} (accepted ${t.lo}–${t.hi})`]));

    const nPass = list.filter((t) => t.pass).length;
    const nPh = L.SYSTEMS[state.system].phases.filter((ph) => state.sample[ph] && Object.values(state.sample[ph]).some((v) => v > 0)).length;
    const stat = (label, value, sub, frac, color, isText) => el("div", { class: "stat", style: color ? `--stat-c:${color}` : "" }, [
      el("div", { class: "stat-label", text: label }), el("div", { class: "stat-value" + (isText ? " is-text" : "") }, value), el("div", { class: "stat-sub", text: sub }),
      frac == null ? null : el("div", { class: "stat-meter" }, [el("span", { style: `width:${Math.round(frac * 100)}%` })])]);
    const strip = $("calcStats");
    strip.textContent = "";
    strip.append(
      stat("System", [L.SYSTEMS[state.system].name], `${nPh} of ${L.SYSTEMS[state.system].phases.length} phases entered`, null, null, true),
      stat("Evaluated", [String(nOk), el("small", { text: ` / ${eqs.length}` })], "equations with a valid result", eqs.length ? nOk / eqs.length : 0, "var(--accent)"),
      stat("Calibration domain", [String(nIn), el("small", { text: ` / ${nDom}` })], nDom ? "equations inside their calibration data" : "no domain data for this system", nDom ? nIn / nDom : 0, "var(--ok)"),
      stat("Equilibrium tests", list.length ? [String(nPass), el("small", { text: ` / ${list.length}` })] : ["—"], list.length ? "tests passed" : "no applicable pair", list.length ? nPass / list.length : null, list.length && nPass < list.length ? "var(--warn)" : "var(--ok)"));

    const comp = $("componentSummary");
    comp.textContent = "";
    if (s) {
      const parts = [];
      if (s.Grt) parts.push(`Grt: Alm ${fmt(s.Grt.XAlm, 3)}, Prp ${fmt(s.Grt.XPrp, 3)}, Grs ${fmt(s.Grt.XGrs, 3)}, Sps ${fmt(s.Grt.XSps, 3)}`);
      if (s.Bt) parts.push(`Bt: X_Mg ${fmt(s.Bt.XMg, 3)}, Ti ${fmt(s.Bt.cat.Ti, 3)} apfu (22 O)`);
      if (s.Cpx) parts.push(`Cpx (6 O): Ca ${fmt(s.Cpx.cat.Ca, 3)}, Na ${fmt(s.Cpx.cat.Na, 3)}, Al_VI ${fmt(s.Cpx.cat.Al_VI, 3)}, Fe3+ (Lindsley) ${fmt(s.Cpx.Fe3_Lindsley, 3)}`);
      if (s.Opx) parts.push(`Opx (6 O): Ca ${fmt(s.Opx.cat.Ca, 3)}, Al ${fmt(s.Opx.cat.Al, 3)}, Mg/(Mg+Fe) ${fmt(s.Opx.cat.Mg / (s.Opx.cat.Mg + s.Opx.cat.Fe), 3)}`);
      if (s.Pl) parts.push(`Pl: An ${fmt(s.Pl.An, 3)}, Ab ${fmt(s.Pl.Ab, 3)}`);
      if (s.Kfs) parts.push(`Kfs: Or ${fmt(s.Kfs.Or, 3)}, Ab ${fmt(s.Kfs.Ab, 3)}, An ${fmt(s.Kfs.An, 3)}`);
      if (s.Amp) parts.push(`Amp (23 O): Si ${fmt(s.Amp.c23.Si, 2)}, Al ${fmt(s.Amp.c23.Al, 2)}, Mg# ${fmt(s.Amp.MgNo, 3)}`);
      if (s.Ol) parts.push(`Ol: Fo ${fmt(s.Ol.Fo, 3)}`);
      if (s.Sp) parts.push(`Sp: Cr# ${fmt(s.Sp.CrNo, 3)}, Fe3+/ΣR3+ ${fmt(s.Sp.XFe3, 3)}`);
      if (s.Liq) parts.push(`Liq: Mg# ${fmt(s.Liq.MgNo, 3)}, M ${fmt((s.Liq.cf.Na + s.Liq.cf.K + 2 * s.Liq.cf.Ca) / (s.Liq.cf.Al * s.Liq.cf.Si), 2)}`);
      const box = el("div", { class: "comp-list" });
      for (const p of parts) { const i = p.indexOf(": "); box.appendChild(el("div", { class: "comp-chip" }, [el("span", { class: "phase-abbr", text: p.slice(0, i) }), p.slice(i + 2)])); }
      comp.appendChild(box);
    }
    refreshPtSelects();
  }

  // ------------------------------------------------------------------ P–T solver
  function refreshPtSelects() {
    for (const [id, kind] of [["ptThermo", "T"], ["ptBaro", "P"]]) {
      const sel = $(id), keep = sel.value;
      sel.textContent = "";
      for (const e of L.EQUATIONS.filter((x) => x.kind === kind && eqAvailable(x))) sel.appendChild(el("option", { value: e.id, text: `${L.SYSTEMS[e.system].name}: ${e.name}` }));
      if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
    }
  }

  let lastPt = null;
  function runPt() {
    const tId = $("ptThermo").value, pId = $("ptBaro").value;
    const box = $("ptSummary");
    box.textContent = "";
    if (!tId || !pId) { box.appendChild(el("p", { text: "Enter the phases required by at least one thermometer and one barometer in the Calculator tab." })); return; }
    const opt = { Pmin: readNum("ptPmin") ?? 0, Pmax: readNum("ptPmax") ?? 70, eqOpt: state.opt };
    let det;
    try { det = L.solvePT(tId, pId, prepared(), opt); } catch (e) { det = { converged: false, reason: e.message }; }
    const sampleWithOpt = Object.assign({}, state.sample, { cpxFe2: state.opt.cpxFe2 });
    const mc = det.converged ? L.monteCarloPT(tId, pId, sampleWithOpt, Object.assign({}, opt, {
      N: Math.max(100, readNum("mcN") || 1000), rel: (readNum("mcRel") ?? 2) / 100, floor: readNum("mcFloor") ?? 0.02, seed: readNum("mcSeed") ?? 42,
      calibration: $("mcCal").checked })) : null;
    lastPt = { tId, pId, det, mc, opt };
    const row = (k, v) => box.appendChild(el("div", { class: "conv-item" }, [el("span", { class: "conv-lbl", text: k }), el("span", { class: "conv-val", text: v })]));
    if (!det.converged) { row("Status", `No solution: ${det.reason}`); drawPt(); return; }
    const eT = L.EQ[tId], eP = L.EQ[pId];
    const kpi = (cls, label, v, d, unit, sub) => {
      const strong = el("strong", { text: `${fmt(v, d)} ${unit}` });
      countUp(strong, v, d, unit, `${fmt(v, d)} ${unit}`);
      return el("div", { class: "kpi " + cls }, [el("span", { text: label }), strong, el("small", { text: sub })]);
    };
    const hasMc = mc && mc.T_C;
    box.appendChild(el("div", { class: "kpi-row" }, [
      kpi("kpi-T", "Temperature", det.T_K - 273.15, 1, "°C", hasMc ? `± ${fmt(mc.T_C.sd)} °C (1σ MC)` : eT.name),
      kpi("kpi-P", "Pressure", det.P_kbar, 2, "kbar", hasMc ? `± ${fmt(mc.P_kbar.sd, 2)} kbar (1σ MC)` : eP.name)]));
    row("Deterministic T", `${fmt(det.T_K - 273.15)} °C`);
    row("Deterministic P", `${fmt(det.P_kbar, 2)} kbar`);
    const dm = $("depthModel").value, depth = L.pressureToDepth(det.P_kbar, dm, readNum("depthRho") || 2700);
    row("Depth", Number.isFinite(depth) ? `${fmt(depth, 1)} km (${L.DEPTH_MODELS[dm].name})` : `outside the range of ${L.DEPTH_MODELS[dm].name}`);
    if (mc && mc.T_C) {
      row("Monte Carlo T (median, 16–84 %)", `${fmt(mc.T_C.median)} °C (${fmt(mc.T_C.p16)}–${fmt(mc.T_C.p84)})`);
      row("Monte Carlo P (median, 16–84 %)", `${fmt(mc.P_kbar.median, 2)} kbar (${fmt(mc.P_kbar.p16, 2)}–${fmt(mc.P_kbar.p84, 2)})`);
      row("σ_T, σ_P, ρ(T,P)", `${fmt(mc.T_C.sd)} °C, ${fmt(mc.P_kbar.sd, 2)} kbar, ${fmt(mc.rho, 3)}`);
      row("Draws solved", `${mc.points.length} / ${mc.N}${mc.failed ? ` (${mc.failed} without intersection)` : ""}`);
    }
    row($("mcCal").checked ? "Calibration SEE (included above)" : "Calibration SEE (not included above)", `${eT.see}; ${eP.see}`);
    for (const e of [eT, eP]) { const a = L.applicability(e.id, state.sample); if (a) row(`Calibration domain, ${e.name}`, `${a.status} (D² = ${a.d2.toFixed(1)}; 99th pct. ${a.p99.toFixed(1)})`); }
    animatePt();
  }

  let lastEns = null;
  function runEnsemble() {
    const box = $("ensSummary");
    box.textContent = "";
    const systems = [...$("ensSystems").selectedOptions].map((o) => o.value);
    const res = L.ensemblePT(Object.assign({}, state.sample, { cpxFe2: state.opt.cpxFe2 }), { systems: systems.length ? systems : undefined, restricted: $("ensRestricted").checked, Pmin: readNum("ptPmin") ?? 0, Pmax: readNum("ptPmax") ?? 70, eqOpt: state.opt });
    lastEns = res;
    const row = (k, v) => box.appendChild(el("div", { class: "conv-item" }, [el("span", { class: "conv-lbl", text: k }), el("span", { class: "conv-val", text: v })]));
    row("Pairs solved", `${res.nSolved} of ${res.pairs.length}`);
    if (res.summary) {
      row("All pairs: T (median, 16–84 %)", `${fmt(res.summary.T_C.median)} °C (${fmt(res.summary.T_C.p16)}–${fmt(res.summary.T_C.p84)}), σ ${fmt(res.summary.T_C.sd)}`);
      row("All pairs: P (median, 16–84 %)", `${fmt(res.summary.P_kbar.median, 2)} kbar (${fmt(res.summary.P_kbar.p16, 2)}–${fmt(res.summary.P_kbar.p84, 2)}), σ ${fmt(res.summary.P_kbar.sd, 2)}`);
    }
    if (res.summaryInDomain && L.DOMAINS()) { // without calibration-domain data every pair would count as "in domain"
      row(`Without out-of-domain pairs (n = ${res.summaryInDomain.n}): T`, `${fmt(res.summaryInDomain.T_C.median)} °C, σ ${fmt(res.summaryInDomain.T_C.sd)}`);
      row("Without out-of-domain pairs: P", `${fmt(res.summaryInDomain.P_kbar.median, 2)} kbar, σ ${fmt(res.summaryInDomain.P_kbar.sd, 2)}`);
    }
    animatePt();
  }

  // Redraw the diagram with curves and points revealed progressively.
  let animId = 0;
  function animatePt() {
    const id = ++animId;
    if (REDUCED) { drawPt(1); return; }
    const t0 = performance.now();
    const step = (t) => {
      if (id !== animId) return; // a newer animation started
      const k = Math.min(1, (t - t0) / 900);
      drawPt(1 - Math.pow(1 - k, 3));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const PT_SCALE = 2; // canvas is 1400×1040 device pixels for a 700×520 drawing: crisp on HiDPI and in exported PNGs
  function drawPt(k = 1) {
    const cv = $("ptCanvas"), ctx = cv.getContext("2d"), W = cv.width / PT_SCALE, H = cv.height / PT_SCALE;
    ctx.setTransform(PT_SCALE, 0, 0, PT_SCALE, 0, 0);
    const dark = isDark();
    const C = dark
      ? { bg: "#1c1c1a", plot: "#20201e", fg: "#ecebe7", mute: "#9a9891", grid: "#333330", T: "#f08a4b", P: "#7aa2f7", mc: "rgba(190,188,180,0.32)", ell: "#ecebe7" }
      : { bg: "#ffffff", plot: "#faf9f7", fg: "#1d1c1a", mute: "#6b6963", grid: "#e3e1db", T: "#c2410c", P: "#1d4ed8", mc: "rgba(90,88,82,0.24)", ell: "#1d1c1a" };
    const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    if (!lastPt || !lastPt.det.converged) {
      ctx.fillStyle = C.mute; ctx.textAlign = "center"; ctx.font = `500 15px ${FONT}`;
      ctx.fillText(lastPt ? "No intersection found for this pair" : "Solve P–T to draw the diagram", W / 2, H / 2 - 4);
      ctx.font = `12px ${FONT}`; ctx.fillText("Curves, Monte Carlo cloud and ensemble pairs appear here", W / 2, H / 2 + 18);
      ctx.textAlign = "left"; return;
    }
    const { tId, pId, det, mc, opt } = lastPt;
    const s = prepared();
    const Tc = det.T_K - 273.15, Pc = det.P_kbar;
    const sdT = mc && mc.T_C ? mc.T_C.sd : 20, sdP = mc && mc.P_kbar ? mc.P_kbar.sd : 1;
    const x0 = Tc - Math.max(150, 5 * sdT), x1 = Tc + Math.max(150, 5 * sdT);
    const y0 = Math.max(opt.Pmin, Pc - Math.max(5, 5 * sdP)), y1 = Math.min(opt.Pmax, Pc + Math.max(5, 5 * sdP));
    const m = { l: 68, r: 22, t: 22, b: 58 };
    const X = (t) => m.l + ((t - x0) / (x1 - x0)) * (W - m.l - m.r), Y = (p) => H - m.b - ((p - y0) / (y1 - y0)) * (H - m.t - m.b);
    ctx.fillStyle = C.plot; ctx.fillRect(m.l, m.t, W - m.l - m.r, H - m.t - m.b);
    ctx.strokeStyle = C.grid; ctx.fillStyle = C.mute; ctx.font = `13px ${FONT}`; ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const t = x0 + ((x1 - x0) * i) / 5, p = y0 + ((y1 - y0) * i) / 5;
      ctx.beginPath(); ctx.moveTo(X(t), m.t); ctx.lineTo(X(t), H - m.b); ctx.moveTo(m.l, Y(p)); ctx.lineTo(W - m.r, Y(p)); ctx.stroke();
      ctx.textAlign = "center"; ctx.fillText(t.toFixed(0), X(t), H - m.b + 17);
      ctx.textAlign = "right"; ctx.fillText(p.toFixed(1), m.l - 8, Y(p) + 4);
    }
    ctx.fillStyle = C.fg; ctx.font = `600 14px ${FONT}`; ctx.textAlign = "center";
    ctx.fillText("Temperature (°C)", m.l + (W - m.l - m.r) / 2, H - 14);
    ctx.save(); ctx.translate(16, m.t + (H - m.t - m.b) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText("Pressure (kbar)", 0, 0); ctx.restore();
    ctx.textAlign = "left";

    ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, W - m.l - m.r, H - m.t - m.b); ctx.clip();
    const curve = (pts, color) => { ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.beginPath(); let st = false;
      for (const [t, p] of pts) { if (!Number.isFinite(t) || !Number.isFinite(p)) { st = false; continue; } st ? ctx.lineTo(X(t), Y(p)) : ctx.moveTo(X(t), Y(p)); st = true; } ctx.stroke(); };
    const n = 80, cond = { opt: state.opt }, nk = Math.max(1, Math.round(n * k));
    curve([...Array(nk + 1)].map((_, i) => { const p = y0 + ((y1 - y0) * i) / n; return [L.evaluate(tId, s, Object.assign({ P_kbar: p }, cond)) - 273.15, p]; }), C.T);
    curve([...Array(nk + 1)].map((_, i) => { const t = x0 + ((x1 - x0) * i) / n; return [t, L.evaluate(pId, s, Object.assign({ T_K: t + 273.15 }, cond))]; }), C.P);
    if (mc && mc.points) {
      ctx.fillStyle = C.mc;
      const np = Math.round(mc.points.length * k);
      for (let i = 0; i < np; i++) { const q = mc.points[i]; ctx.beginPath(); ctx.arc(X(q.T_K - 273.15), Y(q.P_kbar), 1.9, 0, 2 * Math.PI); ctx.fill(); }
      if (mc.T_C) { ctx.globalAlpha = k; for (const j of [1, 2]) drawEllipse(ctx, X, Y, mc, j, C.ell); ctx.globalAlpha = 1; }
    }
    if (lastEns) for (const q of lastEns.pairs) {
      if (!q.converged || q.T_C < x0 || q.T_C > x1 || q.P_kbar < y0 || q.P_kbar > y1) continue;
      const cx = X(q.T_C), cy = Y(q.P_kbar), r = 5.5 * k;
      ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath();
      ctx.strokeStyle = "#d97706"; ctx.lineWidth = 1.3; ctx.stroke();
      if (q.inDomain) { ctx.fillStyle = "rgba(217,119,6,0.75)"; ctx.fill(); }
    }
    // solution marker with halo
    const sx = X(Tc), sy = Y(Pc), halo = 7 + 9 * k;
    ctx.fillStyle = "rgba(16,185,129,0.18)"; ctx.beginPath(); ctx.arc(sx, sy, halo, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = "#10b981"; ctx.strokeStyle = C.bg; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, 5.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    ctx.restore();

    // legend box (kept inside the canvas so exported PNGs are self-explanatory)
    ctx.font = `13px ${FONT}`;
    const items = [[C.T, L.EQ[tId].name], [C.P, L.EQ[pId].name], ["#10b981", `${fmt(Tc)} °C, ${fmt(Pc, 2)} kbar`]];
    const bw = Math.max(...items.map(([, t]) => ctx.measureText(t).width)) + 44, bh = items.length * 21 + 12, bx = W - m.r - bw - 10, by = m.t + 10;
    ctx.fillStyle = dark ? "rgba(28,28,26,0.9)" : "rgba(255,255,255,0.92)"; ctx.strokeStyle = C.grid;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, 8) : ctx.rect(bx, by, bw, bh); ctx.fill(); ctx.stroke();
    items.forEach(([c, t], i) => {
      const yy = by + 19 + i * 21;
      ctx.fillStyle = c;
      if (i < 2) ctx.fillRect(bx + 10, yy - 5, 18, 3); else { ctx.beginPath(); ctx.arc(bx + 19, yy - 3.5, 4.5, 0, 2 * Math.PI); ctx.fill(); }
      ctx.fillStyle = C.fg; ctx.fillText(t, bx + 36, yy);
    });
  }

  function drawEllipse(ctx, X, Y, mc, k, color) {
    const a = mc.T_C.sd ** 2, c = mc.P_kbar.sd ** 2, b = mc.cov;
    const tr = (a + c) / 2, det = Math.sqrt(((a - c) / 2) ** 2 + b * b);
    const l1 = tr + det, l2 = Math.max(0, tr - det), ang = Math.atan2(l1 - a, b || 1e-12);
    ctx.strokeStyle = color; ctx.setLineDash(k === 1 ? [] : [5, 4]); ctx.lineWidth = 1.2; ctx.beginPath();
    for (let i = 0; i <= 72; i++) {
      const th = (i / 72) * 2 * Math.PI, u = k * Math.sqrt(l1) * Math.cos(th), v = k * Math.sqrt(l2) * Math.sin(th);
      const t = mc.T_C.mean + u * Math.cos(ang) - v * Math.sin(ang), p = mc.P_kbar.mean + u * Math.sin(ang) + v * Math.cos(ang);
      i ? ctx.lineTo(X(t), Y(p)) : ctx.moveTo(X(t), Y(p));
    }
    ctx.stroke(); ctx.setLineDash([]);
  }

  // ------------------------------------------------------------------ structural formula
  function initFormula() {
    const sel = $("sfMineral");
    for (const k of Object.keys(L.MINERAL_BASIS)) sel.appendChild(el("option", { value: k, text: k }));
    const box = $("sfInputs"), vals = {};
    const grid = el("div", { class: "grid-2col compact-grid" });
    for (const o of L.MINERAL_OXIDES) {
      const inp = el("input", { type: "number", class: "text-input", step: "any", min: "0" });
      inp.addEventListener("input", () => { vals[o] = parseFloat(inp.value) || 0; run(); });
      grid.appendChild(el("div", { class: "form-group" }, [fieldLabel(o), inp]));
    }
    box.appendChild(grid);
    sel.addEventListener("change", run);
    function run() {
      const body = $("sfBody"); body.textContent = "";
      try {
        const r = L.structuralFormula(sel.value, vals);
        $("sfBasis").textContent = `${r.basis.nOx} O${r.basis.nCat ? `, ${r.basis.nCat} cations` : ""}`;
        const keys = ["Si", "Ti", "Al", "Cr", "Fe3", "Fe2", "Mn", "Mg", "Ca", "Na", "K"];
        const max = Math.max(1e-9, ...keys.map((k) => r.cat[k] || 0));
        for (const k of keys.concat("sum")) {
          const bar = k === "sum" || !(r.cat[k] > 0) ? null : el("div", { class: "apfu-bar", style: `width:${(100 * r.cat[k]) / max}%` });
          body.appendChild(el("tr", {}, [el("td", { text: k === "sum" ? "Σ cations" : k.replace(/^Fe(\d)$/, "Fe$1+") }), el("td", { text: fmt(r.cat[k], 3) }), el("td", {}, [bar])]));
        }
        $("sfNote").textContent = `Fe3+ method: ${r.fe3Method}. Observed cation sum before normalisation: ${fmt(r.observedSum, 3)}.`;
      } catch (e) { $("sfNote").textContent = e.message; }
    }
  }

  // ------------------------------------------------------------------ batch
  let batchRows = [];
  function initBatch() {
    const dz = $("csvDropzone"), fi = $("csvFileInput");
    dz.addEventListener("click", () => fi.click());
    dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fi.click(); });
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
    dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("drag"); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
    fi.addEventListener("change", () => fi.files[0] && readFile(fi.files[0]));
    $("batchTemplateBtn").addEventListener("click", () => {
      const cols = ["Sample", "P_kbar", "T_C"];
      for (const ph of ["Grt", "Bt", "Pl"]) for (const o of L.MINERAL_OXIDES) cols.push(`${ph}_${o}`);
      const p = PRESETS.pelite.sample;
      const row = ["pelite-1", 6, 650].concat(["Grt", "Bt", "Pl"].flatMap((ph) => L.MINERAL_OXIDES.map((o) => p[ph][o] || 0)));
      download("LithoPT_batch_template.csv", cols.join(",") + "\n" + row.join(",") + "\n", "text/csv");
    });
    $("batchExportBtn").addEventListener("click", () => {
      const cols = Object.keys(batchRows[0] || {});
      // quote where needed; text starting with = + - @ is prefixed so spreadsheets do not run it as a formula
      const esc = (v) => { let t = String(v); if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
      download("LithoPT_batch_results.csv", [cols.join(",")].concat(batchRows.map((r) => cols.map((c) => esc(r[c] ?? "")).join(","))).join("\n"), "text/csv");
    });
  }
  function parseCsv(text) {
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === "," || ch === ";" || ch === "\t") { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }
  function readFile(file) {
    const rd = new FileReader();
    rd.onload = () => runBatch(parseCsv(String(rd.result)));
    rd.readAsText(file);
  }
  function runBatch(rows) {
    const head = rows[0].map((h) => h.trim()), phases = Object.keys(PHASE_LABEL);
    const known = [], unknown = [];
    const map = head.map((h) => {
      if (/^sample/i.test(h)) return { k: "Sample" };
      if (h === "P_kbar" || h === "T_C") return { k: h };
      const [ph, ...rest] = h.split("_"), f = rest.join("_");
      if (phases.includes(ph) && PHASE_FIELDS(ph).includes(f)) { known.push(h); return { ph, f }; }
      unknown.push(h); return null;
    });
    batchRows = [];
    for (const r of rows.slice(1)) {
      const sample = {}, meta = { Sample: "", P_kbar: 0, T_C: 0 }, bad = [];
      map.forEach((m, i) => {
        if (!m) return;
        const v = (r[i] ?? "").trim();
        if (m.k) { meta[m.k] = m.k === "Sample" ? v : parseFloat(v); return; }
        const x = Number(v);
        if (v !== "" && !Number.isFinite(x)) { bad.push(head[i]); return; }
        if (v !== "") (sample[m.ph] = sample[m.ph] || (m.ph === "Trace" ? Object.assign({}, TRACE_DEFAULTS) : {}))[m.f] = x;
      });
      const out = { Sample: meta.Sample, P_kbar: meta.P_kbar, T_C: meta.T_C };
      if (bad.length) { out.Error = `non-numeric value in ${bad.join(", ")}; row skipped`; batchRows.push(out); continue; }
      let s;
      try { s = L.prepare(sample); } catch (e) { out.Error = e.message; batchRows.push(out); continue; }
      for (const e of L.EQUATIONS) {
        if (!L.SYSTEMS[e.system].phases.every((ph) => sample[ph])) continue;
        let v;
        try { v = L.evaluate(e.id, s, { P_kbar: meta.P_kbar, T_K: meta.T_C + 273.15, opt: state.opt }); } catch (err) { v = NaN; }
        const unit = e.kind === "T" ? "T_C" : e.kind === "P" ? "P_kbar" : e.kind === "H2O" ? "H2O_wt" : "dFMQ";
        out[`${e.id} [${unit}]`] = Number.isFinite(v) && L.plausible(e.id, v) ? +(e.kind === "T" ? v - 273.15 : v).toFixed(3) : "";
      }
      for (const t of L.equilibriumTests(s)) out[t.name] = `${t.value.toFixed(3)} (${t.pass ? "pass" : "fail"})`;
      batchRows.push(out);
    }
    const st = $("batchStatus");
    st.hidden = false;
    const missingCond = ["P_kbar", "T_C"].filter((k) => !head.includes(k));
    st.textContent = `${batchRows.length} samples processed. Recognised columns: ${known.length}. Ignored columns: ${unknown.length ? unknown.join(", ") : "none"}.` +
      (missingCond.length ? ` Warning: no ${missingCond.join(" or ")} column — thermometers were evaluated at 0 kbar and barometers at 0 °C; add the column(s) to use real conditions.` : "") +
      " Physically implausible values are left blank.";
    const cols = [...new Set(batchRows.flatMap((r) => Object.keys(r)))];
    const thead = $("batchTable").tHead, tbody = $("batchTable").tBodies[0];
    thead.textContent = ""; tbody.textContent = "";
    thead.appendChild(el("tr", {}, cols.map((c) => el("th", { text: c }))));
    for (const r of batchRows) tbody.appendChild(el("tr", {}, cols.map((c) => el("td", { text: String(r[c] ?? "") }))));
    $("batchExportBtn").disabled = batchRows.length === 0;
  }

  // ------------------------------------------------------------------ catalogue
  function initCatalog() {
    const body = $("catalogBody");
    const render = (q) => {
      body.textContent = "";
      let shown = 0;
      for (const e of L.EQUATIONS) {
        const txt = `${e.name} ${L.SYSTEMS[e.system].name} ${e.range}`.toLowerCase();
        if (q && !txt.includes(q)) continue;
        shown++;
        body.appendChild(el("tr", {}, [el("td", { text: L.SYSTEMS[e.system].name }), el("td", {}, [el("span", { class: "eq-name" }, [el("span", { class: `kind-dot kind-${e.kind}` }), KIND_NAME[e.kind]])]),
          el("td", { text: e.name }), el("td", { text: e.see }), el("td", { text: e.range }), el("td", { text: SRC_BADGE[e.src][1] }),
          el("td", { text: (() => { const k = Object.entries(L.DOMAINS() || {}).find(([, d]) => d.equations.includes(e.id)); return k ? `${k[1].label} (n = ${k[1].n})` : "—"; })() }),
          el("td", {}, [e.doi ? el("a", { href: "https://doi.org/" + e.doi, target: "_blank", rel: "noopener noreferrer", text: e.doi }) : el("span", { text: e.ref || "" })])]));
      }
      $("catalogCount").textContent = shown === L.EQUATIONS.length ? String(shown) : `${shown} of ${L.EQUATIONS.length}`;
    };
    $("catalogSearch").addEventListener("input", (ev) => render(ev.target.value.toLowerCase()));
    render("");
  }

  // ------------------------------------------------------------------ dialogs (share, feedback)
  const enc = encodeURIComponent;
  const appUrl = () => `${location.origin}${location.pathname}`;
  const stateUrl = () => `${appUrl()}#state=${enc(JSON.stringify(snapshot()))}`;
  const icon = (id) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("class", "ico"); s.innerHTML = `<use href="#${id}"/>`; return s; };
  function copyText(text, btn) {
    const done = () => {
      toast("Copied to the clipboard");
      if (!btn) return;
      const lab = btn.querySelector("span"), old = lab && lab.textContent;
      btn.classList.add("copied"); if (lab) lab.textContent = "Copied";
      setTimeout(() => { btn.classList.remove("copied"); if (lab) lab.textContent = old; }, 1600);
    };
    return (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(done, () => prompt("Copy this text:", text));
  }
  function openDialog(d) { d.classList.remove("closing"); if (!d.open) d.showModal(); }
  function closeDialog(d) {
    if (REDUCED) { d.close(); return; }
    d.classList.add("closing");
    setTimeout(() => { d.classList.remove("closing"); d.close(); }, 180);
  }
  function initDialogs() {
    for (const d of document.querySelectorAll("dialog.modal")) {
      d.addEventListener("click", (ev) => { if (ev.target === d) closeDialog(d); }); // backdrop click
      d.addEventListener("cancel", (ev) => { ev.preventDefault(); closeDialog(d); }); // Esc, animated
      d.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeDialog(d)));
      d.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copyText($(b.dataset.copy).value, b)));
    }
    document.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => {
      const d = $(b.dataset.open);
      if (d.id === "feedbackDialog") refreshFeedback();
      openDialog(d);
    }));
  }

  function phasesEntered() { return L.SYSTEMS[state.system].phases.filter((ph) => state.sample[ph] && Object.values(state.sample[ph]).some((v) => v > 0)); }
  function summaryText() {
    const sys = L.SYSTEMS[state.system];
    const lines = [`LithoPT v${L.VERSION} · ${sys.name}`,
      `Evaluated with P = ${state.P ?? 0} kbar (thermometers) and T = ${state.T ?? 0} °C (barometers)`,
      `Phases: ${phasesEntered().map((ph) => PHASE_LABEL[ph]).join(", ") || "none entered"}`, "",
      "Results (published SEE; calibration domain):"];
    for (const r of lastRows) lines.push(`• ${r.e.name}: ${r.txt}${r.note ? ` (${r.note})` : ` (SEE ${r.e.see}${r.a ? `; ${r.a.status}` : ""})`}`);
    const t = lastPt && lastPt.det.converged ? lastPt : null;
    if (t) {
      lines.push("", `P–T solution, ${L.EQ[t.tId].name} + ${L.EQ[t.pId].name}: ${fmt(t.det.T_K - 273.15)} °C, ${fmt(t.det.P_kbar, 2)} kbar`);
      if (t.mc && t.mc.T_C) lines.push(`Monte Carlo (N = ${t.mc.N}): T ${fmt(t.mc.T_C.median)} ± ${fmt(t.mc.T_C.sd)} °C, P ${fmt(t.mc.P_kbar.median, 2)} ± ${fmt(t.mc.P_kbar.sd, 2)} kbar, ρ = ${fmt(t.mc.rho, 3)}`);
    }
    const ens = lastEns && (L.DOMAINS() ? lastEns.summaryInDomain : lastEns.summary);
    if (ens) lines.push(`Model ensemble, ${L.DOMAINS() ? "pairs not outside a calibration domain" : "all pairs"} (n = ${ens.n}): T ${fmt(ens.T_C.median)} ± ${fmt(ens.T_C.sd)} °C, P ${fmt(ens.P_kbar.median, 2)} ± ${fmt(ens.P_kbar.sd, 2)} kbar`);
    return lines.join("\n");
  }
  function citationText() {
    const used = lastRows.filter((r) => !r.note).map((r) => r.e);
    if (lastPt && lastPt.det.converged) used.push(L.EQ[lastPt.tId], L.EQ[lastPt.pId]);
    const bySource = new Map(); // one line per paper, listing the equations taken from it
    for (const e of used) {
      const k = e.doi ? `https://doi.org/${e.doi}` : e.ref || e.name;
      if (!bySource.has(k)) bySource.set(k, new Set());
      bySource.get(k).add(e.name);
    }
    const lines = [`Tiwari, K. (2026). LithoPT v${L.VERSION}: browser-based thermobarometry [software]. ${appUrl()}`, "",
      "Original calibrations used (cite each):", ...[...bySource].map(([k, n]) => `• ${[...n].join("; ")}: ${k}`)];
    return lines.join("\n");
  }
  function initShare() {
    $("shareBtn").addEventListener("click", () => {
      const url = stateUrl(), sum = summaryText(), sys = L.SYSTEMS[state.system].name;
      $("shareStateUrl").value = url; $("shareAppUrl").value = appUrl();
      $("shareStateInfo").textContent = `${L.SYSTEMS[state.system].phases.length} phases · ${(url.length / 1024).toFixed(1)} kB`;
      $("shareSummary").value = sum; $("shareCite").value = citationText();
      const t = lastPt && lastPt.det.converged ? ` — ${fmt(lastPt.det.T_K - 273.15, 0)} °C, ${fmt(lastPt.det.P_kbar, 1)} kbar` : "";
      const short = `Thermobarometry with LithoPT: ${sys}${t}`;
      const via = $("shareVia"); via.textContent = "";
      for (const [name, ic, cls, href] of [
        ["Email", "i-mail", "sv-mail", `mailto:?subject=${enc(`LithoPT: ${sys}`)}&body=${enc(`${sum}\n\nOpen this calculation: ${url}`)}`],
        ["WhatsApp", "i-chat", "sv-wa", `https://api.whatsapp.com/send?text=${enc(`${short}\n${url}`)}`],
        ["Telegram", "i-send", "sv-tg", `https://t.me/share/url?url=${enc(url)}&text=${enc(short)}`],
        ["X", "i-x", "sv-x", `https://twitter.com/intent/tweet?text=${enc(short)}&url=${enc(url)}`],
        ["LinkedIn", "i-share", "sv-li", `https://www.linkedin.com/sharing/share-offsite/?url=${enc(appUrl())}`]])
        via.appendChild(el("a", { class: `share-tile ${cls}`, href, target: "_blank", rel: "noopener noreferrer" }, [icon(ic), el("span", { text: name })]));
      openDialog($("shareDialog"));
    });
    const ns = $("nativeShareBtn");
    ns.hidden = typeof navigator.share !== "function";
    ns.addEventListener("click", () => navigator.share({ title: "LithoPT calculation", text: $("shareSummary").value, url: $("shareStateUrl").value }).catch(() => {}));
    $("shareSummaryDl").addEventListener("click", () => download("LithoPT_summary.txt", `${$("shareSummary").value}\n\nOpen this calculation: ${$("shareStateUrl").value}\n\nHow to cite:\n${$("shareCite").value}\n`, "text/plain"));
  }

  // Feedback: LithoPT has no server, so the report goes out through the user's own mail program (or copy/download).
  const DEV_EMAIL = "kishantiwari@iitkgp.ac.in";
  const FB_CATS = [
    ["bug", "Bug or error", "i-bug", "What did you do, what did you expect, and what happened instead? Include any error message."],
    ["result", "Questionable result", "i-target", "Which value looks wrong, and what did you expect (e.g. from the paper or another program)?"],
    ["equation", "Request an equation", "i-bulb", "Which calibration (author, year, DOI) should LithoPT add, and for which rocks?"],
    ["data", "Calibration & data", "i-db", "Calibration ranges, domain checks, examples or reference data."],
    ["ux", "Interface & usability", "i-palette", "What was hard to find or use? What would make it easier?"],
    ["other", "General comment", "i-chat", "Anything else you would like to tell us."]];
  const RATING = ["", "Not useful yet", "Somewhat useful", "Useful", "Very useful", "Essential for my work"];
  const fb = { rating: 0, cat: "bug" };
  const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: history not kept */ } } };
  function feedbackReport() {
    const cat = FB_CATS.find((c) => c[0] === fb.cat);
    const lines = [`LithoPT feedback — ${cat[1]}`, `Rating: ${fb.rating ? `${"★".repeat(fb.rating)}${"☆".repeat(5 - fb.rating)} (${fb.rating}/5, ${RATING[fb.rating]})` : "not given"}`];
    if ($("fbName").value.trim()) lines.push(`Name: ${$("fbName").value.trim()}`);
    if ($("fbEmail").value.trim()) lines.push(`Reply to: ${$("fbEmail").value.trim()}`);
    if (!$("fbEqBlock").hidden && $("fbEq").value) lines.push(`Equation: ${L.EQ[$("fbEq").value].name} (${$("fbEq").value})`);
    lines.push("", $("fbMsg").value.trim() || "(no message yet)");
    if ($("fbAttach").checked) lines.push("", "--- Current calculation ---", summaryText(), "", "State (paste into a .json file and use Load JSON):", JSON.stringify(snapshot()));
    if ($("fbEnv").checked) lines.push("", "--- Environment ---", `LithoPT v${L.VERSION}, ${L.EQUATIONS.length} equations`, `Browser: ${navigator.userAgent}`,
      `Screen ${screen.width}×${screen.height}, window ${innerWidth}×${innerHeight}, language ${navigator.language}, theme ${isDark() ? "dark" : "light"}`, `Sent ${new Date().toISOString()}`);
    return lines.join("\n");
  }
  function refreshFeedback() {
    $("fbStars").querySelectorAll("button").forEach((b, i) => b.classList.toggle("on", i < fb.rating));
    $("fbStars").dataset.label = RATING[fb.rating] || "Tap a star";
    $("fbCats").querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", b.dataset.cat === fb.cat));
    const cat = FB_CATS.find((c) => c[0] === fb.cat);
    $("fbMsg").placeholder = cat[3];
    $("fbEqBlock").hidden = !(fb.cat === "result" || fb.cat === "data");
    $("fbCount").textContent = `${$("fbMsg").value.length} / 3000`;
    $("fbPreview").textContent = feedbackReport();
    $("fbHistoryLabel").textContent = `History (${store.get("lithopt-feedback", []).length})`;
  }
  function initFeedback() {
    for (let i = 1; i <= 5; i++) {
      const b = el("button", { type: "button", role: "radio", "aria-label": `${i} of 5: ${RATING[i]}`, title: RATING[i] }, [icon("i-star")]);
      b.addEventListener("click", () => { fb.rating = i; refreshFeedback(); });
      $("fbStars").appendChild(b);
    }
    for (const [k, label, ic] of FB_CATS) {
      const b = el("button", { type: "button", class: "chip", role: "radio", "data-cat": k }, [icon(ic), el("span", { text: label })]);
      b.addEventListener("click", () => { fb.cat = k; refreshFeedback(); });
      $("fbCats").appendChild(b);
    }
    for (const e of L.EQUATIONS) $("fbEq").appendChild(el("option", { value: e.id, text: `${L.SYSTEMS[e.system].name}: ${e.name}` }));
    for (const id of ["fbMsg", "fbName", "fbEmail", "fbEq", "fbAttach", "fbEnv"]) $(id).addEventListener("input", refreshFeedback);
    $("fbCopy").addEventListener("click", () => copyText(feedbackReport(), $("fbCopy")));
    $("fbDownload").addEventListener("click", () => download("LithoPT_feedback.txt", feedbackReport(), "text/plain"));
    $("fbForm").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const msg = $("fbMsg"), mail = $("fbEmail");
      if (!msg.value.trim()) { msg.focus(); msg.classList.add("shake"); setTimeout(() => msg.classList.remove("shake"), 500); toast("Please describe your feedback first"); return; }
      if (!mail.checkValidity()) { mail.focus(); toast("The email address does not look valid"); return; }
      const cat = FB_CATS.find((c) => c[0] === fb.cat)[1], report = feedbackReport();
      const subject = `LithoPT feedback: ${cat}${fb.rating ? ` (${fb.rating}/5)` : ""}`;
      let body = report;
      // Mail programs truncate long mailto links; send the message itself and put the full report on the clipboard.
      if (enc(body).length > 1800) {
        body = `${$("fbMsg").value.trim()}\n\n[The full report, including the calculation, has been copied to your clipboard. Please paste it below.]\n\n`;
        copyText(report);
      }
      location.href = `mailto:${DEV_EMAIL}?subject=${enc(subject)}&body=${enc(body)}`;
      const hist = store.get("lithopt-feedback", []);
      hist.unshift({ date: new Date().toISOString(), cat, rating: fb.rating, message: $("fbMsg").value.trim() });
      store.set("lithopt-feedback", hist.slice(0, 20));
      msg.value = ""; refreshFeedback();
      toast("Your mail program should open with the report — press Send there");
    });
    $("fbHistoryBtn").addEventListener("click", () => {
      const box = $("fbHistory"), show = box.hidden;
      box.hidden = !show; $("fbForm").hidden = show;
      $("fbHistoryBtn").classList.toggle("active", show);
      box.textContent = "";
      const hist = store.get("lithopt-feedback", []);
      if (!hist.length) box.appendChild(el("p", { class: "empty-note", text: "No feedback sent from this browser yet." }));
      for (const h of hist) box.appendChild(el("div", { class: "hist-item" }, [
        el("div", { class: "hist-head" }, [el("span", { class: "badge badge-info", text: h.cat }), el("span", { class: "hist-stars", text: h.rating ? "★".repeat(h.rating) + "☆".repeat(5 - h.rating) : "" }),
          el("span", { class: "form-hint", text: new Date(h.date).toLocaleString() })]),
        el("p", { text: h.message })]));
    });
    refreshFeedback();
  }

  // ------------------------------------------------------------------ manual & glossary (generated by docs/build_manual.py)
  function loadDoc(url, box, onLoad) {
    return fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return url.endsWith(".json") ? r.json() : r.text(); }).then(onLoad).catch(() => {
      box.textContent = "";
      box.append(el("p", { class: "alert-box alert-info", text: "This view needs LithoPT to be served over http(s) (e.g. python -m http.server) or the hosted site. The PDF manual always works: " }),
        el("a", { class: "btn btn-primary btn-sm", href: "docs/LithoPT_User_Manual.pdf", target: "_blank", rel: "noopener" }, [icon("i-doc"), el("span", { text: "Open the PDF manual" })]));
    });
  }
  function scrollToEl(t) {
    t.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
    t.classList.remove("hit-flash"); void t.offsetWidth; t.classList.add("hit-flash");
  }
  function initManual() {
    let loaded = false;
    const body = $("manualBody"), toc = $("manualToc");
    const load = () => {
      if (loaded) return; loaded = true;
      loadDoc("docs/manual.html", body, (html) => {
        body.innerHTML = html; // our own generated file, same origin
        const chapters = [...body.querySelectorAll("h2")];
        const links = new Map();
        for (const h of chapters) {
          const subs = [];
          for (let n = h.nextElementSibling; n && n.tagName !== "H2"; n = n.nextElementSibling) if (n.tagName === "H3") subs.push(n);
          const a = el("a", { href: `#${h.id}`, class: "toc-l1", text: h.textContent });
          const sub = el("div", { class: "toc-sub" }, subs.map((s) => { const x = el("a", { href: `#${s.id}`, class: "toc-l2", text: s.textContent }); links.set(s, x); return x; }));
          links.set(h, a);
          toc.appendChild(el("div", { class: "toc-group" }, [a, subs.length ? sub : null]));
        }
        toc.addEventListener("click", (ev) => {
          const a = ev.target.closest("a"); if (!a) return;
          ev.preventDefault(); setToc(false); scrollToEl(document.getElementById(a.getAttribute("href").slice(1)));
        });
        // highlight the section being read
        const io = new IntersectionObserver((ents) => {
          for (const en of ents) if (en.isIntersecting) {
            toc.querySelectorAll(".current").forEach((x) => x.classList.remove("current"));
            const a = links.get(en.target); if (!a) continue;
            a.classList.add("current");
            const grp = a.closest(".toc-group"); grp.querySelector(".toc-l1").classList.add("current");
            toc.querySelectorAll(".toc-group.open").forEach((g) => g !== grp && g.classList.remove("open"));
            grp.classList.add("open");
          }
        }, { rootMargin: "-80px 0px -70% 0px" });
        links.forEach((_, h) => io.observe(h));
      });
    };
    document.querySelector('.tab-btn[data-tab="tab-manual"]').addEventListener("click", load);
    // on narrow screens the contents list is collapsed behind a button
    const setToc = (open) => { $("manualTocToggle").setAttribute("aria-expanded", open); document.querySelector(".manual-toc").classList.toggle("toc-open", open); };
    $("manualTocToggle").addEventListener("click", () => setToc($("manualTocToggle").getAttribute("aria-expanded") !== "true"));
    // search: list matching passages; click to jump
    let timer;
    $("manualSearch").addEventListener("input", (ev) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = ev.target.value.trim().toLowerCase(), hits = $("manualHits");
        toc.querySelectorAll(".search-hit").forEach((x) => x.remove());
        toc.classList.toggle("searching", q.length >= 2);
        hits.textContent = "";
        if (q.length < 2) return;
        const found = [...body.querySelectorAll("p, li, td, h2, h3, h4, .m-eq")].filter((n) => n.textContent.toLowerCase().includes(q));
        hits.textContent = found.length ? `${found.length} passage${found.length > 1 ? "s" : ""} found${found.length > 40 ? " (first 40 shown)" : ""}` : "No matches";
        for (const n of found.slice(0, 40)) {
          const t = n.textContent, i = t.toLowerCase().indexOf(q), from = Math.max(0, i - 40);
          let h = n; while (h && !/^H[234]$/.test(h.tagName)) h = h.previousElementSibling || h.parentElement;
          const a = el("a", { href: "#", class: "search-hit" }, [el("small", { text: h && h !== n ? h.textContent : "" }),
            el("span", {}, [(from ? "…" : "") + t.slice(from, i), el("mark", { text: t.slice(i, i + q.length) }), t.slice(i + q.length, i + q.length + 60) + "…"])]);
          a.addEventListener("click", (e2) => { e2.preventDefault(); scrollToEl(n.closest("tr") || n); });
          toc.appendChild(a);
        }
      }, 150);
    });
    const top = $("manualTop");
    addEventListener("scroll", () => top.classList.toggle("show", scrollY > 900 && $("tab-manual").classList.contains("active")), { passive: true });
    top.addEventListener("click", () => scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" }));
  }
  function initGlossary() {
    let items = null;
    const list = $("glossaryList");
    const render = () => {
      const q = $("glossarySearch").value.trim().toLowerCase();
      const plain = (h) => { const d = document.createElement("div"); d.innerHTML = h; return d.textContent; };
      const shown = items.filter((g) => !q || (plain(g.term) + " " + plain(g.text)).toLowerCase().includes(q));
      list.textContent = "";
      $("glossaryCount").textContent = shown.length === items.length ? String(items.length) : `${shown.length} of ${items.length}`;
      const letters = new Set();
      shown.forEach((g, i) => {
        const L0 = plain(g.term).trim()[0].toUpperCase();
        const card = el("div", { class: "gl-card", style: `animation-delay:${Math.min(i, 20) * 18}ms` });
        if (!letters.has(L0)) { letters.add(L0); card.id = `gl-${L0}`; }
        const dt = el("h3"); dt.innerHTML = g.term; const dd = el("p"); dd.innerHTML = g.text; // generated, same-origin content
        card.append(dt, dd); list.appendChild(card);
      });
      if (!shown.length) list.appendChild(el("p", { class: "empty-note", text: "No term matches your search." }));
      const bar = $("glossaryLetters"); bar.textContent = "";
      for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
        const b = el("button", { type: "button", text: c });
        if (!letters.has(c)) b.disabled = true;
        b.addEventListener("click", () => scrollToEl($(`gl-${c}`)));
        bar.appendChild(b);
      }
    };
    document.querySelector('.tab-btn[data-tab="tab-glossary"]').addEventListener("click", () => {
      if (items) return;
      items = [];
      loadDoc("docs/glossary.json", list, (data) => { items = data.sort((a, b) => a.term.localeCompare(b.term)); render(); });
    });
    $("glossarySearch").addEventListener("input", () => items && items.length && render());
  }

  // ------------------------------------------------------------------ state I/O
  function download(name, text, type) {
    const a = el("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }
  function snapshot() { return { lithopt: L.VERSION, system: state.system, P: state.P, T: state.T, opt: state.opt, sample: state.sample, pt: [$("ptThermo").value, $("ptBaro").value] }; }
  function restore(obj) {
    if (!obj || !L.SYSTEMS[obj.system]) throw new Error("Not a LithoPT state");
    const clean = {};
    for (const [ph, comp] of Object.entries(obj.sample || {})) {
      if (!PHASE_LABEL[ph] || typeof comp !== "object") continue;
      clean[ph] = {};
      for (const f of PHASE_FIELDS(ph)) if (Number.isFinite(comp[f])) clean[ph][f] = comp[f];
    }
    // options come from untrusted links/files: accept only known keys with the expected type
    const o = obj.opt && typeof obj.opt === "object" ? obj.opt : {}, opt = { gammaGrs: 1, gammaAn: 1, cpxFe2: "total" };
    for (const k of ["gammaGrs", "gammaAn", "niOl"]) if (Number.isFinite(o[k]) && o[k] > 0) opt[k] = o[k];
    if (o.cpxFe2 === "lindsley") opt.cpxFe2 = "lindsley";
    Object.assign(state, { system: obj.system, P: Number.isFinite(+obj.P) ? +obj.P : 0, T: Number.isFinite(+obj.T) ? +obj.T : 0, sample: clean, opt });
    $("systemSelect").value = state.system; $("condP").value = state.P; $("condT").value = state.T;
    renderPhaseInputs();
    if (obj.pt) { refreshPtSelects(); if (L.EQ[obj.pt[0]]) $("ptThermo").value = obj.pt[0]; if (L.EQ[obj.pt[1]]) $("ptBaro").value = obj.pt[1]; }
  }
  function loadPreset(key) {
    const p = PRESETS[key];
    restore({ system: p.system, P: p.P, T: p.T, sample: JSON.parse(JSON.stringify(p.sample)), pt: p.pt });
    toast(`Loaded: ${p.label}`);
  }

  // ------------------------------------------------------------------ init
  document.addEventListener("DOMContentLoaded", () => {
    $("versionLabel").textContent = `v${L.VERSION} · ${L.EQUATIONS.length} equations`;
    window.LithoPTApp = { snapshot }; // read-only hook used by the end-to-end tests
    document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-selected", x === b); });
      document.querySelectorAll(".tab-content").forEach((p) => p.classList.toggle("active", p.id === b.dataset.tab));
      const tt = document.querySelector(".topbar-title");
      $("pageTitle").textContent = b.dataset.title; $("pageSub").textContent = b.dataset.sub;
      tt.classList.remove("swap"); void tt.offsetWidth; tt.classList.add("swap"); // restart the title animation
      if (b.dataset.tab === "tab-pt") drawPt();
      if (scrollY > 0) scrollTo(0, 0); // each tab starts at its top, important on phones
    }));
    $("themeToggleBtn").addEventListener("click", () => {
      const t = isDark() ? "light" : "dark";
      document.documentElement.dataset.theme = t;
      try { localStorage.setItem("lithopt-theme", t); } catch (e) { /* storage unavailable: theme lasts for this page only */ }
      drawPt();
    });
    const ps = $("presetSelect");
    for (const [k, p] of Object.entries(PRESETS)) ps.appendChild(el("option", { value: k, text: p.label }));
    ps.addEventListener("change", () => ps.value && loadPreset(ps.value));
    buildSystemSelect();
    initFormula(); initBatch(); initCatalog();
    $("runPtBtn").addEventListener("click", () => busy($("runPtBtn"), runPt));
    $("runEnsBtn").addEventListener("click", () => busy($("runEnsBtn"), runEnsemble));
    for (const [k, m] of Object.entries(L.DEPTH_MODELS)) $("depthModel").appendChild(el("option", { value: k, text: m.name }));
    for (const [k, sys] of Object.entries(L.SYSTEMS)) $("ensSystems").appendChild(el("option", { value: k, text: sys.name }));
    $("exportPngBtn").addEventListener("click", () => { const a = el("a", { href: $("ptCanvas").toDataURL("image/png"), download: "LithoPT_PT.png" }); document.body.appendChild(a); a.click(); a.remove(); });
    initDialogs(); initShare(); initFeedback(); initManual(); initGlossary();
    $("saveJsonBtn").addEventListener("click", () => download("LithoPT_state.json", JSON.stringify(snapshot(), null, 2), "application/json"));
    $("loadJsonInput").addEventListener("change", (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      f.text().then((t) => { try { restore(JSON.parse(t)); toast("State loaded"); } catch (e) { toast("Could not read file: " + e.message); } });
    });
    const fromHash = () => {
      const h = location.hash.match(/^#state=(.*)$/);
      if (!h) return false;
      try { restore(JSON.parse(decodeURIComponent(h[1]))); toast("Calculation restored from link"); } catch (e) { toast("Link could not be read"); }
      return true;
    };
    if (!fromHash()) loadPreset("pelite");
    // first-run guide: shown until dismissed (remembered per browser)
    const guide = $("firstRun"), seen = () => { try { return localStorage.getItem("lithopt-guide") === "1"; } catch (e) { return false; } };
    const hideGuide = () => { guide.hidden = true; try { localStorage.setItem("lithopt-guide", "1"); } catch (e) { /* not remembered */ } };
    guide.hidden = seen();
    $("guideDismiss").addEventListener("click", hideGuide);
    $("guideExample").addEventListener("click", () => { ps.value = "basalt"; loadPreset("basalt"); $("systemSelect").focus(); });
    window.addEventListener("hashchange", fromHash); // links opened while the app is already open
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
  });
})();
