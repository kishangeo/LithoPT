# LithoPT

Browser-based thermobarometry with source-verified equations, calibration-domain checks and correlated P–T uncertainty.

*Author: Kishan Tiwari, Department of Geology and Geophysics, IIT Kharagpur (kishantiwari@iitkgp.ac.in, ORCID [0000-0003-0014-914X](https://orcid.org/0000-0003-0014-914X))*

**Web app: https://lithopt.vercel.app/** · [![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.24341232.svg)](https://doi.org/10.5281/zenodo.24341232)

[![tests](https://github.com/kishangeo/LithoPT/actions/workflows/ci.yml/badge.svg)](https://github.com/kishangeo/LithoPT/actions/workflows/ci.yml) ![licence: MIT](https://img.shields.io/badge/licence-MIT-blue)

LithoPT is an open-source thermobarometry program that runs entirely in the web browser. It takes oxide analyses (wt%) of coexisting phases and computes:

- temperatures, pressures, melt water contents and oxygen fugacity from 109 published equations in 18 equilibrium systems: mineral–mineral exchange and net-transfer equilibria (garnet–biotite, garnet–pyroxene, GASP, two-pyroxene, olivine–spinel), mineral–melt and melt-only equations (clinopyroxene, orthopyroxene, olivine, plagioclase, alkali feldspar), amphibole thermobarometers, two-feldspar, trace-element and Ni-in-garnet thermometers;
- Fe–Mg equilibrium tests for mineral–melt pairs and a calibration-domain check that flags analyses unlike an equation's calibration data;
- intersections of any compatible thermometer–barometer pair;
- model-choice uncertainty from all compatible thermometer × barometer pairs;
- Monte Carlo propagation of analytical (and, optionally, calibration) uncertainty, done at the oxide level;
- pressure-to-depth conversion for a constant density;
- structural formulae with Droop (1987) Fe³⁺ estimation;
- batch processing of CSV files.

Every equation is implemented directly from its original publication and checked against the printed equation, including variable definitions and units. LithoPT contains no third-party thermobarometry code or data; molar masses are computed from IUPAC standard atomic weights. Where a paper and its authors' spreadsheet disagree, the choice made is recorded in `validation/CROSSCHECK.md`.

No data leave the browser, and after the first visit the app also works offline.

## Layout

| File | Purpose |
|---|---|
| `lithopt-core.js` | Calculation engine without any DOM code (stoichiometry, mineral components, equation registry, solver, Monte Carlo, ensembles). Works in browsers and in Node.js. |
| `lithopt-report.js` | Interpretation report: turns a calculation into a Markdown/HTML report (no DOM code; also runs in Node.js) |
| `app.js`, `index.html`, `styles.css` | User interface |
| `sw.js`, `manifest.webmanifest` | Offline cache and home-screen installation |
| `lithopt-domains.js`, `validation/make_domains.py` | Calibration-domain summaries (means, inverse covariances, D² percentiles; no experimental data) and the script that derives them from a published calibration dataset |
| `paper/evaluate.js` | Computes every number reported in the accompanying paper (`paper/results.json`) |
| `docs/` | User manual (PDF) and its builder, which also writes the in-app manual and glossary |
| `test/core.test.js` | Unit tests: each equation against its printed form, Droop Fe³⁺, the solver and Monte Carlo reproducibility |
| `test/fuzz.js`, `test/e2e/` | Robustness test; browser tests (Playwright) that compare displayed values with the engine |
| `validation/crosscheck_thermobar.py`, `validation/crosscheck.js` | Optional: compares LithoPT with Thermobar run locally as an independent reference, on synthetic compositions only |

The calibration-domain check (shrinkage Mahalanobis D² of an analysis from an equation's calibration data) is built into the engine and is active for every equation with a summary in `lithopt-domains.js`; version 4.0 ships the summary for the Neave & Putirka (2017) barometer.

## Five-minute tutorial

1. Open the app. On first use a three-step guide appears; *Try an example* loads a clinopyroxene–liquid pair.
2. Choose an *Equilibrium system*. The line below it says which phases you need.
3. Type or paste oxide analyses (wt%). Every equation of the system is evaluated as you type, with its stated error, equilibrium tests and calibration-domain status.
4. Open *P–T & Monte Carlo*, pick one thermometer and one barometer, and press *Solve P–T* for the intersection and its correlated uncertainty. *Run model ensemble* solves all compatible pairs.
5. *Share* gives a link that reproduces the calculation exactly, and the list of papers to cite.
6. *Interpretation report* (below the results in either tab) explains the result in words and downloads it as Markdown or prints it to PDF.

### New in 4.3

- **Phones and tablets** (4.3.1): larger diagram text on narrow screens, tap-to-read on the P–T diagram, decimal keypad for numbers, stacked mineral-card headers.
- **Fe³⁺ per phase**: all Fe²⁺ (default, as calibrated), Droop (1987) or a fixed Fe³⁺/ΣFe on Fe-bearing mineral cards, as a sensitivity test; recorded in links, JSON and the report.
- **Saved samples**: save, reload and delete named samples in this browser from the example menu.
- **Keyboard shortcuts**: Ctrl/⌘+Enter solves P–T, 1–7 switch tabs, ? lists them.
- **Stated limits**: Ridolfi & Renzulli (2012) results carry a warning when the amphibole has Mg/(Mg + Fe²⁺) ≤ 0.5, the limit stated in the paper.
- **Reference phase boundaries** on the P–T diagram: quartz/coesite (Bose & Ganguly, 1995), graphite/diamond (Day, 2012) and the Al₂SiO₅ triple point (Pattison, 1992).
- **P–T diagram crosshair** following the pointer read-out (not included in exports).

### New in 4.2

- **Batch on the P–T diagram**: every batch sample solved and plotted with its 1σ Monte Carlo ellipse, optionally joined as a P–T path.
- **Convenience**: the last session is restored on the next visit; analyses move between the Calculator and Structural formula tabs; microprobe headers such as `Point_ID` and `Al2O3_wt%` are recognised.

### New in 4.1

- **Interpretation report**: compositions and stoichiometric flags, equilibrium tests, the type and limits of each equation, calibration-domain status, an uncertainty budget that separates analytical from calibration error (two Monte Carlo runs), intersection geometry, comparison with all other pairs, the P–T diagram, citations and the share link.
- **Advisor** (Calculator tab): tick the minerals you have to see which systems they unlock, or rank the equations that can be evaluated for the entered analyses (a transparent 0–100 heuristic: phases, calibration domain, totals and equilibrium tests, published error, intersection angle) and apply a pair with one click.
- **Import**: Excel `.xlsx` (first sheet, read in the browser without any library), pasted tables, and tables with one analysis per row; the mineral of each row is taken from a `Phase`/`Mineral` column or guessed from its stoichiometry and confirmed by you before the batch runs.
- **Mineral cards**: cation-sum badge, analytical-total badge with ranges for hydrous phases, and paste from a spreadsheet.
- **P–T diagram**: SVG export, pointer read-out of T, P and depth, optional reference gradients, and a measure of how well the two curves intersect.

The full user manual and a glossary are in the app (*User manual*, *Glossary*) and in `docs/LithoPT_User_Manual.pdf`. No dependencies are needed to use the app; Node.js ≥ 18 is needed only for the tests.

## Running

The app is a static site with no build step and no runtime dependencies. Serve the folder with any static web server:

```bash
git clone https://github.com/kishangeo/LithoPT.git
cd LithoPT
python -m http.server 8000      # then open http://localhost:8000
```

(Opening `index.html` directly from disk also works, but the offline cache and the in-app manual need a web server.)

### Deploying on Vercel

`vercel.json` configures a static deployment: no install or build step, the repository root as output, security headers (content security policy, no framing, no referrer) and a no-cache header for the service worker. `.vercelignore` keeps tests and validation scripts out of the deployment. Import the repository in Vercel with the framework preset *Other*, or run `npx vercel --prod` in the folder.

### Tests and reproduction

Requirements: Node.js ≥ 18; Python ≥ 3.9 with `numpy`, `pandas` and `openpyxl` for the optional scripts.

```bash
npm test                                   # unit and robustness tests
npx playwright test                        # browser tests
pip install thermobar==1.0.73 && npm run crosscheck   # optional external cross-check
python validation/make_domains.py <folder with 5968_Appendix1.xlsx of Neave & Putirka (2017)> && node paper/evaluate.js   # numbers in the paper
```

Using the engine from Node:

```js
const L = require("./lithopt-core.js");
const sample = { Cpx: {...}, Opx: {...}, Grt: {...} };
const s = L.prepare(sample);
L.evaluate("T_Brey1990", s, { P_kbar: 30 });              // kelvin
L.solvePT("T_Brey1990", "P_Brey1990", s, { Pmax: 70 });   // {T_K, P_kbar, converged}
L.monteCarloPT("T_Brey1990", "P_Brey1990", sample, { N: 1000, rel: 0.02, seed: 1, Pmax: 70 });
```

## Batch CSV format

The CSV needs one row per sample. Columns:

- `Sample`, `P_kbar` and `T_C`;
- one column per oxide, named `Phase_Oxide`. Phase codes are `Grt Bt Cpx Opx Liq Ol Pl Kfs Amp Sp`, and oxides are `SiO2 TiO2 Al2O3 Cr2O3 FeOt MnO MgO CaO Na2O K2O`. Melts can also have `P2O5`, `H2O`, `Fe3Fet` and `Zr_ppm`, and garnet `Ni_ppm`;
- trace-element columns named `Trace_Ti_zrc`, `Trace_Zr_rt`, `Trace_Zr_ttn`, `Trace_Ti_qz`, `Trace_Ti_bt_apfu`, `Trace_XMg_bt`, `Trace_aTiO2` and `Trace_aSiO2`.

Columns LithoPT doesn't recognise are listed back to you rather than guessed. A row with a non-numeric value in a recognised column is skipped and reported. See `sample_data.csv` for an example.

## Citing

> Tiwari, K. (2026). LithoPT: browser-based thermobarometry with calibration-domain diagnostics and model-choice uncertainty (Version v4.3.1) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.24341232

Cite LithoPT **and** the original publication of every equation you use. The *Equations & references* tab lists each one with its DOI, and the Share dialog builds the citation list for your calculation.

## License

MIT
