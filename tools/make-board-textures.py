#!/usr/bin/env python3
"""Baut die Brett-Texturen art/boards/<thema>-light.webp / -dark.webp aus CC0-Materialfotos von ambientCG.

Jede Textur deckt das ganze Brett ab (CSS: 800 %); jedes Feld zeigt einen eigenen Ausschnitt (board.js),
so wirkt es wie einzeln zugeschnittene Hölzer bzw. Steine. Die dunklen Hölzer sind um 90° gedreht –
die Maserung läuft wie bei echten Intarsien quer zu den hellen Feldern. Helligkeit und Tönung sind so
angepasst, dass weiße und schwarze Figuren auf beiden Feldfarben gut zu sehen sind.

  python3 tools/make-board-textures.py   (lädt die Fotos von ambientCG, braucht Pillow)
"""
import io, os, urllib.request, zipfile
from PIL import Image, ImageEnhance

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'art/boards')
SIZE = 768

# Thema: (helles Material, dunkles Material) – je (ambientCG-ID, Drehung, Helligkeit, Sättigung, Tönung RGB[, Grundfarbe])
THEMES = {
    'walnut': (('Wood048', 0, 1.08, 0.95, None), ('Wood026', 90, 1.22, 0.95, None)),
    'moon': (('Marble021', 0, 0.98, 1.0, (238, 242, 250)), ('Marble012', 0, 0.82, 0.9, (150, 165, 195))),
    'emerald': (('Marble014', 0, 1.02, 0.9, None), ('Marble009', 0, 2.0, 1.1, (120, 200, 150), (62, 128, 92))),
}


def load(asset):
    url = f'https://ambientcg.com/get?file={asset}_1K-JPG.zip'
    data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})).read()
    z = zipfile.ZipFile(io.BytesIO(data))
    name = next(n for n in z.namelist() if n.endswith('_Color.jpg'))
    return Image.open(io.BytesIO(z.read(name))).convert('RGB')


def make(spec):
    asset, rot, bright, sat, tint, *base = spec
    im = load(asset)
    if rot:
        im = im.rotate(rot, expand=True)
    im = im.resize((SIZE, SIZE), Image.LANCZOS)
    im = ImageEnhance.Brightness(im).enhance(bright)
    im = ImageEnhance.Color(im).enhance(sat)
    if tint:
        # Tönung: Farbkanäle mit der Zielfarbe multiplizieren und zu 65 % untermischen
        r, g, b = im.split()
        tr, tg, tb = tint
        tinted = Image.merge('RGB', (r.point(lambda v: v * tr // 255), g.point(lambda v: v * tg // 255), b.point(lambda v: v * tb // 255)))
        im = Image.blend(im, tinted, 0.65)
    if base:
        # Sehr dunkles Material: auf eine mittlere Grundfarbe legen, damit schwarze Figuren sichtbar bleiben
        im = Image.blend(im, Image.new('RGB', im.size, base[0]), 0.5)
    return im


os.makedirs(OUT, exist_ok=True)
for theme, (light, dark) in THEMES.items():
    for kind, spec in (('light', light), ('dark', dark)):
        path = os.path.join(OUT, f'{theme}-{kind}.webp')
        make(spec).save(path, 'WEBP', quality=78, method=6)
        print(path, os.path.getsize(path) // 1024, 'KB')
