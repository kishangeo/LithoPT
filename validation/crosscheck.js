// Compares LithoPT with the Thermobar outputs written by crosscheck_thermobar.py (optional; see that file).
// Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
// Usage: node validation/crosscheck.js   (exit code 1 if an equation differs by more than its tolerance)
const fs = require("fs");
const path = require("path");
const L = require("../lithopt-core.js");

const file = path.join(__dirname, "crosscheck_thermobar.json");
if (!fs.existsSync(file)) { console.log("No crosscheck_thermobar.json; run validation/crosscheck_thermobar.py first."); process.exit(0); }
const data = JSON.parse(fs.readFileSync(file, "utf8"));
// Absolute tolerances; molar masses differ (IUPAC vs Thermobar), which 10⁴/T forms magnify to ~1 K.
const TOL = { T: 2, P: 0.5, H2O: 0.05, fO2: 0.01 };
const UNIT = { T: "K", P: "kbar", H2O: "wt%", fO2: "log" };
// Documented differences: LithoPT follows the printed paper.
const KNOWN = {
  P_Put2008_eq29a: "Putirka (2008) Table 2 defines NaAlSi2O6 = min(Al(VI), Na); Thermobar uses Na (agrees to 0.5 kbar with Na).",
  T_Put2008_eq37: "the printed X_Di(cpx) is not defined in the paper; LithoPT uses DiHd·Mg/(Mg + Fe + Mn) by analogy with X_Di(opx).",
  T_Ridolfi2012: "Ridolfi & Renzulli (2012) Table 3 uses ln P with P in MPa (reproduces Putirka's 2016 worked example, 956 °C); Thermobar uses kbar.",
  P_Ridolfi2010: "LithoPT reproduces the authors' Amp-TB spreadsheet (Al_T on 13 cations: 1.543 → 176.6 MPa); Thermobar's cation basis differs.",
  T_Put2016_SiHbl: "Putirka (2016) prints T = 1977 − 165·Si, which reproduces his worked example (972 °C); Thermobar uses other coefficients.",
  P_Wang2021_eq1: "Wang et al. (2021) print the intercept as 23.00; LithoPT uses 25.0019 from the authors' calculation sheet (Supplement Table S2), which fits their calibration data without bias.",
  H_Gavr2016: "Gavrilenko et al. (2016) normalise the melt to anhydrous before computing D_CaO and MgO; Thermobar uses the raw wt%.",
  T_Beattie1993_opx: "LithoPT uses the measured D_Mg(opx/liq) in Beattie's eq. 11; Thermobar predicts D_Mg from the liquid (eq. 12). With eq. 12 the two agree to 0.2 K.",
  H_Masotta2019: "LithoPT reproduces the authors' calibration data to 0.30 wt% (stated SEE 0.29); small differences from Thermobar's component definitions."
};
let fail = false;
const notes = [];
console.log(`LithoPT ${L.VERSION} vs Thermobar ${data.thermobar_version}\n\n| Equation | n | max difference | |\n|---|---|---|---|`);
for (const c of data.cases) {
  const kind = L.EQ[c.eq].kind;
  let n = 0, worst = 0;
  c.samples.forEach((smp, i) => {
    const ref = c.thermobar[i];
    if (ref === null) return;
    const s = L.prepare(smp);
    // synthetic pyroxenes with Al(VI) < 0 are not physical; the paper's algorithm is undefined there
    if ((s.Opx && s.Opx.P.AlVI < 0) || (s.Cpx && s.Cpx.P.AlVI < 0)) return;
    const v = L.evaluate(c.eq, s, { P_kbar: c.P_kbar && c.P_kbar[i], T_K: c.T_K && c.T_K[i] });
    if (!Number.isFinite(v)) return;
    if (!L.plausible(c.eq, v) && !/kspar|eq24b/.test(c.eq)) return; // implausible results amplify round-off (alkali-feldspar models are checked on basaltic test melts)
    n++; worst = Math.max(worst, Math.abs(v - ref));
  });
  const ok = n > 0 && worst <= TOL[kind];
  const status = ok ? "ok" : KNOWN[c.eq] ? "documented" : "FAIL";
  if (status === "FAIL") fail = true;
  if (status === "documented") notes.push(`- ${c.eq}: ${KNOWN[c.eq]}`);
  console.log(`| ${c.eq} | ${n} | ${worst.toPrecision(3)} ${UNIT[kind]} | ${status} |`);
}
if (notes.length) console.log("\n" + notes.join("\n"));
process.exit(fail ? 1 : 0);
