"""Optional external cross-check of LithoPT against Thermobar (Wieser et al., 2022).
Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>

LithoPT implements every equation from its original paper and contains no Thermobar code or data.
This script only *runs* Thermobar locally, as an independent reference implementation, on synthetic
compositions generated here (no Thermobar dataset is read), and writes the results to
validation/crosscheck_thermobar.json (git-ignored, not distributed). Compare with:
    pip install thermobar==1.0.73
    python validation/crosscheck_thermobar.py && node validation/crosscheck.js
Small differences (~1e-5 relative) are expected: LithoPT uses IUPAC atomic weights.
"""
import json, os
import numpy as np
import pandas as pd
import Thermobar as pt

RNG = np.random.default_rng(20261113)
OXIDES = ["SiO2", "TiO2", "Al2O3", "Cr2O3", "FeOt", "MnO", "MgO", "CaO", "Na2O", "K2O"]
N = 200


def synth(base, suffix):
    """N compositions scattered ±8 % (1σ) around a base analysis."""
    rows = [{f"{o}_{suffix}": max(0.0, base.get(o, 0.0) * (1 + 0.08 * RNG.standard_normal())) for o in OXIDES} for _ in range(N)]
    return pd.DataFrame(rows)


def js(df, suffix):
    return [{o: float(r[f"{o}_{suffix}"]) for o in OXIDES} for _, r in df.iterrows()]


def col(r):
    if isinstance(r, pd.DataFrame):
        r = r[next(k for k in ("T_K_calc", "P_kbar_calc", "H2O_calc") if k in r)]
    v = r
    return [None if not np.isfinite(x) else float(x) for x in np.asarray(v, dtype=float)]


cpx = synth(dict(SiO2=52.4, TiO2=0.35, Al2O3=4.1, Cr2O3=0.9, FeOt=3.1, MnO=0.09, MgO=16.2, CaO=20.3, Na2O=1.2), "Cpx")
opx = synth(dict(SiO2=56.8, TiO2=0.08, Al2O3=0.9, Cr2O3=0.3, FeOt=6.1, MnO=0.13, MgO=34.1, CaO=0.85, Na2O=0.12), "Opx")
gt = synth(dict(SiO2=41.9, TiO2=0.1, Al2O3=22.1, Cr2O3=2.2, FeOt=7.4, MnO=0.35, MgO=20.6, CaO=5.1, Na2O=0.03), "Gt")
P = RNG.uniform(10, 60, N)
T = RNG.uniform(1173.15, 1673.15, N)

# LithoPT equation id -> (phases, conditions, Thermobar call)
cases = {
    "T_Brey1990": ({"Cpx": js(cpx, "Cpx"), "Opx": js(opx, "Opx")}, {"P_kbar": P.tolist()},
                   lambda: pt.calculate_cpx_opx_temp(cpx_comps=cpx, opx_comps=opx, equationT="T_Brey1990", P=P)),
    "P_Brey1990": ({"Grt": js(gt, "Gt"), "Opx": js(opx, "Opx")}, {"T_K": T.tolist()},
                   lambda: pt.calculate_pyroxenes_garnet_press(opx_comps=opx, gt_comps=gt.assign(Ni_Gt=0.0), equationP="P_Brey1990", T=T)),
}

LIQ_OX = OXIDES + ["P2O5"]
liq_base = dict(SiO2=50.5, TiO2=1.2, Al2O3=15.8, Cr2O3=0.03, FeOt=9.6, MnO=0.17, MgO=7.6, CaO=11.2, Na2O=2.6, K2O=0.45, P2O5=0.15)
liq = pd.DataFrame([{f"{o}_Liq": max(0.0, liq_base.get(o, 0) * (1 + 0.06 * RNG.standard_normal())) for o in LIQ_OX} for _ in range(N)])
liq["H2O_Liq"] = RNG.uniform(0, 4, N)
liq["Fe3Fet_Liq"] = 0.0
cpx2 = synth(dict(SiO2=50.8, TiO2=0.7, Al2O3=4.6, Cr2O3=0.4, FeOt=6.2, MnO=0.14, MgO=15.6, CaO=20.4, Na2O=0.38), "Cpx")
opx2 = synth(dict(SiO2=54.0, TiO2=0.25, Al2O3=2.8, Cr2O3=0.45, FeOt=11.0, MnO=0.22, MgO=29.5, CaO=1.8, Na2O=0.05), "Opx")
ol = synth(dict(SiO2=39.8, FeOt=15.0, MnO=0.22, MgO=44.5, CaO=0.3), "Ol")
pl = synth(dict(SiO2=50.5, Al2O3=31.0, FeOt=0.6, CaO=14.0, Na2O=3.4, K2O=0.1), "Plag")
kf = synth(dict(SiO2=65.0, Al2O3=19.0, FeOt=0.2, CaO=0.5, Na2O=4.0, K2O=10.5), "Kspar")
Pp = RNG.uniform(0.5, 15, N)          # kbar
Tp = RNG.uniform(1323.15, 1523.15, N) # K


def ljs(i):
    d = {o: float(liq[f"{o}_Liq"][i]) for o in LIQ_OX}
    d["H2O"] = float(liq["H2O_Liq"][i])
    return d



cpxL, opxL, olL, plL, kfL = js(cpx2, "Cpx"), js(opx2, "Opx"), js(ol, "Ol"), js(pl, "Plag"), js(kf, "Kspar")
LQ = [ljs(i) for i in range(N)]
H = liq["H2O_Liq"]
T_ = lambda f, **k: (lambda: f(**k))
for eq in ["T_Put2008_eq33"]:
    cases[eq] = ({"Cpx": cpxL, "Liq": LQ}, {"P_kbar": Pp.tolist()}, T_(pt.calculate_cpx_liq_temp, cpx_comps=cpx2, liq_comps=liq, equationT=eq, P=Pp, H2O_Liq=H))
for eq in ["P_Put2008_eq30", "P_Put2008_eq31", "P_Put2008_eq32c"]:
    cases[eq] = ({"Cpx": cpxL, "Liq": LQ}, {"T_K": Tp.tolist()}, T_(pt.calculate_cpx_liq_press, cpx_comps=cpx2, liq_comps=liq, equationP=eq, T=Tp, H2O_Liq=H))
cases["P_Put2008_eq32a"] = ({"Cpx": cpxL}, {"T_K": Tp.tolist()}, T_(pt.calculate_cpx_only_press, cpx_comps=cpx2, equationP="P_Put2008_eq32a", T=Tp))
cases["T_Put2008_eq32d"] = ({"Cpx": cpxL}, {"P_kbar": Pp.tolist()}, T_(pt.calculate_cpx_only_temp, cpx_comps=cpx2, equationT="T_Put2008_eq32d", P=Pp))
cases["T_Put2008_eq28a"] = ({"Opx": js(opx2, "Opx"), "Liq": LQ}, {"P_kbar": Pp.tolist()}, T_(pt.calculate_opx_liq_temp, opx_comps=opx2, liq_comps=liq, equationT="T_Put2008_eq28a", P=Pp, H2O_Liq=H))
for eq in ["P_Put2008_eq29a", "P_Put2008_eq29b"]:
    cases[eq] = ({"Opx": opxL, "Liq": LQ}, {"T_K": Tp.tolist()}, T_(pt.calculate_opx_liq_press, opx_comps=opx2, liq_comps=liq, equationP=eq, T=Tp, H2O_Liq=H))
cases["P_Put2008_eq29c"] = ({"Opx": opxL}, {"T_K": Tp.tolist()}, T_(pt.calculate_opx_only_press, opx_comps=opx2, equationP="P_Put2008_eq29c", T=Tp))
for eq in ["T_Put2008_eq19", "T_Put2008_eq21", "T_Put2008_eq22"]:
    cases[eq] = ({"Ol": olL, "Liq": LQ}, {"P_kbar": Pp.tolist()}, T_(pt.calculate_ol_liq_temp, ol_comps=ol, liq_comps=liq, equationT=eq, P=Pp, H2O_Liq=H))
for eq in ["T_Put2008_eq23", "T_Put2008_eq24a"]:
    cases[eq] = ({"Pl": plL, "Liq": LQ}, {"P_kbar": Pp.tolist()}, T_(pt.calculate_fspar_liq_temp, plag_comps=pl, liq_comps=liq, equationT=eq, P=Pp, H2O_Liq=H))
cases["P_Put2008_eq25"] = ({"Pl": plL, "Liq": LQ}, {"T_K": Tp.tolist()}, T_(pt.calculate_fspar_liq_press, plag_comps=pl, liq_comps=liq, equationP="P_Put2008_eq25", T=Tp))
cases["H_Put2008_eq25b"] = ({"Pl": plL, "Liq": LQ}, {"T_K": Tp.tolist(), "P_kbar": Pp.tolist()}, T_(pt.calculate_fspar_liq_hygr, plag_comps=pl, liq_comps=liq, equationH="H_Put2008_eq25b", T=Tp, P=Pp))
cases["T_Put2008_eq24b"] = ({"Kfs": kfL, "Liq": LQ}, {"P_kbar": Pp.tolist()}, T_(pt.calculate_fspar_liq_temp, kspar_comps=kf, liq_comps=liq, equationT="T_Put2008_eq24b", P=Pp, H2O_Liq=H))
for eq in ["T_Put2008_eq27a", "T_Put2008_eq27b"]:
    cases[eq] = ({"Pl": plL, "Kfs": kfL}, {"P_kbar": Pp.tolist()}, T_(pt.calculate_plag_kspar_temp, plag_comps=pl, kspar_comps=kf, equationT=eq, P=Pp))
for eq in ["T_Put2008_eq13", "T_Put2008_eq14", "T_Put2008_eq15", "T_Put2008_eq16", "T_Put2008_eq28b_opx_sat", "T_Put2008_eq34_cpx_sat", "T_Put2008_eq26_plag_sat", "T_Put2008_eq24c_kspar_sat"]:
    cases[eq] = ({"Liq": LQ}, {"P_kbar": Pp.tolist()}, T_(pt.calculate_liq_only_temp, liq_comps=liq, equationT=eq, P=Pp, H2O_Liq=H))
for eq in ["T_Put2008_eq36", "T_Put2008_eq37"]:
    cases[eq] = ({"Cpx": cpxL, "Opx": opxL}, {"P_kbar": Pp.tolist()}, T_(pt.calculate_cpx_opx_temp, cpx_comps=cpx2, opx_comps=opx2, equationT=eq, P=Pp))
for eq in ["P_Put2008_eq38", "P_Put2008_eq39"]:
    cases[eq] = ({"Cpx": cpxL, "Opx": opxL}, {"T_K": Tp.tolist()}, T_(pt.calculate_cpx_opx_press, cpx_comps=cpx2, opx_comps=opx2, equationP=eq, T=Tp))

for eq in ["T_Put1996_eqT1", "T_Put1996_eqT2", "T_Mas2013_eqTalk1", "T_Mas2013_eqTalk2", "T_Mas2013_eqalk33", "T_Mas2013_Talk2012"]:
    cases[eq] = ({"Cpx": cpxL, "Liq": LQ}, {"P_kbar": Pp.tolist()}, T_(pt.calculate_cpx_liq_temp, cpx_comps=cpx2, liq_comps=liq, equationT=eq, P=Pp, H2O_Liq=H))
for eq in ["P_Put1996_eqP1", "P_Put1996_eqP2", "P_Mas2013_eqPalk1", "P_Mas2013_eqPalk2", "P_Mas2013_eqalk32c", "P_Mas2013_Palk2012"]:
    cases[eq] = ({"Cpx": cpxL, "Liq": LQ}, {"T_K": Tp.tolist()}, T_(pt.calculate_cpx_liq_press, cpx_comps=cpx2, liq_comps=liq, equationP=eq, T=Tp, H2O_Liq=H))
amp = synth(dict(SiO2=43.5, TiO2=2.2, Al2O3=11.5, Cr2O3=0.02, FeOt=11.8, MnO=0.18, MgO=14.2, CaO=10.9, Na2O=2.4, K2O=0.8), "Amp")
ampL = js(amp, "Amp")
amp["F_Amp"] = 0.0
amp["Cl_Amp"] = 0.0
for eq in ["P_Ridolfi2012_1a", "P_Ridolfi2012_1b", "P_Ridolfi2012_1c", "P_Ridolfi2012_1d", "P_Ridolfi2012_1e"]:
    cases[eq] = ({"Amp": ampL}, {"T_K": Tp.tolist()}, T_(pt.calculate_amp_only_press, amp_comps=amp, equationP=eq, T=Tp))
Pa = RNG.uniform(1.5, 20, N)
cases["T_Ridolfi2012"] = ({"Amp": ampL}, {"P_kbar": Pa.tolist()}, T_(pt.calculate_amp_only_temp, amp_comps=amp, equationT="T_Ridolfi2012", P=Pa))
for eq in ["P_Hammarstrom1986_eq1", "P_Hollister1987", "P_Johnson1989", "P_Schmidt1992", "P_Anderson1995", "P_Ridolfi2010"]:
    Ta = RNG.uniform(923.15, 1073.15, N)
    cases[eq] = ({"Amp": ampL}, {"T_K": Ta.tolist()}, T_(pt.calculate_amp_only_press, amp_comps=amp, equationP=eq, T=Ta))
for eq in ["T_Put2016_eq5", "T_Put2016_eq6", "T_Put2016_SiHbl"]:
    cases[eq] = ({"Amp": ampL}, {"P_kbar": Pa.tolist()}, T_(pt.calculate_amp_only_temp, amp_comps=amp, equationT=eq, P=Pa))
cases["T_Put2003"] = ({"Cpx": cpxL, "Liq": LQ}, {"P_kbar": Pp.tolist()}, T_(pt.calculate_cpx_liq_temp, cpx_comps=cpx2, liq_comps=liq, equationT="T_Put2003", P=Pp, H2O_Liq=H))
for eq in ["P_Put2003", "P_Neave2017"]:
    cases[eq] = ({"Cpx": cpxL, "Liq": LQ}, {"T_K": Tp.tolist()}, T_(pt.calculate_cpx_liq_press, cpx_comps=cpx2, liq_comps=liq, equationP=eq, T=Tp, H2O_Liq=H))
cases["P_Wang2021_eq1"] = ({"Cpx": cpxL}, {"T_K": Tp.tolist()}, T_(pt.calculate_cpx_only_press, cpx_comps=cpx2, equationP="P_Wang2021_eq1", T=Tp))
for eq in ["T_Wood1973", "T_Wells1977"]:
    cases[eq] = ({"Cpx": cpxL, "Opx": opxL}, {"P_kbar": Pp.tolist()}, T_(pt.calculate_cpx_opx_temp, cpx_comps=cpx2, opx_comps=opx2, equationT=eq, P=Pp))
cases["T_Beattie1993"] = ({"Ol": olL, "Liq": LQ}, {"P_kbar": Pp.tolist()}, T_(pt.calculate_ol_liq_temp, ol_comps=ol, liq_comps=liq, equationT="T_Beatt93_ol", P=Pp))
cases["H_Gavr2016"] = ({"Ol": olL, "Liq": LQ}, {}, T_(pt.calculate_ol_liq_hygr, ol_comps=ol, liq_comps=liq, equationH="H_Gavr2016"))
cases["T_Beattie1993_opx"] = ({"Opx": opxL, "Liq": LQ}, {"P_kbar": Pp.tolist()}, T_(pt.calculate_opx_liq_temp, opx_comps=opx2, liq_comps=liq, equationT="T_Beatt1993_opx", P=Pp))
cases["H_Masotta2019"] = ({"Pl": plL, "Liq": LQ}, {"T_K": Tp.tolist(), "P_kbar": Pp.tolist()}, T_(pt.calculate_fspar_liq_hygr, plag_comps=pl, liq_comps=liq, equationH="H_Masotta2019", T=Tp, P=Pp))
ol2 = ol.copy(); ol2["Al2O3_Ol"] = RNG.uniform(0.03, 0.09, N)
sp = synth(dict(TiO2=0.4, Al2O3=32.0, Cr2O3=32.0, FeOt=16.0, MnO=0.2, MgO=17.0), "Sp")
for eq in ["T_Wan2008", "T_Coogan2014"]:
    cases[eq] = ({"Ol": js(ol2, "Ol"), "Sp": js(sp, "Sp")}, {}, T_(pt.calculate_ol_sp_temp, ol_comps=ol2, sp_comps=sp, equationT=eq))
for eq in ["T_Helz1987_MgO", "T_Helz1987_CaO", "T_Shea2022_MgO", "T_Sug2000_eq1", "T_Put1999", "T_Molina2015_amp_sat"]:
    cases[eq] = ({"Liq": LQ}, {"P_kbar": Pp.tolist()}, T_(pt.calculate_liq_only_temp, liq_comps=liq, equationT=eq, P=Pp, H2O_Liq=H))
gtn = gt.copy(); gtn["Ni_Gt"] = RNG.uniform(15, 110, N)
gtL = js(gt, "Gt")
for g, ni in zip(gtL, gtn["Ni_Gt"]):
    g["Ni_ppm"] = float(ni)
for eq in ["T_Ryan1996", "T_Canil1999", "T_Sudholz2021"]:
    cases[eq] = ({"Grt": gtL}, {}, T_(pt.calculate_gt_only_temp, gt_comps=gtn.copy(), equationT=eq))

out = {"thermobar_version": pt.__version__, "cases": []}
for eq, (phases, cond, call) in cases.items():
    samples = [{ph: comps[i] for ph, comps in phases.items()} for i in range(N)]
    try:
        ref = col(call())
    except Exception as err:  # equation not exposed by this Thermobar entry point
        print("skipped", eq, "-", str(err)[:80])
        continue
    out["cases"].append({"eq": eq, "samples": samples, **cond, "thermobar": ref})
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "crosscheck_thermobar.json")
json.dump(out, open(path, "w"))
print("wrote", path, "for", ", ".join(cases))
