# Isometric Railway Sprite Workflow for React

## Objective

Convert painterly, side-on railway locomotive artwork into transparent isometric game sprites for a React/JavaScript railway game with a fixed isometric camera.

**Core principle:** do not rotate a side-view PNG to simulate a change in viewing direction. Generate separate views that show the locomotive from the required angle.

## Recommended pipeline

1. **Keep source artwork**
   - Retain the original side-view transparent PNG as a reference.
   - Keep an untouched master copy of each locomotive.

2. **Generate isometric views**
   - Use the source artwork as a visual reference.
   - Preserve the locomotive's identity: livery, boiler/body proportions, chimney, cab, tender, wheel arrangement and mechanical details.
   - Keep camera angle, lighting and painterly style consistent across the fleet.
   - Avoid mirroring where it would reverse markings or distinctive details.

3. **Prepare the assets**
   - Export PNGs with genuine alpha transparency.
   - Remove residual backgrounds and unwanted shadows.
   - Crop around the visible silhouette, while keeping a consistent canvas size.
   - Align wheels and track-contact points to a consistent anchor.
   - Check that no part of the train is clipped.

4. **Use the sprites in React**
   - Select the correct image for the train's current direction.
   - Place the sprite at its isometric map position.
   - Apply a consistent anchor offset and display scale.
   - Preload images; for a large fleet, consider a texture atlas or spritesheet.
   - Sort overlapping objects by depth so trains appear correctly in front of or behind scenery.

## Directional views

Start with **four directions**:

- `NE` — northeast
- `SE` — southeast
- `SW` — southwest
- `NW` — northwest

Expand to eight directions if the game needs smoother directional changes or more accurate views.

Generate each direction as a distinct view. Do not simply rotate the side-on image: rotation tilts the locomotive rather than changing the camera viewpoint.

## Asset specification

| Property | Recommendation |
|---|---|
| File format | PNG with genuine alpha transparency |
| Working resolution | 512 × 512 px or larger per sprite |
| Display size | Set according to map tile dimensions |
| Camera | Fixed isometric, orthographic-style perspective |
| Lighting | Consistent upper-left light source |
| Directions | Four initially; eight if required |
| Anchor | Consistent wheel/track contact point |
| Style | Detailed, painterly, slightly realistic |
| Background | Transparent, with no baked-in scenery |

Use a fixed canvas size even when locomotive lengths differ. Long locomotives can occupy more of the canvas, but their wheels must align to the same logical track plane.

## Example asset manifest

```js
export const locomotives = {
  pioneer: {
    name: "Pioneer",
    era: 1830,
    sprites: {
      NE: "/assets/trains/loco-001-ne.png",
      SE: "/assets/trains/loco-001-se.png",
      SW: "/assets/trains/loco-001-sw.png",
      NW: "/assets/trains/loco-001-nw.png",
    },
  },
};
```

## Simple React rendering example

```jsx
function TrainSprite({ train, direction, x, y, size = 128 }) {
  const src = train.sprites[direction];

  return (
    <img
      src={src}
      alt=""
      draggable={false}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        objectFit: "contain",
        pointerEvents: "none",
      }}
    />
  );
}
```

This is a starting example. The correct coordinate and anchor calculations depend on how the map tiles and train positions are represented. For a larger game, preload images and consider an atlas rather than creating a separate DOM image for every train.

## Isometric tile coordinates

For a conventional diamond-grid map with tile width `W` and tile height `H`, grid coordinates `(i, j)` can be converted to screen coordinates as follows:

```js
const x = (i - j) * (W / 2);
const y = (i + j) * (H / 2);
```

These coordinates locate the tile, not necessarily the sprite's top-left corner. Apply a consistent sprite anchor offset so the wheels sit on the track. Sort overlapping objects by depth position so trains interact visually with stations and scenery.

## Prototype before scaling up

Start with three locomotives:

1. An early steam engine.
2. A mid-century steam engine.
3. A modern diesel or bullet train.

Generate four directions for each. Test them on straight tracks and junctions, checking:

- Consistent angle, scale and lighting.
- Correct locomotive identity and details.
- Wheel alignment with tracks.
- No clipping or unwanted backgrounds.
- Correct depth ordering.
- Direction changes that look natural.

Once the prototype works, apply the same pipeline to the full 1830–2030 fleet.

## Recommended implementation choice

Keep image generation as an **asset-production step**, not a runtime operation. The game should load finished transparent PNGs and select the correct direction instantly.

If using PixiJS, see its sprite and spritesheet documentation:

- https://pixijs.com/7.x/guides/components/sprites
- https://pixijs.com/7.x/guides/components/sprite-sheets
