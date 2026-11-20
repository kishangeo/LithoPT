"""Builds LithoPT_User_Manual.docx and the in-app reader (docs/manual.html, docs/glossary.json)
from one source, so the PDF and the app always say the same thing."""
import json, os, re, datetime, html
import docx
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

H = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(H, "equations.json"), encoding="utf8"))  # written by docs/export_equations.js
RES = json.load(open(os.path.join(H, "..", "paper", "results.json"), encoding="utf8"))  # written by paper/evaluate.js
VER = D["version"]

doc = docx.Document()
st = doc.styles["Normal"]; st.font.name = "Calibri"; st.font.size = Pt(10.5)
st.element.rPr.rFonts.set(qn("w:eastAsia"), "Calibri")
for s in doc.sections:
    s.left_margin = s.right_margin = Cm(2.2); s.top_margin = s.bottom_margin = Cm(2.0)


def md(p, text):
    """*italic*, **bold**, _{sub}, ^{sup}, `code`"""
    for tok in re.split(r"(\*\*[^*]+\*\*|\*[^*]+\*|_\{[^}]*\}|\^\{[^}]*\}|`[^`]+`)", text):
        if not tok:
            continue
        if tok.startswith("**"): r = p.add_run(tok[2:-2]); r.bold = True
        elif tok.startswith("*"): r = p.add_run(tok[1:-1]); r.italic = True
        elif tok.startswith("_{"): r = p.add_run(tok[2:-1]); r.font.subscript = True
        elif tok.startswith("^{"): r = p.add_run(tok[2:-1]); r.font.superscript = True
        elif tok.startswith("`"): r = p.add_run(tok[1:-1]); r.font.name = "Consolas"; r.font.size = Pt(9.5)
        else: p.add_run(tok)
    return p


HTML = []  # in-app manual, built alongside the .docx


def mdh(text):
    """Same mini-markup as md(), rendered as HTML; bare URLs become links."""
    out = []
    for tok in re.split(r"(\*\*[^*]+\*\*|\*[^*]+\*|_\{[^}]*\}|\^\{[^}]*\}|`[^`]+`)", str(text)):
        if not tok:
            continue
        e = lambda s: html.escape(s, quote=False)
        if tok.startswith("**"): out.append(f"<strong>{e(tok[2:-2])}</strong>")
        elif tok.startswith("*"): out.append(f"<em>{e(tok[1:-1])}</em>")
        elif tok.startswith("_{"): out.append(f"<sub>{e(tok[2:-1])}</sub>")
        elif tok.startswith("^{"): out.append(f"<sup>{e(tok[2:-1])}</sup>")
        elif tok.startswith("`"): out.append(f"<code>{e(tok[1:-1])}</code>")
        else: out.append(re.sub(r"(https?://[^\s)<]+[^\s)<.,;])", r'<a href="\1" target="_blank" rel="noopener noreferrer">\1</a>', e(tok)))
    return "".join(out)


def _dedent(text):
    lines = text.replace("\r", "").split("\n")
    ind = min((len(l) - len(l.lstrip()) for l in lines[1:] if l.strip()), default=0)
    return [l if i == 0 else l[ind:] for i, l in enumerate(lines)]


def P(text, style=None):
    p = doc.add_paragraph(style=style)
    p.paragraph_format.space_after = Pt(5)
    HTML.append(f"<p>{mdh(text)}</p>")
    return md(p, text)


def B(items):
    HTML.append("<ul>" + "".join(f"<li>{mdh(t)}</li>" for t in items) + "</ul>")
    for t in items:
        md(doc.add_paragraph(style="List Bullet"), t)


def EQ(text, label=None):
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(3); p.paragraph_format.space_after = Pt(6)
    md(p, text)
    if label:
        p.add_run(f"      ({label})")
    HTML.append(f'<div class="m-eq"><span>{mdh(text)}</span>' + (f'<span class="m-eqno">({label})</span>' if label else "") + "</div>")


def CODE(text):
    p = doc.add_paragraph()
    pPr = p._p.get_or_add_pPr(); shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:fill"), "F2F4F7"); pPr.append(shd)
    p.paragraph_format.left_indent = Cm(0.4); p.paragraph_format.space_after = Pt(6)
    lines = _dedent(text)
    for i, l in enumerate(lines):
        r = p.add_run(l + ("\n" if i < len(lines) - 1 else ""))
        r.font.name = "Consolas"; r.font.size = Pt(8.5)
    HTML.append(f"<pre><code>{html.escape(chr(10).join(lines), quote=False)}</code></pre>")


def TABLE(rows, widths=None, head=True, size=9):
    body = rows[1:] if head else rows
    HTML.append('<div class="m-table"><table>' + (f"<thead><tr>{''.join(f'<th>{mdh(v)}</th>' for v in rows[0])}</tr></thead>" if head else "")
                + "<tbody>" + "".join("<tr>" + "".join(f"<td>{mdh(v)}</td>" for v in r) + "</tr>" for r in body) + "</tbody></table></div>")
    t = doc.add_table(rows=len(rows), cols=len(rows[0])); t.style = "Light Grid Accent 1"; t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, row in enumerate(rows):
        for j, v in enumerate(row):
            c = t.cell(i, j); c.text = ""
            p = c.paragraphs[0]; md(p, str(v))
            for r in p.runs:
                r.font.size = Pt(size)
                if i == 0 and head: r.bold = True
            if widths: c.width = Cm(widths[j])
    doc.add_paragraph()
    return t


_ids = set()
def _heading(t, level):
    slug = re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-") or "s"
    while slug in _ids: slug += "-"
    _ids.add(slug)
    HTML.append(f'<h{level + 1} id="m-{slug}">{html.escape(t)}</h{level + 1}>')
    return doc.add_heading(t, level=level)
H1 = lambda t: _heading(t, 1)
H2 = lambda t: _heading(t, 2)
H3 = lambda t: _heading(t, 3)

# ============================================================== title page
t = doc.add_paragraph(); t.alignment = WD_ALIGN_PARAGRAPH.CENTER; t.paragraph_format.space_before = Pt(120)
r = t.add_run("LithoPT"); r.bold = True; r.font.size = Pt(34); r.font.color.rgb = RGBColor(0x1E, 0x40, 0xAF)
t = doc.add_paragraph(); t.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = t.add_run("Browser-based thermobarometry with Monte Carlo and model-choice uncertainty"); r.font.size = Pt(15)
t = doc.add_paragraph(); t.alignment = WD_ALIGN_PARAGRAPH.CENTER; t.paragraph_format.space_before = Pt(30)
r = t.add_run(f"User manual and scientific reference\nVersion {VER}"); r.font.size = Pt(13)
t = doc.add_paragraph(); t.alignment = WD_ALIGN_PARAGRAPH.CENTER; t.paragraph_format.space_before = Pt(60)
t.add_run("Kishan Tiwari\nDepartment of Geology and Geophysics, Indian Institute of Technology Kharagpur\nkishantiwari@iitkgp.ac.in  ·  ORCID 0000-0003-0014-914X").font.size = Pt(10.5)
t = doc.add_paragraph(); t.alignment = WD_ALIGN_PARAGRAPH.CENTER; t.paragraph_format.space_before = Pt(40)
t.add_run(f"Licence: MIT\n{datetime.date.today():%B %Y}").font.size = Pt(9.5)
doc.add_page_break()

# ============================================================== how to cite / contents
H1("How to cite")
P("If you publish results obtained with LithoPT, cite (i) the LithoPT software release and (ii) **the original publication of every equation you used** (listed with its DOI for each equation in Chapter 6, in the *Equations & references* tab and in the Share dialog for your calculation). LithoPT reproduces the published equations; the scientific credit for them belongs to their authors.")
H1("Contents"); HTML.pop()  # the app builds its own contents
for c in ["1. Introduction and scope", "2. Getting started", "3. Scientific background", "4. From oxide analyses to mineral components",
          "5. Conventions: units, variables and symbols", "6. Equation reference (all equations)", "7. Coupled P–T solutions",
          "8. Uncertainty: analytical, calibration and model choice", "9. Calibration-domain diagnostics", "10. Equilibrium, input and plausibility tests",
          "11. Pressure-to-depth conversion", "12. Batch processing", "13. Reproducibility, privacy and offline use",
          "14. Verification and validation", "15. Good practice and limitations", "16. Glossary", "17. References"]:
    doc.add_paragraph(c, style="List Paragraph")
doc.add_page_break()

# ============================================================== 1 introduction
H1("1. Introduction and scope")
P(f"LithoPT calculates pressures (P), temperatures (T), melt water contents and oxygen fugacities from the chemical compositions of coexisting minerals and melts. It implements {len(D['eqs'])} published equations in {len(D['systems'])} systems: metamorphic exchange and net-transfer equilibria, mantle two-pyroxene, garnet and olivine–spinel equilibria, mineral–melt and mineral-only thermobarometers and hygrometers for volcanic and plutonic rocks, amphibole thermobarometers, liquid-only and accessory-mineral saturation thermometers, and trace-element thermometers. Every equation is implemented directly from its original publication and checked against the printed equation, including the definitions of its variables and units; where the authors published a worked example or a spreadsheet, LithoPT is tested against it. All calculations run in the web browser of the user: no data are sent to a server and, after the first visit, the application works offline.")

P("Beyond evaluating equations, LithoPT is designed to make three sources of uncertainty explicit, because each of them can be larger than the number a single calculation returns:")
B(["**Analytical uncertainty** — how errors in the microprobe analyses propagate into P and T. LithoPT perturbs every oxide and recomputes everything (Monte Carlo), and reports the full P–T covariance, which is often strongly correlated.",
   "**Calibration uncertainty** — the standard error of estimate (SEE) of each equation, and, where a summary of the calibration dataset is available, whether an analysis lies inside the compositional space in which the equation was calibrated (the *calibration domain*, Chapter 9).",
   "**Model-choice uncertainty** — different published equations for the same equilibrium often disagree by more than their stated errors. LithoPT can solve every compatible thermometer–barometer pair and report their spread."])
P("This manual explains the science behind every calculation. Chapter 3 introduces the thermodynamics of thermobarometry, Chapter 4 the conversion of oxide analyses into mineral components, and Chapter 6 lists every equation exactly as implemented, with its calibration range, standard error, verification status and reference.")

# ============================================================== 2 getting started
H1("2. Getting started")
H2("2.1 Opening the application")
P("Open `index.html` in any current web browser (Chrome, Firefox, Safari or Edge), or visit the hosted web application. No installation is needed. The calculation engine (`lithopt-core.js`) can also be used from Node.js for scripting (Section 13.4).")
H2("2.2 The five tabs")
TABLE([["Tab", "Purpose"],
       ["Calculator", "Choose an equilibrium system, enter the P (for thermometers) and T (for barometers) at which to evaluate, and enter oxide analyses of the phases. All equations of the system are evaluated side by side with their SEE, calibration-domain status and verification status. Equilibrium tests and phase components are shown below."],
       ["P–T solution & Monte Carlo", "Pair any thermometer with any barometer whose phases are available; LithoPT finds their intersection, propagates uncertainty by Monte Carlo simulation, converts P to depth and plots the result. The model-ensemble button solves all compatible pairs."],
       ["Structural formula", "Cations per formula unit for garnet, pyroxenes, olivine, spinel, feldspars, biotite and amphibole, with Droop (1987) Fe³⁺ where applicable. *Take from Calculator* and *Send to Calculator* copy an analysis between the two tabs."],
       ["Batch (CSV)", "Upload many samples at once (CSV, text, Excel .xlsx or a pasted table); every applicable equation is evaluated for every row; results can be exported and each sample opened in the calculator."],
       ["Equations & references", "Searchable catalogue of all equations with system, type, SEE, calibration range, verification status, calibration dataset and DOI."]],
      [3.5, 13])
H2("2.3 A first calculation")
B(["Select *Example → Metapelite* in the header. The calculator shows the garnet–biotite thermometer for a garnet, biotite and plagioclase analysis.",
   "Change the pressure field; the temperature updates immediately.",
   "Open *P–T solution & Monte Carlo*, choose *Ferry & Spear (1978)* and *Koziol & Newton (1988) GASP, kyanite*, and press *Solve P–T*. The intersection, Monte Carlo statistics and an error ellipse are shown and plotted.",
   "Press *Share* for a link that reproduces the calculation exactly, a results summary and the list of papers to cite."])
H2("2.4 Entering analyses")
B(["Enter oxide concentrations in weight percent; total iron as FeO_{t}. Blank fields are treated as zero.",
   "Negative values (e.g. below-detection results reported as negative numbers) are rejected with an error message; set them to zero or leave them blank.",
   "Melts (glasses or melt inclusions) accept P_{2}O_{5}, H_{2}O (wt%), Fe³⁺/ΣFe (for the melt oxybarometer and the Fe–Mg equilibrium tests) and Zr (ppm, for zircon saturation). Garnet accepts Ni (ppm) in the garnet-only system. Fields that no equation of the selected system uses are hidden.",
   "The badges next to each phase show the analytical total (green within 98.5–101.5 wt%, or 92–98 wt% for biotite and 95–98.8 wt% for amphibole; amber within 97–102 wt%; red otherwise) and, for minerals with a fixed oxygen basis, the cation sum with all Fe as Fe²⁺.",
   "*Paste* on each phase reads oxide values copied from a spreadsheet: a header row with a value row, name–value pairs, or bare numbers in the order of the fields. Fe₂O₃ is converted to FeO and added to total iron."])
H2("2.5 The advisor")
P("The *Advisor* panel at the top of the Calculator answers two questions. Ticking the minerals you analysed lists the systems they allow and how many thermometers and barometers each contains, and states whether a coupled P–T solution is possible. *Rank equations* scores every equation that can be evaluated for the analyses entered, and every thermometer–barometer pair that intersects, on a fixed scale of 0–100:")
TABLE([["Criterion", "Points"],
       ["Phases present and result physically plausible", "25"],
       ["Calibration domain: inside 30, marginal 15, outside 0, not assessed 15", "30"],
       ["Analytical totals of the phases used (10) and the Fe–Mg equilibrium tests involving them (10)", "20"],
       ["Published SEE: thermometers 15 at ≤ 25 °C to 0 at ≥ 75 °C; barometers 15 at ≤ 1 kbar to 0 at ≥ 4 kbar", "15"],
       ["Pairs only: intersection angle (Section 7), full at ≥ 60°", "10"]], [13, 3])
P("Single equations are scaled from 90 to 100 points. The score ranks what the numbers can show; it cannot check textures, that the minerals grew together, or that buffering phases such as quartz, an Al₂SiO₅ polymorph or rutile are present. Because calibration-domain summaries exist for only one equation, most equations receive the same domain points, and the ranking is then driven by the published error and the intersection angle. *Apply and solve P–T* selects the pair in the P–T tab and solves it.")

# ============================================================== 3 background
H1("3. Scientific background")
H2("3.1 Chemical equilibrium and the equilibrium constant")
P("Thermobarometry rests on the condition of chemical equilibrium. For a balanced reaction among phase components, Σ ν_{i} A_{i} = 0 (ν_{i} positive for products), the Gibbs free energy change is zero at equilibrium:")
EQ("Δ*G*(*P*, *T*) = Δ*H*° − *T* Δ*S*° + (*P* − 1) Δ*V*° + *RT* ln *K* = 0", "3.1")
P("where Δ*H*°, Δ*S*° and Δ*V*° are the enthalpy, entropy and volume changes of the reaction among pure end-members (standard state: pure phase at *P* and *T*), *R* = 8.314 J mol⁻¹ K⁻¹, and the equilibrium constant *K* = Π *a*_{i}^{ν_{i}} is the product of the activities of the components. Activities are written as *a* = *X* γ, the product of a mole fraction and an activity coefficient describing non-ideal mixing. Rearranging Eq. (3.1) gives the two forms used throughout this manual:")
EQ("*T* = (Δ*H*° + *P* Δ*V*°) / (Δ*S*° − *R* ln *K*)      and      *P* = (*T* Δ*S*° − Δ*H*° − *RT* ln *K*) / Δ*V*°", "3.2")
P("A reaction is a good **thermometer** when its Δ*V*° is small and Δ*H*° large (its equilibrium curves in P–T space are steep, so *K* depends mainly on *T*), and a good **barometer** when Δ*V*° is large (curves are flat). Empirical calibrations often retain this functional form, *T* = (*a* + *bP*)/(*c* − ln *K*), with coefficients fitted to experiments.")
H2("3.2 Exchange thermometers")
P("In an exchange reaction two cations swap between two phases, e.g. Fe²⁺–Mg exchange between garnet and biotite:")
EQ("Fe_{3}Al_{2}Si_{3}O_{12} (almandine) + KMg_{3}AlSi_{3}O_{10}(OH)_{2} (phlogopite) = Mg_{3}Al_{2}Si_{3}O_{12} (pyrope) + KFe_{3}AlSi_{3}O_{10}(OH)_{2} (annite)", "3.3")
P("Because the reaction merely redistributes Fe and Mg, Δ*V*° is small and the distribution coefficient *K*_{D} = (Fe/Mg)^{A}/(Fe/Mg)^{B} is a sensitive function of temperature. Other cations (Ca and Mn in garnet, Ti and Al^{VI} in biotite, Na and Fe³⁺ in clinopyroxene) change the activity coefficients of the exchanging components; calibrations therefore include compositional terms such as *X*_{Ca}^{Grt}. LithoPT implements garnet–biotite, garnet–clinopyroxene and garnet–orthopyroxene exchange thermometers.")
H2("3.3 Net-transfer barometers")
P("In a net-transfer reaction the modal amounts of phases change and Δ*V*° is large. The classic example is GASP (garnet–aluminosilicate–plagioclase–quartz):")
EQ("3 CaAl_{2}Si_{2}O_{8} (anorthite) = Ca_{3}Al_{2}Si_{3}O_{12} (grossular) + 2 Al_{2}SiO_{5} (kyanite or sillimanite) + SiO_{2} (quartz)", "3.4")
P("The products occupy about 6.2 J bar⁻¹ less volume than the reactants, so increasing pressure drives the reaction to the right; the activities of grossular in garnet and anorthite in plagioclase fix the pressure at a given temperature. LithoPT also implements the Al-in-orthopyroxene barometer for garnet-bearing assemblages (Brey and Köhler, 1990), based on the dissolution of the MgAl_{2}SiO_{6} (Tschermak) component in orthopyroxene coexisting with garnet.")
H2("3.4 Solvus thermometers")
P("Where two phases of the same structure coexist across a miscibility gap (a *solvus*), their compositions converge with increasing temperature. Two-pyroxene thermometry exploits the solvus between Ca-rich clinopyroxene and Ca-poor orthopyroxene: the enstatite component is partitioned between them as a function of temperature. Brey and Köhler (1990) calibrated this transfer on reversed experiments in a natural lherzolite (T_{BKN}), together with thermometers based on Ca in orthopyroxene and on Na partitioning between the two pyroxenes.")


H2("3.5 Mineral–melt thermobarometry")
P("For volcanic and plutonic rocks, a mineral is compared with the melt (glass or melt inclusion) from which it crystallised. The partitioning of components between crystal and melt depends on T, P and melt composition, e.g. the formation of jadeite from melt components:")
EQ("NaAlSi_{2}O_{6} (jadeite in cpx) = Na^{liq} + Al^{liq} + 2 Si^{liq} (as melt cation fractions)", "3.5")
P("Its equilibrium constant, *K*_{Jd} = *X*_{Jd}^{cpx} / (*X*_{Na}^{liq} *X*_{Al}^{liq} (*X*_{Si}^{liq})²), increases with pressure because jadeite is dense; jadeite–diopside exchange is mainly temperature dependent. Putirka et al. (1996, 2003) and Putirka (2008) regressed such terms, together with melt-composition corrections, against experimental databases; Neave and Putirka (2017) recalibrated the jadeite barometer for crustal pressures and Masotta et al. (2013) for alkaline differentiated magmas. The same approach underlies olivine–, orthopyroxene–, plagioclase– and alkali feldspar–liquid equations. Because the mineral must have grown from the analysed melt, **equilibrium tests** (Chapter 10) are an essential part of mineral–melt thermobarometry.")
H2("3.6 Mineral-only and liquid-only equations")
P("When no coexisting melt is available, mineral-only equations relate P or T to the composition of a single phase: clinopyroxene-only (Putirka, 2008, eqs 32a and 32d; Wang et al., 2021), orthopyroxene-only (Putirka, 2008, eq. 29c) and amphibole-only equations (Ridolfi et al., 2010; Ridolfi and Renzulli, 2012; Putirka, 2016), and the Al-in-hornblende barometers for granitoids. These are empirical and implicitly assume the melt compositions of their calibration. Conversely, *liquid-only* thermometers estimate the temperature of a melt saturated in a given phase from the melt composition alone (e.g. MgO-based olivine-saturation thermometers; Helz and Thornber, 1987; Putirka, 2008, eqs 13–16). They are valid only if the melt was saturated in that phase.")
H2("3.7 Trace-element thermometers")
P("The solubility of a trace element in a host mineral buffered by a coexisting saturating phase increases with temperature. For example, Ti in zircon coexisting with rutile and quartz, Zr in rutile coexisting with zircon and quartz, and Zr in titanite. The general form is")
EQ("log(ppm) = *A* − *B*/*T* − log *a*_{SiO₂} + log *a*_{TiO₂}", "3.6")
P("where activity terms correct for the absence of a buffering phase (activity < 1). Ti-in-quartz (TitaniQ) and Ti-in-biotite are further examples. These thermometers can record peak or crystallisation temperatures that major-element thermometers reset during cooling.")
H2("3.8 Saturation thermometry for accessory minerals")
P("The solubility of zircon and apatite in silicate melts depends on temperature and melt composition. If a melt is saturated in zircon, its Zr content gives a temperature (Watson and Harrison, 1983; Boehnke et al., 2013); similarly P_{2}O_{5} for apatite (Harrison and Watson, 1984). The compositional parameter for zircon is M = (Na + K + 2Ca)/(Al·Si) in cation fractions.")
H2("3.9 Hygrometry and oxybarometry")
P("Because water depresses the stability of plagioclase relative to melt, plagioclase–melt equilibrium can be inverted for melt H_{2}O at known T and P (Putirka, 2008, eq. 25b; Masotta and Mollo, 2019, for trachytic melts). Ca partitioning between olivine and melt decreases with melt water (Gavrilenko et al., 2016). Oxygen fugacity (*f*_{O₂}) is obtained from the olivine–orthopyroxene–spinel equilibrium 6 Fe_{2}SiO_{4} + O_{2} = 3 Fe_{2}Si_{2}O_{6} + 2 Fe_{3}O_{4} (Ballhaus et al., 1991) and, for melts, from the Fe³⁺/ΣFe ratio (Kress and Carmichael, 1991). It is reported relative to the fayalite–magnetite–quartz (FMQ, also called QFM) buffer.")
H2("3.10 Mantle garnet thermometry")
P("Ni partitions between olivine and garnet as a function of temperature; because mantle olivine has nearly constant Ni (about 3000 ppm), Ni in garnet alone is a thermometer (Ryan et al., 1996; Canil, 1999; Sudholz et al., 2021). Applied to populations of garnet xenocrysts from kimberlites, it maps the thermal structure of the lithospheric mantle. The Ni content assumed for olivine can be changed in the interface.")

H2("3.11 Empirical versus thermodynamic calibrations")
P("Some equations are derived from thermodynamic data and activity models (e.g. Harley, 1984; Koziol and Newton, 1988; Ballhaus et al., 1991; Beattie, 1993; the Al-in-orthopyroxene barometer of Brey and Köhler, 1990). Many modern equations, especially for mineral–melt systems, are empirical regressions of experimental data (e.g. Putirka, 2008; Neave and Putirka, 2017; Ridolfi and Renzulli, 2012). Empirical equations can be very precise inside their calibration range and badly wrong outside it, which is why LithoPT reports the calibration-domain distance for equations whose calibration dataset is available (Chapter 9) and the stated calibration range for all others (Chapter 6).")

H1("4. From oxide analyses to mineral components")
H2("4.1 Oxides to cations")
P("An analysis gives weight percent (wt%) of oxides. For each oxide *k* with molar mass *M*_{k}, *c*_{k} cations and *o*_{k} oxygens per formula (e.g. Al_{2}O_{3}: *c* = 2, *o* = 3), the molar proportion is *w*_{k}/*M*_{k}. Normalising to a fixed number of oxygens *N*_{O} gives cations per formula unit (apfu):")
EQ("*n*_{j} = *N*_{O} · (*c*_{j} *w*_{j}/*M*_{j}) / Σ_{k} (*o*_{k} *w*_{k}/*M*_{k})", "4.1")
NAMES = {"SiO2": "SiO₂", "TiO2": "TiO₂", "Al2O3": "Al₂O₃", "Cr2O3": "Cr₂O₃", "FeOt": "FeO_{t}", "MnO": "MnO", "MgO": "MgO", "CaO": "CaO", "Na2O": "Na₂O", "K2O": "K₂O", "P2O5": "P₂O₅"}
TABLE([["Oxide", "Molar mass (g mol⁻¹)", "Cations", "Oxygens"]] + [[NAMES[k], f"{o['mw']:.4f}", o["cat"], o["ox"]] for k, o in D["oxides"].items()], [3, 4, 2.5, 2.5])
P("Molar masses are computed from the IUPAC (CIAAW) standard atomic weights: " + ", ".join(f"{k} {v}" for k, v in D["atomic_weights"].items()) + " g mol⁻¹.")

TABLE([["Phase", "Normalisation", "Fe³⁺ estimate"],
       ["Garnet", "12 O", "none in the equations; Droop (1987) in the structural-formula tab"],
       ["Clinopyroxene, orthopyroxene", "6 O", "charge balance (Papike et al., 1974; Lindsley, 1983) where an equation's site model includes Fe³⁺; optional for the Grt–Cpx K_D"],
       ["Olivine", "4 O; cation fractions for olivine–liquid", "none"], ["Spinel", "4 O, 3 cations", "Droop (1987) — required for the Ballhaus oxybarometer"],
       ["Plagioclase, alkali feldspar", "8 O; cation fractions", "none"], ["Biotite", "22 O", "none (all Fe²⁺)"],
       ["Amphibole", "23 O (Al-in-hornblende, Putirka 2016); 13 cations Si…Mg (Ridolfi et al.)", "none (all Fe²⁺)"],
       ["Melt", "anhydrous cation and mole fractions", "Fe³⁺/ΣFe entered by the user"]], [4.5, 5.5, 6.5])

H2("4.2 Fe³⁺ from stoichiometry (Droop, 1987)")
P("A microprobe cannot distinguish Fe²⁺ from Fe³⁺. If all Fe is calculated as Fe²⁺ and a mineral actually contains Fe³⁺, normalising to *N*_{O} oxygens produces too many cations (*S* > *T*, where *T* is the ideal cation total). Charge balance then gives the Fe³⁺ content per *N*_{O} oxygens:")
EQ("*F* = 2 *N*_{O} (1 − *T*/*S*)", "4.2")
P("after which all cations are rescaled by *T*/*S* and Fe²⁺ = Fe_{t} − *F*. The estimate is sensitive to analytical errors (especially SiO_{2}) and to vacancies; it should not be used for minerals with vacancies or OH (biotite, amphibole).")
H2("4.3 Pyroxene components")
P("Clinopyroxene components for mineral–melt equations follow Putirka (2008, Table 3), from cations on 6 O:")
B(["Al^{IV} = 2 − Si; Al^{VI} = Al − Al^{IV}; Fe³⁺ = Na + Al^{IV} − Al^{VI} − 2Ti − Cr (Papike et al., 1974).",
   "Jadeite, Jd = Al^{VI} or Na, whichever is less; Ca-Tschermak, CaTs = Al^{VI} − Jd (if positive); CaTi = (Al^{IV} − CaTs)/2 (if Al^{IV} > CaTs); CrCaTs = Cr/2.",
   "DiHd = Ca − CaTi − CaTs − CrCaTs; EnFs = (Fe + Mg − DiHd)/2. Putirka et al. (1996) do not subtract CrCaTs from DiHd; LithoPT follows each paper.",
   "LithoPT reproduces the worked example of Putirka (2008, Table 3) to the last printed digit (unit test)."])
P("Orthopyroxene components follow Putirka (2008, Table 2): NaAlSi_{2}O_{6} = Al^{VI} or Na, whichever is less; FmTiAlSiO_{6} = Ti; CrAl_{2}SiO_{6} = Cr; FmAl_{2}SiO_{6} = Al^{VI} − NaAlSi_{2}O_{6} − CrAl_{2}SiO_{6}; CaFmSi_{2}O_{6} = Ca; Fm_{2}Si_{2}O_{6} = (Fe + Mn + Mg − FmTiAlSiO_{6} − FmAl_{2}SiO_{6} − CaFmSi_{2}O_{6})/2; X_{En} and X_{Di} are Fm_{2}Si_{2}O_{6} and CaFmSi_{2}O_{6} multiplied by Mg/(Mg + Fe + Mn).")
B(["Two-pyroxene thermometry of Brey and Köhler (1990): Ca* = Ca/(1 − Na) and X_{Fe} = Fe/(Fe + Mg) in each pyroxene.",
   "Two-site enstatite activity of Wood and Banno (1973), used also by Wells (1977): Ca, Na and Mn on M2; Al^{VI}, Cr, Ti and Fe³⁺ on M1; Mg and Fe²⁺ distributed randomly over the remaining sites; a_{En} = X_{Mg}^{M2} X_{Mg}^{M1}.",
   "Orthopyroxene site occupancies for the Al-in-Opx barometer, from Brey and Köhler (1990, Table 3) with Fe³⁺ = 0: X_{Al}^{M1} = (Al + Na − Cr − 2Ti)/2; jadeite = Na − Cr − 2Ti; X_{Al,TS}^{M1} = (Al + jadeite)/2 if jadeite < 0, otherwise (Al − jadeite)/2; X_{MF}^{M1} = 1 − X_{Al}^{M1} − Cr − Ti; X_{MF}^{M2} = 1 − Ca − Na − Mn; X_{MF} = Mg/(Mg + Fe)."])

H2("4.4 Garnet, feldspar, olivine, spinel and amphibole variables")
B(["Garnet: *X*_{Alm}, *X*_{Prp}, *X*_{Grs}, *X*_{Sps} = Fe, Mg, Ca, Mn/(Fe + Mg + Ca + Mn); *X*_{Ca} (FMC) = Ca/(Ca + Mg + Fe); Mg# = Mg/(Mg + Fe); Cr/(Cr + Al).",
   "Feldspars: An, Ab, Or = Ca, Na, K/(Ca + Na + K); the Si and Ca cation fractions of alkali feldspar for Putirka (2008) eq. 27a.",
   "Olivine: Fo = Mg/(Mg + Fe); D_{Mg} = X_{Mg}^{ol}/X_{Mg}^{liq} from cation fractions.",
   "Amphibole: cations on 23 O for the Al-in-hornblende barometers and Putirka (2016); 13-cation normalisation (Si + Ti + Al + Cr + Fe + Mn + Mg = 13; Leake et al., 1997) for Ridolfi et al. (2010) and Ridolfi and Renzulli (2012).",
   "Spinel (4 O, Droop Fe³⁺): Cr# = Cr/(Cr + Al); *X*_{Fe²⁺} = Fe²⁺/(Fe²⁺ + Mg); *X*_{Fe³⁺} and *X*_{Al} = Fe³⁺ or Al/(Al + Cr + Fe³⁺).",
  ])
H2("4.5 Melt variables")
P("For the equations of Putirka and co-workers, melt compositions are converted to anhydrous cation fractions (*X*_{Si}^{liq}, *X*_{Al}^{liq}, … summing to 1) over nine oxides (SiO_{2}, TiO_{2}, Al_{2}O_{3}, FeO_{t}, MnO, MgO, CaO, Na_{2}O, K_{2}O), without renormalising the weight percentages, exactly as in Putirka (2008, Table 1), whose worked example LithoPT reproduces; oxide mole fractions use the same oxides. Melt Mg# = Mg/(Mg + Fe) with total Fe. The Beattie (1993) terms are C_{NM} = X_{Fe} + X_{Mn} + X_{Mg} + X_{Ca} and NF = 7/2 ln(1 − X_{Al}) + 7 ln(1 − X_{Ti}). H_{2}O is entered in wt% and enters equations directly. Zircon saturation uses M = (Na + K + 2Ca)/(Al·Si) from cation fractions of all oxides (Watson and Harrison, 1983); the melt oxybarometer uses oxide mole fractions including P_{2}O_{5} (Kress and Carmichael, 1991).")

H1("5. Conventions: units, variables and symbols")
P("Inside all equations LithoPT uses **temperature in kelvin** and **pressure in kbar** (1 kbar = 0.1 GPa = 100 MPa). The interface shows temperature in °C. Some papers print their equations in °C with −273 instead of −273.15; LithoPT reproduces the printed form exactly. Implemented expressions in Chapter 6 are shown as JavaScript; the symbols map as follows:")
TABLE([["In the code", "Meaning"],
       ["`P`, `T`", "pressure (kbar), temperature (K) at which the equation is evaluated"],
       ["`ln`, `log10`", "natural and decimal logarithm"],
       ["`s.Grt.XAlm`, `XPrp`, `XGrs`, `XSps`", "garnet Fe, Mg, Ca, Mn/(Fe + Mg + Ca + Mn)"],
       ["`s.Grt.XCa_FMC`, `s.Grt.MgNo`", "garnet Ca/(Ca + Mg + Fe), Mg/(Mg + Fe)"],
       ["`s.Grt.cat`, `s.Cpx.cat`, `s.Opx.cat`", "cations per formula unit (12 O garnet; 6 O pyroxenes), including `Al_IV`, `Al_VI` for pyroxenes"],
       ["`s.Bt.XMg`", "Mg/(Mg + Fe) of biotite (22 O)"],
       ["`s.Pl.An`", "anorthite fraction Ca/(Ca + Na + K) of plagioclase"],
       ["`s.Ol.Fo`", "forsterite fraction of olivine"],
       ["`s.Sp.XFe2`, `XFe3`, `XAl`", "spinel Fe²⁺/(Fe²⁺ + Mg) and Fe³⁺ or Al/(Al + Cr + Fe³⁺), Droop Fe³⁺"],
       ["`s.Liq.p` (written `l`), `s.Liq.mf`", "melt cation fractions and oxide mole fractions of Putirka (2008, Table 1)"],
       ["`s.Liq.MgNo`, `s.Liq.H2O`, `s.Liq.CNM`, `s.Liq.NF`", "melt Mg#, H₂O (wt%), and the Beattie (1993) terms C_{NM} and NF"],
       ["`s.Liq.cf`, `liqWt(s, 'SiO2')`", "melt cation fractions over all oxides; melt oxide in wt%"],
       ["`s.Cpx.P.Jd`, `.CaTs`, `.CaTi`, `.CrCaTs`, `.DiHd`, `.EnFs`, `.AlVI`", "clinopyroxene components of Putirka (2008, Table 3)"],
       ["`s.Opx.P.NaAlSi2O6`, `.FmAl2SiO6`, `.Fm2Si2O6`, `.En`, `.Di`", "orthopyroxene components of Putirka (2008, Table 2)"],
       ["`s.Amp.c23`, `s.Amp.c13`", "amphibole cations on 23 O and on 13 cations"],
       ["`s.Kfs.Ab`, `s.Kfs.cf`", "alkali feldspar end-members and cation fractions"],
       ["`dMg(s)`, `anCaAlSi(s)`", "D_{Mg}^{ol/liq}; ln[An/(X_{Ca} X_{Al}² X_{Si}²)^{liq}]"],
       ["`p96(s)`, `rr(a, c)`", "terms of Putirka et al. (1996); weighted sum of amphibole cations (Ridolfi and Renzulli, 2012, Table 3)"],
       ["`aEn2site(c)`, `fe3Px(c)`", "two-site enstatite activity (Wood and Banno, 1973); pyroxene Fe³⁺ by charge balance"],
       ["`s.Trace.Ti_zrc`, `Zr_rt`, `Zr_ttn`, `Ti_qz` …", "trace-element concentrations (ppm) and activities aTiO₂, aSiO₂"],
       ["`kdGrtCpx(s)`", "(Fe/Mg)^{Grt}/(Fe/Mg)^{Cpx}; Cpx Fe²⁺ = total Fe or Lindsley Fe²⁺ (option)"],
       ["`breyOpxGrt(o, g)`", "orthopyroxene site occupancies and garnet fractions of Brey and Köhler (1990, Table 3)"],
       ["`gaspP(...)`", "GASP pressure from ΔG° and ΔV (Section 6, GASP)"],
       ["`zirconM(l)`", "zircon-saturation parameter M from melt cation fractions"]], [6.5, 10])

H1("6. Equation reference")
P(f"This chapter lists all {len(D['eqs'])} equations, grouped by system. For each equation the table gives its type, the phases required, the standard error of estimate reported by its authors, the calibration or validity range, whether it has a calibration-domain check, how it was verified and the original reference; the implemented expression follows. **Verification**: every equation was implemented from the original publication, checked coefficient by coefficient including variable definitions and units, and is covered by unit tests (Chapter 14).")
INTRO = {
 "grt_bt": "Fe–Mg exchange between garnet and biotite (Eq. 3.3). K_D = (Mg/Fe)^{Grt}/(Mg/Fe)^{Bt}. Ferry and Spear (1978) calibrated the reaction on synthetic almandine–pyrope garnet and annite–phlogopite biotite at 2.07 kbar, 550–800 °C. Their eq. 7, 12,454 − 4.662T + 0.057P(bar) + 3RT ln K = 0, rearranges to the form implemented. It applies to garnets poor in Ca and Mn (X_{Ca+Mn} < 0.2) and biotite poor in Ti and Al^{VI}; higher contents cause systematic errors.",
 "grt_cpx": "Fe²⁺–Mg exchange between garnet and clinopyroxene, the standard thermometer for eclogites and garnet granulites/pyroxenites. K_D = (Fe/Mg)^{Grt}/(Fe/Mg)^{Cpx}. Ca in garnet increases K_D at a given T (non-ideal Ca–Mg–Fe mixing), hence the X_{Ca} terms. Fe³⁺ in omphacite strongly affects K_D; by default all Cpx Fe is treated as Fe²⁺, optionally Fe³⁺ from charge balance (Lindsley, 1983). X_{Ca} is Ca/(Ca + Mg + Fe) for Ellis and Green (1979) and Powell (1985) and Ca/(Ca + Mn + Fe + Mg) for Krogh (1988) and Ravna (2000), as defined in the papers.",
 "grt_opx": "Fe–Mg exchange between garnet and orthopyroxene (Harley, 1984; X_{Ca} = Ca/(Ca + Mg + Fe) in garnet, R = 1.987 cal) and the Al-in-orthopyroxene barometer P_{BKN} of Brey and Köhler (1990, Table 3), based on the dissolution of the MgAl_{2}SiO_{6} component in Opx coexisting with garnet — the standard barometer for garnet peridotite xenoliths. P_{BKN} solves a quadratic in P; site occupancies are given in Section 4.3.",
 "gasp": "Net-transfer barometer (Eq. 3.4) for Ca-bearing metapelites with garnet, plagioclase, an Al_{2}SiO_{5} polymorph and quartz. LithoPT uses Koziol and Newton (1988): ΔG° (J; T in °C) = 141.59 T − 6788 with ΔV = −6.210 J bar⁻¹ (kyanite; their Appendix B), and −0.0009648 T² + 120.67 T − 130 with ΔV = −5.154 J bar⁻¹ (sillimanite; via the Ky–Sil curve of Holdaway, 1971). The pressure is P = [ΔG° + RT ln(a_{Grs}/a_{An}³)]/|ΔV|. Activities are a_{Grs} = (γ_{Grs}X_{Grs})³ and a_{An} = γ_{An}X_{An}; γ = 1 by default (ideal mixing). Real garnet and plagioclase are non-ideal; users should supply activity coefficients from a solution model — the result is very sensitive to them.",
 "two_px": "Two-pyroxene thermobarometry. Wood and Banno (1973) and Wells (1977) use the ideal two-site enstatite activities of Section 4.3; Putirka (2008) eqs 36–37 (thermometers) and 38–39 (barometers) are regressions of experiments, best for Mg#^{cpx} > 0.75 (the term X_{Di}^{cpx} of eq. 37 is not defined in the paper and is taken as DiHd·Mg/(Mg + Fe + Mn)). Brey and Köhler (1990) for mantle lherzolites: T_{BKN} (their eq. 9) from the transfer of enstatite between coexisting Cpx and Opx, calibrated on reversed experiments in a natural lherzolite (900–1400 °C, 10–60 kbar; ±15 °C); the Ca-in-Opx thermometer (eq. 10; ±19 °C on the natural-system experiments) and the Na-partitioning thermometer (eq. 11), which was fitted to natural garnet lherzolites and agrees with T_{BKN} to ±56 °C.",
 "ol_sp": "Olivine–spinel equilibria: Al-in-olivine thermometry for primitive magmas and peridotites (Wan et al., 2008; Coogan et al., 2014; both need precise Al_{2}O_{3} in olivine, e.g. by LA-ICP-MS or long-count microprobe analysis; k_{d} = Al_{2}O_{3}^{ol}/Al_{2}O_{3}^{sp} in wt%), and the olivine–orthopyroxene–spinel oxybarometer (Ballhaus et al., 1991), which requires Fe³⁺ in spinel from stoichiometry (Section 4.2) and assumes orthopyroxene saturation.",
 "cpx_liq": "Clinopyroxene–melt thermobarometry (Section 3.5), the most widely used method for magma storage conditions. Temperature equations use Jd–DiHd exchange and melt composition; barometers use jadeite formation (K_{Jd}). Putirka et al. (1996, 2003) and Putirka (2008) are global calibrations; Neave and Putirka (2017) is calibrated for 1 atm–20 kbar and is more precise within that range (its printed equation shows (X_{Na}X_{K})², whereas the authors' spreadsheet computes (X_{Na} + X_{K})², which LithoPT uses); Masotta et al. (2013) is specific to alkaline, differentiated (trachytic–phonolitic) melts, is implemented with the full-precision coefficients of the authors' spreadsheet and reproduces its worked examples. Equilibrium must be tested (Chapter 10).",
 "cpx_only": "Clinopyroxene-only barometers and thermometers for rocks without preserved melt: Putirka (2008) eq. 32a (P) and 32d (T), and Wang et al. (2021) eq. 1 (P). Their precision is lower and they implicitly assume melt compositions similar to those of the calibration experiments. For Wang et al. (2021), LithoPT uses the coefficients of the authors' calculation sheet; the intercept printed in the paper (23.00) differs from it (25.0019) and gives pressures about 2 kbar too low.",
 "opx_liq": "Orthopyroxene–melt equilibria (Putirka, 2008, eqs 28a, 29a, 29b; Beattie, 1993, eq. 11 with the measured D_{Mg}), used for andesitic–dacitic and some basaltic systems.",
 "opx_only": "Orthopyroxene-only barometer (Putirka, 2008, eq. 29c), requiring Cr in orthopyroxene.",
 "ol_liq": "Olivine–melt thermometry: the partition coefficient D_{Mg} = X_{Mg}^{ol}/X_{Mg}^{liq} decreases with temperature (Beattie, 1993, eq. 10 with his Table 2; Putirka, 2008, eqs 19, 21, 22). Melt H_{2}O lowers the temperature at given D_{Mg}. The Ca-in-olivine hygrometer of Gavrilenko et al. (2016) uses the decrease of D_{CaO} with melt water, with the melt normalised anhydrous and separate fits for low- and high-MgO melts.",
 "plag_liq": "Plagioclase–melt equilibria: An–Ab partitioning depends on T, P and strongly on melt H_{2}O. Putirka (2008) eqs 23 and 24a are thermometers, eq. 25a a barometer (which its author does not recommend outside well-studied compositions) and eq. 25b a hygrometer; Masotta and Mollo (2019) is a hygrometer for trachytic melts, which LithoPT reproduces on the authors' calibration data to 0.30 wt% (stated error 0.29 wt%).",
 "kfs_liq": "Alkali feldspar–melt thermometer (Putirka, 2008, eq. 24b) for evolved natural magmas below 1050 °C.",
 "two_fsp": "Two-feldspar (plagioclase–alkali feldspar) thermometry from albite partitioning with An corrections (Putirka, 2008, eqs 27a and 27b). Suitable for felsic volcanic and plutonic rocks with coexisting feldspars.",
 "amp_only": "Amphibole thermobarometry. Al-in-hornblende barometers (Hammarstrom and Zen, 1986; Hollister et al., 1987; Johnson and Rutherford, 1989; Schmidt, 1992; Anderson and Smith, 1995) apply only to granitoids crystallising the buffering assemblage quartz + plagioclase + K-feldspar + biotite + hornblende + titanite + Fe–Ti oxide near the solidus. Ridolfi et al. (2010), Ridolfi and Renzulli (2012) and Putirka (2016) are empirical amphibole-only equations for calc-alkaline and alkaline magmas; their pressures are debated and should be interpreted with care. LithoPT reproduces the Amp-TB spreadsheet of Ridolfi et al. (2010) and the worked example of Putirka (2016, Table 4). In Ridolfi and Renzulli (2012) pressures are in MPa, including the ln P term of their thermometer; the procedure they describe for choosing among eqs 1b–1e is not implemented, so all five are shown.",
 "grt_only": "Ni-in-garnet thermometers for peridotitic garnet xenocrysts (Section 3.10). Ryan et al. (1996) assume constant Ni in olivine; Canil (1999) and Sudholz et al. (2021) use D = Ni^{grt}/Ni^{ol} with the olivine Ni content set by the user (default 3000 ppm).",
 "trace": "Trace-element thermometers (Section 3.7). Ti-in-zircon (Watson et al., 2006; Ferry and Watson, 2007), Zr-in-rutile (Watson et al., 2006; Ferry and Watson, 2007; Tomkins et al., 2007 for the α-quartz, β-quartz and coesite fields), Zr-in-titanite (Hayden et al., 2008), Ti-in-biotite for graphitic metapelites (Henry et al., 2005) and Ti-in-quartz (Thomas et al., 2010; Huang and Audétat, 2012). Activities of TiO_{2} and SiO_{2} must be estimated when rutile or quartz is absent.",
 "liq_only": "Liquid-only equations (Sections 3.6, 3.8, 3.9): olivine-saturated MgO thermometers (Helz and Thornber, 1987; Montierth et al., 1995; Sugawara, 2000; Putirka, 2008, eqs 13–16; Shea et al., 2022), phase-saturation thermometers (clinopyroxene: Putirka, 1999, 2008; orthopyroxene, plagioclase and alkali feldspar: Putirka, 2008; amphibole: Molina et al., 2015), zircon and apatite saturation thermometers and the Kress and Carmichael (1991) melt oxybarometer, reported relative to the FMQ buffer of Frost (1991). They are valid only when the melt was saturated in the relevant phase and are therefore left out of model ensembles unless selected."}

KIND = {"T": "Thermometer (T in K for given P)", "P": "Barometer (P in kbar for given T)", "H2O": "Hygrometer (melt H₂O, wt%)", "fO2": "Oxybarometer (log units relative to FMQ)"}
DOM_OF = {eid: d["label"] for d in D["domains"].values() for eid in d["equations"]}
order = list(D["systems"].keys())
for si, sk in enumerate(order, 1):
    sysd = D["systems"][sk]
    eqs = [e for e in D["eqs"] if e["system"] == sk]
    H2(f"6.{si} {sysd['name']}")
    P(INTRO.get(sk, ""))
    P(f"Phases required: {', '.join(sysd['phases'])}. Equations: {len(eqs)}.")
    for e in eqs:
        H3(e["name"])
        ref = (f"https://doi.org/{e['doi']}" if e["doi"] else e.get("ref") or "")
        TABLE([["Identifier", f"`{e['id']}`"], ["Type", KIND[e["kind"]]], ["SEE (authors)", e["see"]], ["Calibration / validity", e["range"]],
               ["Calibration-domain check", DOM_OF.get(e["id"], "not available (calibration data not distributed)")],
               ["Verification", "checked against the original paper; unit-tested"],
               ["Reference", ref]], [4, 12.5], head=False, size=8.5)
        CODE(e["code"])

# ============================================================== 7 solver
H1("7. Coupled P–T solutions")
P("A thermometer returns T for an assumed P and a barometer P for an assumed T. The equilibrium P–T point is their intersection. LithoPT finds the root of")
EQ("*g*(*P*) = *P*_{eq}(*T*_{eq}(*P*)) − *P* = 0", "7.1")
P("by scanning *g* on 120 equal intervals between user bounds (default 0–70 kbar) for the first sign change, followed by bisection to 10⁻⁶ kbar. Fixed-point (Picard) iteration — alternately applying thermometer and barometer — converges only if the product of the slopes dT_{eq}/dP · dP_{eq}/dT is smaller than one in absolute value, i.e. it fails when the two curves intersect at a shallow angle; bisection has no such restriction. If *g* does not change sign within the bounds, LithoPT reports *no intersection* instead of returning a number. Equations that are independent of P or T (e.g. Al-in-hornblende) simply give flat or vertical curves.")
P("**Quality of the intersection.** Where two curves cross at a small angle, a small shift of either one moves the solution far. LithoPT computes the local slopes d*T*/d*P* of the thermometer and d*P*/d*T* of the barometer by central differences (±0.05 kbar, ±1 K), scales T and P by the standard errors of the two equations, and reports the angle between the curves in the scaled plane: **well-conditioned** at ≥ 30°, **oblique** at 15–30°, **grazing** below 15°. For a grazing intersection the Monte Carlo spread, not the published SEE, is the realistic error.")
P("The P–T diagram plots T_{eq}(P) (orange), P_{eq}(T) (blue), the solution, Monte Carlo points and 1σ/2σ ellipses, and optionally all model-ensemble solutions and reference gradients of 10, 20 and 35 °C/km from a 0 °C surface (for the density of the depth model). Moving the pointer over the diagram shows T, P and depth. *Export PNG* saves a 1400 × 1040 pixel image; *Export SVG* saves a vector drawing for illustration software.")

# ============================================================== 8 uncertainty
H1("8. Uncertainty: analytical, calibration and model choice")
H2("8.1 Analytical uncertainty (Monte Carlo)")
P("For each of *N* draws (default 1000), every oxide *x* of every phase is perturbed independently:")
EQ("*x*′ = max(0, *x* + σ *z*),   σ = max(*r x*, *f*),   *z* ~ N(0, 1)", "8.1")
P("with relative uncertainty *r* (default 2%) and absolute floor *f* (default 0.02 wt%) representing detection-limit-scale errors; trace elements are perturbed with the same relative σ; Fe³⁺/ΣFe and activities are held fixed. Mineral formulae and components are recomputed from the perturbed analyses and the coupled system is re-solved for every draw. Perturbing oxides (rather than derived end-member fractions) keeps compositions internally consistent and propagates errors correctly into ratios such as K_D. Normal deviates are generated by the Box–Muller transform, *z* = √(−2 ln *u*_{1}) cos(2π*u*_{2}), from a seeded 32-bit pseudo-random generator (mulberry32), so a simulation is exactly reproducible from its seed.")
P("Reported statistics: mean, median, 16th and 84th percentiles and standard deviation of T and P, their covariance and the correlation coefficient ρ = cov(T, P)/(σ_{T} σ_{P}), and the number of draws without an intersection. The ellipses are drawn from the eigen-decomposition of the covariance matrix at 1σ and 2σ. **Correlation matters**: for a garnet–biotite–GASP metapelite T and P are strongly correlated, so the true uncertainty region is a narrow ellipse, and quoting independent ±T and ±P overstates the area of uncertainty several-fold.")
H2("8.2 Calibration uncertainty")
P("Each equation has a standard error of estimate (SEE) reported by its authors, describing the scatter of calibration experiments about the regression. It is systematic for a given equation: averaging many analyses reduces analytical error but not calibration error. With the option *Also propagate calibration error*, every Monte Carlo draw adds Gaussian offsets δT ~ N(0, SEE_{T}) and δP ~ N(0, SEE_{P}) (or relative offsets for percentage SEEs) to the thermometer and barometer before solving, giving combined uncertainties.")
H2("8.3 Model-choice uncertainty (ensemble)")
P("The ensemble solves every thermometer–barometer pair whose phases are present (optionally restricted to selected systems), discards solutions outside physical limits (Chapter 10), and reports the median, 16th–84th percentiles and standard deviation of the solutions — for all pairs and for pairs in which neither equation is outside a known calibration domain. Three kinds of equation are left out unless requested: equations marked *pending*, calibrations restricted to particular magma types (the alkaline-only equations of Masotta et al., 2013), and the liquid-only saturation thermometers, which assume saturation in a phase that may be absent.")
e = RES["ensemble"]
P(f"**Test.** On {e['nExperiments']} clinopyroxene–liquid experiments compiled by Neave and Putirka (2017) as test data (P ≤ 30 kbar), {e['nThermometers']} thermometers and {e['nBarometers']} barometers give {len(e['pairs'])} pairs. Individual pairs reproduce experimental pressure with root-mean-square errors of {e['pairRange']['rmseP'][0]}–{e['pairRange']['rmseP'][1]} kbar and temperature with {e['pairRange']['rmseT'][0]:.0f}–{e['pairRange']['rmseT'][1]:.0f} °C. The ensemble median gives {e['ensembleMedian']['rmseP']} kbar and {e['ensembleMedian']['rmseT']:.0f} °C: as good as the best single pair for pressure, without having to know in advance which pair that is, but not for temperature, where the best thermometer is better than the median. The median spread between pairs for one sample is {e['medianSpread']['P']} kbar and {e['medianSpread']['T']:.0f} °C. The spread shows how much a result depends on the choice of equations; it is an additional, not a complete, measure of uncertainty. Many of these experiments were used to calibrate one or more of the equations, so the errors are not independent estimates of accuracy.")

H2("8.4 Interpretation report")
P("The *Interpretation report* card, below the results in the Calculator and in the P–T tab, writes the current calculation as a report that can be viewed, downloaded as Markdown or printed to PDF with the browser's print dialog. Its text is generated from the numbers by fixed rules. It contains:")
B(["**Summary**: the P–T solution in °C, K, kbar and GPa; depth for the chosen density; the apparent average gradient (°C/km and °C/GPa). For metamorphic systems the ratio T/P is classed as low (< 375 °C/GPa), intermediate or high (> 775 °C/GPa) T/P metamorphism (Brown and Johnson, 2018); for magmatic systems the depth is placed in the upper, middle or lower crust of a nominal 40 km section.",
   "**Compositions**: oxides and totals; cations per formula unit and Fe³⁺/ΣFe (Section 4.2); the components used by the equations; flags for totals outside the usual range and cation sums more than 0.03 apfu from the ideal; the Fe–Mg equilibrium tests (Chapter 10).",
   "**Equations**: for each equation its source, SEE, calibration range, type (Fe–Mg exchange, net-transfer, solvus, trace-element, melt saturation, mineral–melt or single-phase empirical) with what that type implies, and its calibration-domain status; then a table of every equation that can be evaluated.",
   "**Uncertainty**: two Monte Carlo runs with the settings of the P–T tab, analytical only and analytical plus calibration. With σ²_{total} ≈ σ²_{analytical} + σ²_{calibration} the report states which share of the variance of T and of P comes from each source, and interprets the correlation ρ.",
   "**Coupled solution**: the solver, the slopes and intersection angle (Section 7), and the model ensemble. When Fe–Mg exchange thermometers give a median more than 60 °C below that of other thermometers for the same sample, the report notes that this is the usual signature of exchange during cooling; agreement within 30 °C is noted as consistent with preserved peak compositions.",
   "**Diagram and sources**: the P–T diagram (in the PDF), the papers to cite and the share link that reproduces the calculation."])
P("Without a coupled solution the report covers the single-equation results at the assumed P or T and omits the depth, gradient and Monte Carlo sections.")

H1("9. Calibration-domain diagnostics")
P("An empirical equation is reliable only for compositions similar to those of its calibration experiments. For equations whose calibration datasets are openly available, LithoPT summarises each dataset by the mean vector **μ** and covariance **Σ** of the oxide compositions of the phases used (up to 21 variables) and computes, for an analysis **x**, the squared Mahalanobis distance")
EQ("*D*² = (**x** − **μ**)^{T} **Σ**_{λ}^{−1} (**x** − **μ**),   **Σ**_{λ} = (1 − λ)**Σ** + λ diag(**Σ**),  λ = 0.05", "9.1")
P("The Mahalanobis distance measures how many standard deviations a point lies from the centre of a multivariate distribution, taking correlations between oxides into account; the shrinkage λ stabilises the inversion of the covariance matrix. *D*² is compared with the 95th and 99th percentiles of the distances of the calibration data themselves, and each analysis is classified as **inside** (≤ 95th percentile), **marginal** (95th–99th) or **outside** (> 99th). Only the summary statistics (mean vector, precision matrix, percentiles) are distributed with the software.")
TABLE([["Calibration dataset", "n", "Variables", "D² 95th / 99th", "Equations"]] +
      [[d["label"], d["n"], len(d["features"]), f"{d['p95']:.1f} / {d['p99']:.1f}", ", ".join(d["equations"])] for d in D["domains"].values()], [6.5, 1.2, 1.8, 2.8, 3.2])
g, t = RES["domain"]["global_test"]["groups"], RES["domain"]["tholeiite_test"]["groups"]
P(f"**Test on independent data.** Neave and Putirka (2017) published, with their calibration experiments, test experiments that were not used in the calibration. Evaluating their barometer at the experimental temperature on the global test set, the root-mean-square error is {g['inside']['rmse']} kbar for the {g['inside']['n']} experiments inside the domain, {g['marginal']['rmse']} kbar for {g['marginal']['n']} marginal ones and {g['outside']['rmse']} kbar for the {g['outside']['n']} outside it (calibration data: {RES['domain']['calibration']['groups']['inside']['rmse']} kbar). On the smaller tholeiite test set, which is compositionally close to the calibration, the errors are {t['inside']['rmse']} kbar inside (n = {t['inside']['n']}) and {t['outside']['rmse']} kbar outside (n = {t['outside']['n']}), i.e. no worse outside. A result flagged *outside* should therefore not be trusted without independent support, but the flag is a warning about extrapolation, not a prediction of the error of an individual analysis; *inside* does not guarantee accuracy (other assumptions, such as equilibrium, must also hold).")
P("A summary is available at present only for the Neave and Putirka (2017) barometer, whose authors published their calibration dataset; for other equations the *Within calibration?* column shows a dash, and analyses should be compared with the calibration range stated in Chapter 6. Summaries are added as calibration datasets become available (`validation/make_domains.py`).")

H1("10. Equilibrium, input and plausibility tests")
TABLE([["Test", "Criterion", "Reference"],
       ["Olivine–liquid K_D(Fe–Mg)", "0.30 ± 0.03 (melt Fe²⁺ from Fe³⁺/ΣFe)", "Roeder and Emslie (1970)"],
       ["Clinopyroxene–liquid K_D(Fe–Mg)", "0.28 ± 0.08", "Putirka (2008)"],
       ["Orthopyroxene–liquid K_D(Fe–Mg)", "0.4805 − 0.3733 X_{Si}^{liq} ± 0.06", "Putirka (2008)"],
       ["Clinopyroxene–orthopyroxene K_D(Fe–Mg)", "1.09 ± 0.14", "Putirka (2008)"],
       ["Physical plausibility", "200–2200 °C; −2 to 150 kbar; 0–25 wt% H₂O; ±10 log units ΔFMQ", "LithoPT"],
       ["Input validation", "no negative or non-numeric values; phase not empty", "LithoPT"]], [5, 6.5, 5])
P("K_D tests compare the measured Fe–Mg exchange coefficient between two phases with the value expected at equilibrium. A failing test suggests that the mineral did not crystallise from the analysed melt (e.g. antecrysts, mixing, post-entrapment modification). Results that fail the plausibility limits (typically from compositions far outside the calibration, where a denominator approaches zero) are shown as *physically implausible* and excluded from batch outputs and ensembles.")

H1("11. Pressure-to-depth conversion")
P("Depth *z* = *P*/(ρ*g*) for a constant density ρ (default 2700 kg m⁻³) and *g* = 9.81 m s⁻²; 1 kbar corresponds to 3.8 km at 2700 kg m⁻³. Real crustal and mantle densities vary with depth, so the result is an approximation.")

H1("12. Batch processing")
P("A CSV file has one row per sample. Recognised columns:")
B(["`Sample`, `P_kbar` (pressure for thermometers), `T_C` (temperature for barometers).",
   "`Phase_Oxide`, with Phase ∈ {Grt, Bt, Cpx, Opx, Liq, Ol, Pl, Kfs, Amp, Sp} and Oxide ∈ {SiO2, TiO2, Al2O3, Cr2O3, FeOt, MnO, MgO, CaO, Na2O, K2O}; melts also `Liq_P2O5`, `Liq_H2O`, `Liq_Fe3Fet`, `Liq_Zr_ppm`; garnet also `Grt_Ni_ppm`.",
   "`Trace_Ti_zrc`, `Trace_Zr_rt`, `Trace_Zr_ttn`, `Trace_Ti_qz`, `Trace_Ti_bt_apfu`, `Trace_XMg_bt`, `Trace_aTiO2`, `Trace_aSiO2`."])
P("Unrecognised columns are listed rather than guessed; rows with non-numeric values in recognised columns are skipped with a message; missing P_kbar or T_C columns trigger a warning (0 kbar / 0 °C would be used). Every equation whose phases are present is evaluated; equilibrium tests are appended; implausible values are left blank. On export, text cells beginning with =, +, − or @ are prefixed with an apostrophe so that spreadsheet programs do not interpret them as formulas. Results can be exported as CSV. A template is available from the batch tab.")

# ============================================================== 13 reproducibility
P("**Other inputs.** Excel workbooks (.xlsx; the first worksheet, read in the browser with no external library; legacy .xls files are not read) and tables pasted with *Paste table* are accepted. A table with one analysis per row — oxide columns, optionally `Sample`, `Phase` or `Mineral`, `P_kbar` and `T_C` — is shown first as a preview: the mineral of each row is taken from the Phase column (common names and abbreviations are recognised) or estimated from its stoichiometry, with a confidence score, and can be changed or skipped. Rows with the same Sample name form one sample; several analyses of the same mineral are averaged. FeO, FeO* and FeOt are read as total iron; Fe₂O₃ is converted to FeO and added.")
P("**Stoichiometric mineral estimate.** For each candidate mineral the analysis is recalculated on that mineral's oxygen basis (12 O garnet, 6 O pyroxenes, 4 O olivine and spinel, 8 O feldspars, 11 O micas, 23 O amphibole, 3 O ilmenite) and compared with windows for Si, Al, the main cation groups, the cation sum and the analytical total. Each criterion scores 1 inside its window, falling to 0 half a window-width outside; the score is the mean of the minimum and the average. Analyses scoring below 0.85 for every mineral are treated as glass or whole rock. Glass cannot always be told from amphibole or pyroxene by stoichiometry alone, which is why the preview must be confirmed.")
P("Click a sample name in the results table to open that sample in the calculator. Columns such as `Point_ID`, `Analysis` or `Label` are read as the sample name, and oxide headers with units (`Al2O3_wt%`, `SiO2 (wt%)`, `FeO_tot`) are recognised.")
P("**Batch samples on the P–T diagram.** *Plot on P–T diagram* solves every sample with the thermometer–barometer pair selected in the P–T tab, or, where the sample lacks a phase of that pair, with its highest-ranked pair (Section 2.5). Each solution receives 200 Monte Carlo draws with the settings of the P–T tab, and is plotted as a numbered point with its 1σ ellipse; the pair used and the result are listed under *Batch solutions*. *Join samples in file order* draws a P–T path, for example from core to rim. Different samples may use different pairs, which the list states; for a path, give every sample the phases of one pair.")

H1("13. Reproducibility, privacy and offline use")
B(["**Share link**: the complete state (compositions, system, equations, options) is encoded in the URL fragment (#state=…). Fragments are never sent to the web server; only the recipient's browser reads them. Opening the link restores the calculation exactly.",
   "**JSON state**: *Save JSON* and *Load JSON* store and restore the same state as a file. On loading, only recognised phases and numeric fields are accepted.",
   "**Seeds**: Monte Carlo simulations are reproducible from the random seed shown in the interface.",
   "**Offline**: a service worker caches the application after the first visit; updates are fetched when online.",
   "**Last session**: when the page is closed or hidden, the current state is kept in this browser's local storage and restored on the next visit; a share link or an example replaces it.",
   "**Privacy**: all calculations run locally in the browser; no analyses are uploaded."])
H2("13.4 Scripting with Node.js")
CODE('''const L = require("./lithopt-core.js");
const sample = { Cpx: { SiO2: 52.4, Al2O3: 4.1, Cr2O3: 0.9, FeOt: 3.1, MgO: 16.2, CaO: 20.3, Na2O: 1.2 },
                 Opx: { SiO2: 56.8, Al2O3: 0.9, Cr2O3: 0.3, FeOt: 6.1, MgO: 34.1, CaO: 0.85, Na2O: 0.12 },
                 Grt: { SiO2: 41.9, Al2O3: 22.1, Cr2O3: 2.2, FeOt: 7.4, MnO: 0.35, MgO: 20.6, CaO: 5.1 } };
const s = L.prepare(sample);
L.evaluate("T_Brey1990", s, { P_kbar: 30 });                     // K
L.solvePT("T_Brey1990", "P_Brey1990", s, { Pmax: 70 });          // {T_K, P_kbar, converged}
L.monteCarloPT("T_Brey1990", "P_Brey1990", sample, { N: 1000, seed: 1, calibration: true, Pmax: 70 });
L.ensemblePT(sample, { systems: ["two_px", "grt_opx"], Pmax: 70 });''')

H1("14. Verification and validation")
P(f"**Checks against the papers.** All {len(D['eqs'])} equations were implemented from the printed equations of the original publications and compared coefficient by coefficient, including variable definitions and units. Unit tests (`test/core.test.js`) compare them with independently computed values, with the printed equation written out in full, or with worked examples and spreadsheets published by the authors: the liquid, orthopyroxene and clinopyroxene examples of Putirka (2008, Tables 1–3); the spreadsheet of Masotta et al. (2013), reproduced to 0.02 °C and 0.0005 kbar; the Amp-TB spreadsheet of Ridolfi et al. (2010); the worked amphibole example of Putirka (2016, Table 4); and the calibration data of Masotta and Mollo (2019) and Neave and Putirka (2017), reproduced with errors equal to those the authors state. Other tests cover the Droop (1987) routine, the solver, Monte Carlo reproducibility, input validation and plausibility limits; a randomised robustness test (`test/fuzz.js`) evaluates 3,000 random and degenerate compositions.")
P("**Independent cross-check.** Where another open implementation of an equation exists, it is run as an external reference: `validation/crosscheck_thermobar.py` runs a locally installed copy of Thermobar (Wieser et al., 2022) on 200 synthetic compositions per equation and `validation/crosscheck.js` compares the results. Of 80 equations compared, 71 agree to within 1.4 K, 0.5 kbar or 0.03 wt% H₂O (differences arise from molar masses) and 9 differ for reasons that were traced to the sources:")
TABLE([["Equation", "LithoPT follows", "Evidence"],
       ["Neave & Putirka (2017)", "(X_{Na} + X_{K})², not the printed (X_{Na}X_{K})²", "authors' spreadsheet; agrees with Thermobar"],
       ["Putirka (2008) eq. 29a", "NaAlSi₂O₆ = lesser of Al^{VI} and Na", "Putirka (2008), Table 2"],
       ["Putirka (2008) eq. 37", "X_{Di}^{cpx} = DiHd·Mg/(Mg + Fe + Mn)", "undefined in the paper; by analogy with X_{Di}^{opx}"],
       ["Ridolfi & Renzulli (2012) eq. 2", "ln P with P in MPa", "paper's Table 3; reproduces Putirka's (2016) example"],
       ["Ridolfi et al. (2010) eq. 4", "Al_{T} on 13 cations", "authors' Amp-TB spreadsheet"],
       ["Putirka (2016) Si-in-hornblende", "T = 1977 − 165 Si", "printed equation and worked example"],
       ["Gavrilenko et al. (2016)", "melt normalised anhydrous", "stated in the paper"],
       ["Beattie (1993) eq. 11", "measured D_{Mg}^{opx/liq}", "paper; predicted D_{Mg} agrees to 0.2 K"],
       ["Masotta & Mollo (2019)", "components as in the paper", "authors' calibration data reproduced to the stated error"],
       ["Wang et al. (2021) eq. 1", "intercept 25.0019 (paper prints 23.00)", "authors' calculation sheet; fits their 559 calibration experiments without bias"]], [4.6, 6.2, 5.7], size=8.5)
P("No Thermobar code or output is distributed with LithoPT.")
P("**Interface tests.** End-to-end tests drive the web application in Chromium, Firefox and WebKit (Safari) and require every displayed value, Monte Carlo statistic, share-link restoration and batch output to equal the engine result. All tests run with `npm test` and `npx playwright test`.")

H1("15. Good practice and limitations")
B(["Check equilibrium (K_D tests, textures, zoning) before interpreting mineral–melt results; use core or rim compositions consistently.",
   "Check that your compositions fall within the calibration range stated for each equation (Chapter 6), and the calibration-domain status where it is available; treat *outside* results as unreliable.",
   "Report analytical and calibration uncertainties separately, and the P–T correlation where a coupled solution is used; consider the model ensemble to show how much the result depends on the choice of equation.",
   "State which equation (identifier and reference), Fe³⁺ treatment, activity model (GASP) and assumed P or T you used.",
   "Al-in-hornblende barometers require the buffering granitoid assemblage and near-solidus conditions; amphibole-only pressures are contested.",
   "The GASP barometer with ideal activities (γ = 1) generally overestimates pressure; supply activity coefficients from a solution model.",
   "Trace-element thermometers require realistic a_{TiO₂} and a_{SiO₂} when rutile or quartz is absent.",
   "Liquid-only thermometers give the temperature of saturation in a phase; they are meaningful only if that phase was present.",
   "The advisor score and the interpretation report are fixed rules applied to the numbers. They do not replace petrographic evidence of equilibrium, and the report's text should be checked before it is quoted.",
   "Limitations: Fe³⁺ in biotite and amphibole is not estimated; GASP activity models are user-supplied; analytical errors are treated as independent and Gaussian; covariances of regression coefficients are not propagated; calibration-domain summaries exist for one dataset; the Cr-in-garnet barometer of Ryan et al. (1996), machine-learning thermobarometers and elastic (host–inclusion) barometry are not included."])

H1("16. Glossary")
GL = [
 ("Activity (a)", "The effective concentration of a component in a solution, a = X γ; equal to the mole fraction for ideal mixing."),
 ("Activity coefficient (γ)", "Factor describing deviation from ideal mixing; γ > 1 for positive deviations."),
 ("Al^{IV}, Al^{VI}", "Aluminium in tetrahedral (IV) and octahedral (VI) coordination."),
 ("Analytical total", "Sum of oxide weight percentages of an analysis; ~100% for anhydrous phases."),
 ("Anhydrous basis", "Composition recalculated without H₂O (sum of other oxides normalised)."),
 ("apfu", "Atoms per formula unit: number of cations in the mineral formula normalised to a fixed number of oxygens or cations."),
 ("Barometer", "Equilibrium whose composition depends mainly on pressure; used to estimate P at known T."),
 ("Box–Muller transform", "Method generating normally distributed random numbers from pairs of uniform random numbers."),
 ("Bisection", "Root-finding method that repeatedly halves an interval in which a function changes sign; always converges."),
 ("Calibration dataset", "The experiments (or natural samples) used to fit an empirical equation."),
 ("Calibration domain", "The compositional (and P–T) space covered by a calibration dataset; LithoPT measures it with the Mahalanobis distance."),
 ("Cation fraction", "Number of atoms of a cation divided by the total number of cations (anhydrous)."),
 ("Charge balance", "Condition that positive and negative charges in a mineral formula are equal; used to estimate Fe³⁺."),
 ("Correlation coefficient (ρ)", "cov(T, P)/(σ_T σ_P); ±1 perfect correlation, 0 none."),
 ("Covariance", "Measure of joint variability of two quantities."),
 ("Cr#", "Cr/(Cr + Al), molar."),
 ("D (partition coefficient)", "Concentration ratio of an element between two phases, e.g. D_Mg^{ol/liq}."),
 ("D²", "Squared Mahalanobis distance (Chapter 9)."),
 ("Droop (1987) method", "Estimation of Fe³⁺ from stoichiometry and charge balance (Section 4.2)."),
 ("Ensemble (model ensemble)", "Set of solutions from all compatible thermometer–barometer pairs; its spread measures model-choice uncertainty."),
 ("Equilibrium constant (K)", "Product of activities of products over reactants, each raised to its stoichiometric coefficient."),
 ("Exchange reaction", "Reaction exchanging two cations between phases, with small volume change; a good thermometer."),
 ("FeO_t", "Total iron expressed as FeO."),
 ("FMQ (QFM)", "Fayalite–magnetite–quartz oxygen buffer; ΔFMQ is log fO₂ relative to it."),
 ("fO₂", "Oxygen fugacity, the effective partial pressure of oxygen; describes the redox state."),
 ("GASP", "Garnet–Al₂SiO₅–plagioclase–quartz barometer."),
 ("Hygrometer", "Equation estimating melt water content."),
 ("K_D", "Distribution (exchange) coefficient, e.g. (Fe/Mg)^A/(Fe/Mg)^B."),
 ("K_D equilibrium test", "Comparison of measured and expected K_D to test whether two phases were in equilibrium."),
 ("kbar", "Kilobar; 1 kbar = 0.1 GPa ≈ 3.3–3.7 km of crust."),
 ("Mahalanobis distance", "Distance of a point from the mean of a multivariate distribution in units of standard deviation, accounting for correlations."),
 ("Mg#", "Mg/(Mg + Fe) molar (often ×100)."),
 ("Monte Carlo simulation", "Repeated calculation with randomly perturbed inputs to estimate output uncertainty."),
 ("Net-transfer reaction", "Reaction changing modal amounts of phases, usually with large ΔV; a good barometer."),
 ("Oxybarometer", "Equation estimating oxygen fugacity."),
 ("Plausibility limits", "Broad physical bounds outside which results are flagged."),
 ("RMSE", "Root-mean-square error between calculated and reference values."),
 ("Saturation thermometer", "Thermometer based on the solubility of a phase in a melt that is saturated in it."),
 ("SEE", "Standard error of estimate of a regression: scatter of calibration data about the fitted equation."),
 ("Seed", "Starting value of a pseudo-random number generator; the same seed gives the same Monte Carlo sample."),
 ("Solvus", "Miscibility gap between two coexisting phases of the same structure."),
 ("Standard state", "Reference state for thermodynamic properties; here the pure phase at P and T."),
 ("Structural formula", "Mineral formula expressed as cations per formula unit."),
 ("Thermometer", "Equilibrium whose composition depends mainly on temperature; used to estimate T at known P."),
 ("Trace-element thermometer", "Thermometer based on the temperature-dependent concentration of a trace element in a buffered mineral."),
 ("X_i", "Mole fraction of component i.")]
TABLE([["Term", "Definition"]] + [[a, b] for a, b in GL], [4.3, 12.2], size=9)

# ============================================================== 17 references
H1("17. References")
REFS = {}
for e in D["eqs"]:
    link = f"https://doi.org/{e['doi']}" if e["doi"] else e.get("ref", "")
    nm = re.split(r" eq\.| \(Ni|,? [A-Z][a-z]+[- ]in-| Talk| Palk| alk-| T_| P_BKN| Al-in| Ca-in| Na part| two-f| Opx| hygro| melt| Cr-| Ni-| MgO| CaO| Si-in| GASP| saturation| Δ| redox", e["name"])[0]
    m = re.search(r"[A-Z][^,]*\(\d{4}\)", e["name"])
    key = link or nm
    REFS.setdefault(key, set()).add(m.group(0) if m else nm)
P("Equation sources (with DOI):")
B([f"{'; '.join(sorted(names))} — {d}" for d, names in sorted(REFS.items(), key=lambda kv: sorted(kv[1])[0])])
P("Other works cited in this manual:")
B(["Brown, M., Johnson, T., 2018. Secular change in metamorphism and the onset of global plate tectonics. American Mineralogist 103, 181–196. https://doi.org/10.2138/am-2018-6166",
   "CIAAW (Commission on Isotopic Abundances and Atomic Weights), 2021. Standard atomic weights. https://www.ciaaw.org",
   "Droop, G.T.R., 1987. A general equation for estimating Fe³⁺ concentrations in ferromagnesian silicates and oxides from microprobe analyses, using stoichiometric criteria. Mineralogical Magazine 51, 431–435. https://doi.org/10.1180/minmag.1987.051.361.10",
   "Frost, B.R., 1991. Introduction to oxygen fugacity and its petrologic importance. Reviews in Mineralogy 25, 1–9.",
   "Holdaway, M.J., 1971. Stability of andalusite and the aluminum silicate phase diagram. American Journal of Science 271, 97–131.",
   "Leake, B.E., et al., 1997. Nomenclature of amphiboles. American Mineralogist 82, 1019–1037.",
   "Lindsley, D.H., 1983. Pyroxene thermometry. American Mineralogist 68, 477–493.",
   "Mahalanobis, P.C., 1936. On the generalised distance in statistics. Proceedings of the National Institute of Sciences of India 2, 49–55.",
   "Papike, J.J., Cameron, K.L., Baldwin, K., 1974. Amphiboles and pyroxenes: characterization of other than quadrilateral components and estimates of ferric iron from microprobe data. Geological Society of America Abstracts with Programs 6, 1053–1054.",
   "Roeder, P.L., Emslie, R.F., 1970. Olivine-liquid equilibrium. Contributions to Mineralogy and Petrology 29, 275–289. https://doi.org/10.1007/BF00371276",
   "Wieser, P.E., Petrelli, M., Lubbers, J., Wieser, E., Özaydın, S., Kent, A.J.R., Till, C.B., 2022. Thermobar: An open-source Python3 tool for thermobarometry and hygrometry. Volcanica 5, 349–384. https://doi.org/10.30909/vol.05.02.349384"])



cp = doc.core_properties; cp.author = cp.last_modified_by = "Kishan Tiwari"; cp.title = "LithoPT User Manual"
out = os.path.join(H, "..", "LithoPT_User_Manual.docx")
doc.save(out); print("saved", out)

# in-app reader: the manual body (title page and contents list are replaced by the app's own header and table of contents)
head = (f'<header class="m-title"><p class="m-kicker">User manual and scientific reference · version {VER}</p>'
        '<h1>LithoPT</h1><p>Browser-based thermobarometry with Monte Carlo and model-choice uncertainty</p>'
        '<p class="m-author">Kishan Tiwari · Department of Geology and Geophysics, Indian Institute of Technology Kharagpur · '
        '<a href="https://orcid.org/0000-0003-0014-914X" target="_blank" rel="noopener noreferrer">ORCID 0000-0003-0014-914X</a></p></header>')
with open(os.path.join(H, "manual.html"), "w", encoding="utf8") as f:
    f.write(f"<!-- generated by docs/build_manual.py; do not edit -->\n{head}\n" + "\n".join(HTML) + "\n")
with open(os.path.join(H, "glossary.json"), "w", encoding="utf8") as f:
    json.dump([{"term": mdh(a), "text": mdh(b)} for a, b in GL], f, ensure_ascii=False, indent=0)
print("saved docs/manual.html, docs/glossary.json")
