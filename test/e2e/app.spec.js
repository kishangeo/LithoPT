// The browser UI must give exactly the numbers the Node.js engine gives.
const { test, expect } = require("@playwright/test");
const L = require("../../lithopt-core.js");

const PRESETS = ["pelite", "lherzolite", "eclogite", "spinel", "basalt", "phonolite", "amphibole", "mantleGrt", "granite", "zircon"];

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.errors = errors;
  await page.goto("/");
  await expect(page.locator("#versionLabel")).toContainText(L.VERSION);
});

for (const key of PRESETS) {
  test(`preset ${key}: results match the engine`, async ({ page }) => {
    await page.selectOption("#presetSelect", key);
    const system = await page.locator("#systemSelect").inputValue();
    const eqs = L.EQUATIONS.filter((e) => e.system === system);
    await expect(page.locator("#resultsBody tr")).toHaveCount(eqs.length);
    // every value shown in the page must equal the Node.js engine result for the same inputs
    const { sample, P, T, opt } = await page.evaluate(() => window.LithoPTApp.snapshot());
    const shown = await page.locator("#resultsBody tr td:nth-child(2) strong").allInnerTexts();
    const s = L.prepare(Object.assign({}, sample, { cpxFe2: opt.cpxFe2 }));
    eqs.forEach((e, i) => {
      let v; try { v = L.evaluate(e.id, s, { P_kbar: P, T_K: T + 273.15, opt }); } catch (err) { v = NaN; }
      if (!Number.isFinite(v) || !L.plausible(e.id, v)) { expect(shown[i]).toBe("—"); return; }
      const txt = e.kind === "T" ? (v - 273.15).toFixed(1) : v.toFixed(e.kind === "P" || e.kind === "H2O" || e.kind === "fO2" ? 2 : 1);
      expect(shown[i]).toContain(txt);
    });
    expect(page.errors).toEqual([]);
  });
}

test("P–T solution and Monte Carlo are reproducible and match Node", async ({ page }) => {
  await page.selectOption("#presetSelect", "lherzolite");
  await page.click('[data-tab="tab-pt"]');
  await page.fill("#mcN", "300");
  await page.click("#runPtBtn");
  await expect(page.locator("#ptSummary")).toContainText("Deterministic T");
  const txt = await page.locator("#ptSummary").innerText();
  const { sample } = await page.evaluate(() => window.LithoPTApp.snapshot());
  const det = L.solvePT("T_Brey1990", "P_Brey1990", L.prepare(sample), { Pmin: 0, Pmax: 70 });
  expect(txt).toContain(`${(det.T_K - 273.15).toFixed(1)} °C`);
  expect(txt).toContain(`${det.P_kbar.toFixed(2)} kbar`);
  const mc = L.monteCarloPT("T_Brey1990", "P_Brey1990", Object.assign({}, sample, { cpxFe2: "total" }), { Pmin: 0, Pmax: 70, N: 300, rel: 0.02, floor: 0.02, seed: 42 });
  expect(txt).toContain(`${mc.T_C.median.toFixed(1)} °C`);
  expect(page.errors).toEqual([]);
});

test("model ensemble runs", async ({ page }) => {
  await page.selectOption("#presetSelect", "lherzolite");
  await page.click('[data-tab="tab-pt"]');
  await page.selectOption("#ensSystems", ["two_px", "grt_opx"]);
  await page.click("#runEnsBtn");
  await expect(page.locator("#ensSummary")).toContainText("All pairs: T");
  expect(page.errors).toEqual([]);
});

test("share link restores the calculation", async ({ page }) => {
  const st = { system: "trace", P: 10, T: 700, sample: { Trace: { Ti_zrc: 12, aTiO2: 1, aSiO2: 1 } } };
  await page.goto("/#state=" + encodeURIComponent(JSON.stringify(st)));
  await expect(page.locator("#systemSelect")).toHaveValue("trace");
  const ref = (L.evaluate("T_Watson2006_TiZrc", L.prepare(st.sample), {}) - 273.15).toFixed(1);
  await expect(page.locator("#resultsBody")).toContainText(`${ref} °C`);
});

test("batch CSV: numbers, rejected rows and ignored columns", async ({ page }) => {
  await page.click('[data-tab="tab-batch"]');
  const csv = "Sample,P_kbar,T_C,Grt_SiO2,Grt_Al2O3,Grt_FeOt,Grt_MnO,Grt_MgO,Grt_CaO,Bt_SiO2,Bt_TiO2,Bt_Al2O3,Bt_FeOt,Bt_MgO,Bt_K2O,Foo\n" +
    "a,6,650,37.5,21.4,29.8,1.85,4.2,4.5,35.8,2.85,18.5,18.2,11.2,9.4,x\nb,6,650,abc,21.4,29.8,1.85,4.2,4.5,35.8,2.85,18.5,18.2,11.2,9.4,x\n";
  await page.setInputFiles("#csvFileInput", { name: "t.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.locator("#batchStatus")).toContainText("Ignored columns: Foo");
  const smp = { Grt: { SiO2: 37.5, Al2O3: 21.4, FeOt: 29.8, MnO: 1.85, MgO: 4.2, CaO: 4.5 }, Bt: { SiO2: 35.8, TiO2: 2.85, Al2O3: 18.5, FeOt: 18.2, MgO: 11.2, K2O: 9.4 } };
  const ref = (L.evaluate("T_FerrySpear1978", L.prepare(smp), { P_kbar: 6 }) - 273.15).toFixed(3);
  await expect(page.locator("#batchTable")).toContainText(String(+ref));
  await expect(page.locator("#batchTable")).toContainText("non-numeric value in Grt_SiO2");
});
