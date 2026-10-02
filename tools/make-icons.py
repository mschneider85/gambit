#!/usr/bin/env python3
"""Baut das App-Wappen (art/icons/icon.svg, maskable.svg, apple.svg) aus dem Fantasy-Springer (eingefärbt) und rendert die PNG-Icons."""
import os, re, subprocess, glob, tempfile
ROOT = os.path.join(os.path.dirname(__file__), '..')
# Springer aus dem Fantasy-Satz, in Elfenbein/Gold eingefärbt
knight = open(os.path.join(ROOT, 'art/src/icon-knight.svg')).read()
knight = knight.replace('stop-color="#fff"', 'stop-color="#fffaf0"').replace('stop-color="#bfd3d7"', 'stop-color="#e0bd74"').replace('stroke:#000', 'stroke:#2a1708')
inner = re.sub(r'^<svg[^>]*>', '', knight).rsplit('</svg>', 1)[0]
vb = re.search(r'viewBox="([^"]+)"', knight).group(1)

def crest(bg):
    shield = 'M256 28 L452 92 C452 280 380 410 256 484 C132 410 60 280 60 92 Z'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512">
<defs>
<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset=".45" stop-color="#e2b85a"/><stop offset="1" stop-color="#7a5212"/></linearGradient>
<radialGradient id="field" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="#5a2a3a"/><stop offset=".6" stop-color="#2a1020"/><stop offset="1" stop-color="#12060c"/></radialGradient>
</defs>
{bg}
<path d="{shield}" fill="url(#field)" stroke="url(#gold)" stroke-width="22" stroke-linejoin="round"/>
<path d="{shield}" fill="none" stroke="#2a1804" stroke-width="4" transform="translate(256 256) scale(.9) translate(-256 -256)" opacity=".7"/>
<g fill="url(#gold)" opacity=".9"><circle cx="256" cy="62" r="9"/><circle cx="118" cy="104" r="6"/><circle cx="394" cy="104" r="6"/></g>
<svg x="96" y="92" width="320" height="320" viewBox="{vb}">{inner}</svg>
</svg>'''

os.makedirs(os.path.join(ROOT, 'art/icons'), exist_ok=True)
open(os.path.join(ROOT, 'art/icons/icon.svg'), 'w').write(crest(''))
# Maskable: Vollfläche, Wappen in der sicheren Zone (80 %)
m = crest('<rect width="512" height="512" fill="#120d09"/>').replace('<path d="M256', '<g transform="translate(256 256) scale(.78) translate(-256 -256)"><path d="M256', 1)
m = m.replace('</svg>\n</svg>', '</svg></g>\n</svg>')
open(os.path.join(ROOT, 'art/icons/maskable.svg'), 'w').write(m)
# Apple (iPhone/iPad): iOS rundet die Ecken selbst ab und braucht einen undurchsichtigen Hintergrund –
# Wappen groß (88 %) auf dunklem Grund mit warmem Schein dahinter
glow = ('<defs><radialGradient id="bgl" cx=".5" cy=".45" r=".7"><stop offset="0" stop-color="#4a3218"/>'
        '<stop offset=".55" stop-color="#1f150c"/><stop offset="1" stop-color="#0d0805"/></radialGradient></defs>'
        '<rect width="512" height="512" fill="url(#bgl)"/>')
a_svg = crest(glow).replace('<path d="M256', '<g transform="translate(256 262) scale(.88) translate(-256 -256)"><path d="M256', 1)
a_svg = a_svg.replace('</svg>\n</svg>', '</svg></g>\n</svg>')
open(os.path.join(ROOT, 'art/icons/apple.svg'), 'w').write(a_svg)

chrome = sorted(glob.glob(os.path.expanduser('~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome')))[-1]
def render(svg, out, size, bg='transparent'):
    with tempfile.TemporaryDirectory() as d:
        html = os.path.join(d, 'p.html')
        open(html, 'w').write(f'<html><body style="margin:0;background:{bg}"><img src="file://{os.path.abspath(svg)}" style="width:{size}px;height:{size}px;display:block"></body></html>')
        subprocess.run([chrome, '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
                        '--default-background-color=00000000', f'--window-size={size},{size}', f'--screenshot={os.path.abspath(out)}', f'file://{html}'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
I = lambda n: os.path.join(ROOT, 'art/icons', n)
render(I('icon.svg'), I('icon-192.png'), 192)
render(I('icon.svg'), I('icon-512.png'), 512)
render(I('maskable.svg'), I('maskable-512.png'), 512)
render(I('apple.svg'), I('apple-touch-icon.png'), 180)  # iPhone
render(I('apple.svg'), I('apple-touch-icon-167.png'), 167)  # iPad Pro
render(I('apple.svg'), I('apple-touch-icon-152.png'), 152)  # iPad
render(I('icon.svg'), I('favicon-32.png'), 32)  # Safari-Tab (kennt kein SVG-Favicon)
print('fertig')
