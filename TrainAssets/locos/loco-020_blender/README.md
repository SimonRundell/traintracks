# Early steam locomotive (low poly)

Low poly early steam locomotive built in Blender from one side view image.

## Files

- `early_loco.blend`: finished model. Atlas texture is packed inside.
- `build_loco.py`: rebuilds the .blend from scratch. Run `blender --background --python build_loco.py`.
- `make_atlas.py`: builds `loco_atlas.png` from the side image (needs Pillow).
- `loco_atlas.png`: 1024x1024 RGBA atlas. Near side, mirrored far side, colour swatches, three wheel crops.
- `loco_preview.png`, `loco_side_check.png`: Cycles renders.

## Model notes

- Metres, Z up, origin at the middle of the engine on the rail. About 5 m long and 5 m tall to the chimney top, as drawn.
- Length along Y. The chimney end is the front, facing -Y. The source image sits on the -X side, so the Left view matches the picture. The +X side uses a mirrored copy.
- Boiler, smokebox, chimney, dome, standpipe and rear column are revolved low poly solids with the side image projected onto them. Frame, cab and rods are boxes and bars.
- Wheels are thin discs. Their texture keeps the source alpha, so the gaps between the spokes are see through. The material uses a Round node, so glTF export gives alphaMode MASK.
- One material (`Loco_Atlas`), 27 objects under an empty named `EarlyLoco`, about 580 faces. Camera and sun sit in `Preview_NotExported`.
- Front and rear views are approximated, as a side view carries no detail for them. The smokebox door is a plain steel boss and the cab is an open-backed box.

## Licence

Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0).

In short: you may copy, share and adapt the material in any format. You must credit the author and indicate changes. You may not use it commercially. If you remix or build on it, you must release your version under the same licence.

Full terms: https://creativecommons.org/licenses/by-nc-sa/4.0/

The texture comes from the side image supplied by the author. Check you hold the right to reuse any third party artwork it contains.
