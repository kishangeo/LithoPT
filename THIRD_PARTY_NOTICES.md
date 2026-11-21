# Third-party notices

*LithoPT v4.2.3 · Kishan Tiwari (kishantiwari@iitkgp.ac.in)*

LithoPT contains no third-party source code or data.

- **Equations.** Every thermometer, barometer and oxybarometer is implemented directly from its original
  publication, which is cited with its DOI in the software and the user manual. Users must cite those
  publications for every equation they use.
- **Molar masses** are computed from the IUPAC (CIAAW) standard atomic weights.
- **Random numbers.** The seeded generator `mulberry32` is a short public-domain algorithm.

## Relation to Thermobar

Versions of LithoPT up to 3.2.0 (never publicly released) contained equations, component calculations and
calibration-domain summaries ported from Thermobar (Wieser et al., 2022, Volcanica 5, 349–384,
https://doi.org/10.30909/vol.05.02.349384). Version 4.0.0 removes all of that material: the engine was rewritten
from the original papers, and the Thermobar-derived calibration-domain summaries, benchmark data and example
analyses were deleted.

Thermobar is used only as an optional, independent reference in `validation/crosscheck_thermobar.py`, which
runs a locally installed copy on synthetic compositions; neither Thermobar nor its outputs are distributed with
LithoPT.