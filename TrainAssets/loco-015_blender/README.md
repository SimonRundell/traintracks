# Streamlined steam locomotive and tender (low poly)

Low poly streamlined Pacific with tender, built in Blender from one side view image.

## Files

- `streamlined_pacific.blend`: finished model. Atlas texture is packed inside.
- `build_pacific.py`: rebuilds the .blend from scratch. Run `blender --background --python build_pacific.py`.
- `make_atlas.py`: builds `pacific_atlas.png` from the side image (needs Pillow).
- `pacific_atlas.png`: 1024x1024 RGBA atlas. Near side, mirrored far side, colour swatches, five wheel crops.
- `pacific_preview.png`, `pacific_side_check.png`: Cycles renders.

## Model notes

- Metres, Z up, origin at the middle of the engine on the rail. Length is set to 21.3 m between buffers.
- Length along Y. The streamlined nose is the front, facing -Y. The source image sits on the -X side, so the Left view matches the picture. The +X side uses a mirrored copy.
- Tender, coal, cab and the streamlined casing are lofted through cross sections that follow the silhouette. The side image is projected onto them.
- Wheels are thin discs. Their texture keeps the source alpha, so gaps between the spokes are see through. The material uses a Round node, so glTF export gives alphaMode MASK.
- One material (`Pacific_Atlas`), 50 objects under an empty named `StreamlinedPacific`, about 850 faces. Camera and sun sit in `Preview_NotExported`.
- Proportions follow the drawing, which is squat for a real engine. At 21.3 m long the driving wheels come out about 3 m across. Change `M` at the top of `build_pacific.py` to rescale (for example 14.1 / 448 gives 2 m wheels).
- Front, rear and top detail is approximated, as a side view carries none.

## Licence

Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0).

In short: you may copy, share and adapt the material in any format. You must credit the author and indicate changes. You may not use it commercially. If you remix or build on it, you must release your version under the same licence.

Full terms: https://creativecommons.org/licenses/by-nc-sa/4.0/

The texture comes from the side image supplied by the author. Check you hold the right to reuse any third party artwork it contains.
