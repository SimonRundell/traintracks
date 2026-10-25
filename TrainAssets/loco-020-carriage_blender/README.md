# Mk3 InterCity carriage (low poly)

Low poly British Rail Mk3 carriage built in Blender from one side view photo
(`loco-20-carriage.png`), matching the technique used for the HST power car
in `loco-020_blender`.

## Files

- `mk3_carriage.blend`: finished model. Atlas texture is packed inside.
- `build_carriage.py`: rebuilds the .blend from scratch. Run
  `blender --background --python build_carriage.py`.
- `make_carriage_atlas.py`: builds `carriage_atlas.png` from the source photo
  (needs Pillow). Run `python make_carriage_atlas.py`.
- `carriage_atlas.png`: 1024x1024 RGBA atlas. Near side (downscaled photo),
  mirrored far side, and a row of flat colour swatches.
- `export_gltf.py`: exports `mk3_carriage.blend` to
  `public/models/carriage-020.glb`. Run
  `blender --background mk3_carriage.blend --python export_gltf.py`.
- `render_preview.py`: quick EEVEE render for visual QA.

## Model notes

- Metres, Z up, origin at the middle of the carriage on the rail. 23 m over
  buffers (real Mk3 length), 2.74 m wide body — the same width as the HST
  power car, so the fleet lines up visually.
- Length along Y. The carriage is end-to-end symmetric (no distinct front),
  so both ends round off the same way and the livery wraps identically.
- The body is a single lofted mesh with the real photo projected onto the
  +X/-X side faces (mirrored for the far side, since only one side of the
  carriage was photographed); roof, underframe, bogies, and buffers use flat
  colour swatches from the atlas.
- One material (`Carriage_Atlas`), 36 objects under an empty named
  `Mk3Carriage`, about 414 faces.

## Licence

Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0).

In short: you may copy, share and adapt the material in any format. You must credit the author and indicate changes. You may not use it commercially. If you remix or build on it, you must release your version under the same licence.

Full terms: https://creativecommons.org/licenses/by-nc-sa/4.0/

The texture comes from the side photo supplied by the author. Check you hold the right to reuse any third party artwork it contains.
