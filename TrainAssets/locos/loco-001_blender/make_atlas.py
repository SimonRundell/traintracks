"""
make_atlas.py

Builds the single 1024x1024 RGBA texture atlas for the streamlined Pacific model.

Layout (pixels, origin top left):
  - (0,0)      461x153  near side image, composited on a dark fill (fully opaque)
  - (464,0)    461x153  far side image, mirrored copy (fully opaque)
  - (932,0)    one column of 64x64 flat colour swatches
  - (0,170)    wheel crops that keep their alpha, so gaps between spokes are see through

Everything except the wheel crops has alpha 255, so the material can alpha clip
without punching holes in the body.

Licence: Creative Commons BY-NC-SA 4.0 International
https://creativecommons.org/licenses/by-nc-sa/4.0/

Usage:
  python make_atlas.py src.png pacific_atlas.png
"""
import sys
from PIL import Image, ImageOps

ATLAS = 1024
FAR_X0 = 464
SWATCH, SW_X0 = 64, 932
FILL = (22, 24, 26)

# Swatch index -> RGB. build_pacific.py uses the same indices.
SWATCHES = [
    (44, 78, 50),     # 0 green
    (22, 24, 26),     # 1 dark iron
    (178, 184, 190),  # 2 silver
    (28, 28, 30),     # 3 coal
    (190, 60, 30),    # 4 buffer red
    (110, 112, 118),  # 5 steel
]

# Wheel crops: key -> ((source centre x, centre y, half size), (atlas x, atlas y))
WHEELS = {
    "A": ((182, 116, 36), (0, 170)),
    "B": ((240, 116, 36), (76, 170)),
    "C": ((299, 116, 36), (152, 170)),
    "S": ((398, 135, 15), (228, 170)),
    "T": ((345, 135, 15), (262, 170)),
}


def bleed(img):
    """
    Give fully transparent pixels the dark fill colour instead of the white they carry,
    so bilinear filtering does not pull a light fringe into the wheel edges.

    @param {Image.Image} img RGBA crop.
    @returns {Image.Image} Crop with the same alpha and cleaned RGB.
    """
    px = img.load()
    for yy in range(img.height):
        for xx in range(img.width):
            if px[xx, yy][3] < 100:
                px[xx, yy] = FILL + (px[xx, yy][3],)
    return img


def main(src, dst):
    """
    @param {str} src Source side view (RGBA, transparent background).
    @param {str} dst Output atlas path.
    """
    img = Image.open(src).convert("RGBA")
    near = Image.new("RGBA", img.size, FILL + (255,))
    near.alpha_composite(img)
    far = ImageOps.mirror(near)
    atlas = Image.new("RGBA", (ATLAS, ATLAS), FILL + (255,))
    atlas.paste(near, (0, 0))
    atlas.paste(far, (FAR_X0, 0))
    for i, rgb in enumerate(SWATCHES):
        atlas.paste(Image.new("RGBA", (SWATCH, SWATCH), rgb + (255,)), (SW_X0, i * SWATCH))
    for (cx, cy, r), (ax, ay) in WHEELS.values():
        atlas.paste(bleed(img.crop((cx - r, cy - r, cx + r, cy + r))), (ax, ay))
    atlas.save(dst)
    print("wrote", dst, "source", img.size)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
