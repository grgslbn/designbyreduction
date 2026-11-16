# Design by Reduction: fabric-formed column simulator

An interactive simulator for the formwork principle in Belgian patent **BE1024818B1**
(*Bekisting voor het vervaardigen van een betonnen constructie*). The formwork is a flat
textile pattern that is cut, folded and stitched. Concrete pumped into it under pressure
inflates it, and the hardened concrete keeps that shape as a structural element.

Four modules:

- **Single column** (`index.html`): one column from a flat pattern, with flutes, bands, a capital, and so on.
- **Grid system** (`grid.html`): the rain-water buffer tank from figs. 1–8, with bottle-shaped columns 17 and necks 19, base tubes 21 linking the feet, an optional perimeter wall of cylinders 20, and soffit panels 27 that sag under the top slab 3. Each part type is simulated once and repeated across the layout. Contact between neighbouring parts is not modelled yet.
- **Shape catalogue** (`catalogue.html`): one simulated recipe per production family, each with its cut pattern, production steps and a measured readout:
  - A: pillow block, quilted slab, ribbed slab whose ribs are deepest at mid-span, perforated screen, taped truss beam (from the film prototype)
  - B: twisted fluted column
  - C: arch rib made from a darted tube
  - E: Y-branch tree column
  - F: beam with moment-shaped depth, hanging shell (inverted)
  - H: wall panel on a casting board
  - I (invented): hang, fill, flip funicular arch; spacer-fabric plank with graded depth; programmable curvature disc
- **V truss deck** (`deck.html`): one big double sheet taped with Warren truss webs and folded like a concertina along shared chords. Unfolded, the webs lean alternately, giving a space-truss deck (for example 8 × 20 × 1 m). One V module is simulated with symmetry planes standing in for its neighbours, then repeated over the footprint.

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
- `src/membrane.js`: generic tension-only membrane, with builders for vertical and horizontal tubes, sag panels and bottle profiles
- `src/system.js`: grid system layout, volumes, cut list (`GridSystem`)
- `src/grid-app.js`: UI for the grid page
- `src/engine.js`: general production-based fabric engine. Optional bending stiffness per piece: dihedral bending plus links that resist compression, applied to the stiff glued or taped areas only. Pieces (cut) and seams (sew, stitch, tack, glue) are merged with union-find; it also handles holes (cut out), cords (tethers), pins (rings, rails, boards), and hydrostatic or draped-weight loads
- `src/recipes.js`: catalogue recipes, cut pattern SVG
- `src/catalogue-app.js`: UI for the catalogue
- `src/app.js`: UI, three.js view, 2D figures, exports
- `test/sim.test.js`: convergence and sanity checks for every preset family

## Next steps

- Real material: stiffness and bias behaviour taken from tensile tests of the textile used
- Pump pressure on top of hydrostatic head, and a staged pour (concrete stiffening by height)
- Inverse design: optimise the pattern so it matches a target profile
- Other families from the patent: mushroom-head grids and slabs, vaults (fig. 30–33), water-buffer tanks

## Findings from the catalogue

- **Thickness follows width, but the ratio depends on the cell's proportions.** A long two-layer cell comes out at about 0.55 × its width (close to a round section). Square cells come out flatter.
- **A panel cast on a board needs fullness.** If the back layer is held flat, a front layer cut to the same size cannot bulge at all. Cut the front larger (about 10–15 %) and ease it in at the stitch lines.
- **Flanges inflate too.** In a ribbed slab, the wide channels between ribs swell unless they get their own extra stitch lines.
- **Darted tube curvature** follows κ ≈ k / (2r(1 − k/2)), where k is the share of cloth taken out on the inner side and r the tube radius. The simulation agrees within a few %.

## Findings from the V truss deck

- **A concrete-filled V cannot stand by itself during the pour.** At about 0.25 m of pump head the top chords slump to about 0.26 m (from 1 m). It stands at 0.82 m with 6 m of head, and at 0.98 m when the top chords hang from rails or cables. Wet concrete in a leaning bag needs a pressure at the top well above its own height.
- **The webs push apart** by about 37 % unless the bottom chords are tied or pegged.
- **Shortening against round diagonals.** Free ends let the deck shorten by about 17 % (about 3.4 m over 20 m), and the diagonals inflate fully. Held ends keep the length but leave the diagonals flat (6 cm instead of about 13 cm). Cut the sheet longer, or accept flatter diagonals.
- **Air cushions as bracing.** Sealing the triangles as air cushions, two fluids in one sheet, helps the V stand without rails: apex 0.22 m with no air, 0.52 m at 30 kPa, 0.84 m at 60 kPa. Above the concrete pressure, though, the cushions squash the concrete diagonals flat (2 cm), so there is a pressure window to find.

## Findings with bending stiffness

- **Glued and taped areas must resist being squeezed, not just bent.** With pull-only edges a glued area can shrink in its own plane at zero cost, and nothing buckles.
- **The taped truss twists more** when its triangles are stiff: 7 cm instead of 3 cm out of plane, closer to the film prototype. Held between end boards it stays flat (1 cm).
- **A radial-channel disc twists into a pinwheel instead of a dome.** The stiff wedges rotate like a camera shutter, with the inflated channels acting as hinges. Making a dome requires blocking that rotation.

## Findings: bending and staged pours on the V deck

- **Stiff taped triangles barely brace the V.** At stiffness 0.5 the apex goes from 0.22 to 0.25 m. Taped film is far too weak against wet concrete.
- **A staged pour does not stop the slump.** The empty cloth above each lift has nothing holding it up, and each lift sets in the slumped shape (apex 0.20 m).
- **With rails, lifts are useful.** The deck stands (0.98 m), and 0.25 m lifts cut the peak pressure on the cloth from about 29 to about 12 kPa, which allows a lighter fabric and weaker seams. That matters most for tall elements.
- **Set lifts fight fresh ones when the ends are free.** Each lift shortens as it fills, but the set lift below holds it back (strain about 12 %). Hold the ends during a staged pour.
- **Conclusion:** the V deck needs its top chords supported during the pour (rails, cables, or a top pressure of several metres of head). Bending stiffness and lifts don't replace that.
