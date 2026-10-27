"""
make_carriage_atlas.py

Builds the single 1024x1024 RGBA texture atlas for the Mk3 InterCity carriage,
from one side view photo (loco-20-carriage.png), the same technique used for
the HST power car's atlas.

Layout (pixels, origin top left), matching build_carriage.py's livery_uv:
  - (0, 0)    1024 x ~341  near side, downscaled from the source photo
  - (0, 350)  1024 x ~341  far side, mirrored copy
  - (0, 700)  one row of 64x64 flat colour swatches

Licence: Creative Commons BY-NC-SA 4.0 International
https://creativecommons.org/licenses/by-nc-sa/4.0/

Usage:
  python make_carriage_atlas.py
"""
import os

from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(HERE), "loco-20-carriage.png")
DST = os.path.join(HERE, "carriage_atlas.png")

ATLAS_W, ATLAS_H = 1024, 1024
FAR_ROW_OFFSET = 350
SWATCH, SWATCH_Y0 = 64, 700
FILL = (20, 22, 26)

# Swatch index -> RGB. build_carriage.py uses the same indices as build_hst.py.
YELLOW, DARK, GLASS, ROOF, STEEL, RED, CREAM = range(7)
SWATCHES = [
    (232, 178, 58),    # 0 YELLOW cantrail stripe
    (28, 32, 38),      # 1 DARK body/underframe
    (40, 60, 70),      # 2 GLASS (unused, kept for index parity with the HST atlas)
    (24, 26, 30),      # 3 ROOF
    (150, 152, 156),   # 4 STEEL
    (209, 24, 24),     # 5 RED stripe
    (232, 230, 224),   # 6 CREAM/white band
]


def main():
    """
    Reads the source side photo, builds the near/far/swatch atlas and saves it.

    @returns {None}
    """
    img = Image.open(SRC).convert("RGBA")
    scale = ATLAS_W / img.width
    near = img.resize((ATLAS_W, round(img.height * scale)), Image.LANCZOS)
    far = ImageOps.mirror(near)

    atlas = Image.new("RGBA", (ATLAS_W, ATLAS_H), FILL + (255,))

    near_opaque = Image.new("RGBA", near.size, FILL + (255,))
    near_opaque.alpha_composite(near)
    atlas.paste(near_opaque, (0, 0))

    far_opaque = Image.new("RGBA", far.size, FILL + (255,))
    far_opaque.alpha_composite(far)
    atlas.paste(far_opaque, (0, FAR_ROW_OFFSET))

    for i, rgb in enumerate(SWATCHES):
        atlas.paste(Image.new("RGBA", (SWATCH, SWATCH), rgb + (255,)), (i * SWATCH, SWATCH_Y0))

    atlas.save(DST)
    print("wrote", DST, "near size", near.size)


if __name__ == "__main__":
    main()
