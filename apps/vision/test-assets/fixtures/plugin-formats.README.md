# Independent plug-in format fixtures

These tiny images were generated for the tests, with no external artwork.
They contain two rows of red, green, blue, white / black, yellow, cyan, magenta.

- `pillow-rgba.jp2`: Pillow 12.2.0 with native OpenJPEG, lossless RGBA;
  the first row's alpha values are 255, 128, 64, 0 and the second row is opaque.
- `imagemagick-rgb.dpx`: ImageMagick 7.1.2-23, 16-bit RGB.
- `imagemagick-rgb.cin`: ImageMagick 7.1.2-23, 10-bit RGB, values kept in log space.

Regenerate from the repository root (requires Pillow and ImageMagick):

```sh
python3 - <<'PY'
from pathlib import Path
from PIL import Image
out = Path('apps/vision/test-assets/fixtures')
img = Image.new('RGBA', (4, 2))
img.putdata([(255,0,0,255),(0,255,0,128),(0,0,255,64),(255,255,255,0),
             (0,0,0,255),(255,255,0,255),(0,255,255,255),(255,0,255,255)])
img.save(out/'pillow-rgba.jp2', irreversible=False)
img.convert('RGB').save('/tmp/monet-plugin-colors.ppm')
PY
magick /tmp/monet-plugin-colors.ppm -depth 16 apps/vision/test-assets/fixtures/imagemagick-rgb.dpx
magick /tmp/monet-plugin-colors.ppm -set colorspace Log -depth 10 apps/vision/test-assets/fixtures/imagemagick-rgb.cin
```
