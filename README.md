# Design by Reduction: fabric-formed column simulator

An interactive simulator for the formwork principle in Belgian patent **BE1024818B1**
(*Bekisting voor het vervaardigen van een betonnen constructie*). The formwork is a flat
textile pattern that is cut, folded and stitched. Concrete pumped into it under pressure
inflates it, and the hardened concrete keeps that shape as a structural element.

This first module covers **columns**.

## Run

```bash
npm start            # serves the folder on http://localhost:8000
npm test             # headless physics checks (Node 18+)
```

No build step is needed. three.js is in `vendor/`, so the app works offline.
Open a preset directly with `?preset=Fluted`, `?preset=Mushroom`, and so on.

## Model

| Real world | Simulation |
|---|---|
| Woven textile: flexible, hardly stretches | Mesh of **tension-only** constraints. Edges can slacken or wrinkle but cannot get longer than in the flat pattern. Bias directions get a little extra give. |
| Wet concrete | Hydrostatic pressure `p = ρ·g·(fill − y)` normal to the cloth (ρ = 2400 kg/m³) |
| Base ring and top ring or scaffold | Pinned boundary rows |
| Tether stitches to a central cord (flutes, fig. 37) | Maximum radius along vertical stitch lines |
| Band or cord sewn around the tube | Maximum radius on one row |
| Sleeve guided over a rebar cage | Optional: each row is kept centred on the axis |
| Fabric self-weight (kg/m²) | Downward load, increased ×40 so it settles quickly. That is still under 1 cm of concrete head, so the filled shape does not change, but the unfilled sleeve hangs. Above the pour level the sleeve starts out flat-laid. |

The solver is position-based dynamics (Verlet integration and constraint projection).
For an inextensible membrane, the equilibrium shape does not depend on the absolute
pressure. The pressure distribution only decides which way the shape goes. Expect
about 3–4 % local strain at the boundaries, which is similar to real geotextile elongation.

## What it outputs

- Live 3D shape, coloured by pressure, by taut or slack fabric, or as cured concrete
- Concrete volume and mass, base pressure, fabric area, maximum strain
- **Cutting pattern as SVG at 1:1 scale in mm**: cut line with seam allowance, seam line,
  tether stitch lines, ring marks
- Shape as OBJ (for Rhino or FE tools) and parameters as JSON

## Code layout

- `src/sim.js`: physics core with no DOM (`ColumnSim`)
- `src/app.js`: UI, three.js view, 2D figures, exports
- `test/sim.test.js`: convergence and sanity checks for every preset family

## Next steps

- Real material: stiffness and bias behaviour taken from tensile tests of the textile used
- Pump pressure on top of hydrostatic head, and a staged pour (concrete stiffening by height)
- Inverse design: optimise the pattern so it matches a target profile
- Other families from the patent: mushroom-head grids and slabs, vaults (fig. 30–33), water-buffer tanks
