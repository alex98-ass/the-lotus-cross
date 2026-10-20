import os, math, random
from PIL import Image, ImageDraw, ImageFilter

OUT = r'C:/Users/iulia/Desktop/TheLotusCross/server/public/img/shop'
GOLDLINE = (172, 140, 62, 255)
S = 1200

def lotus_cross(d, cx, cy, r, color=GOLDLINE, w=None):
    w = w or max(2, int(r * 0.055))
    for i in range(8):
        a = math.radians(i * 45)
        px, py = cx + math.cos(a) * r * 0.78, cy + math.sin(a) * r * 0.78
        rr = r * 0.31
        d.ellipse([px - rr, py - rr, px + rr, py + rr], outline=color, width=w)
    k = r * 0.24
    d.rectangle([cx - k / 2, cy - r * 0.6, cx + k / 2, cy + r * 0.6], fill=color)
    d.rectangle([cx - r * 0.42, cy - k / 2, cx + r * 0.42, cy + k / 2], fill=color)

def triquetra(d, cx, cy, r, color=GOLDLINE, width=4):
    for ox, oy in [(0, -0.30), (-0.26, 0.16), (0.26, 0.16)]:
        x, y = cx + ox * r, cy + oy * r
        rr = r * 0.46
        d.arc([x - rr, y - rr, x + rr, y + rr], 0, 360, fill=color, width=width)

def wheel(d, cx, cy, r, color=GOLDLINE):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=5)
    for k in range(8):
        a = math.radians(k * 45)
        d.line([cx + math.cos(a) * r * 0.22, cy + math.sin(a) * r * 0.22,
                cx + math.cos(a) * r * 0.94, cy + math.sin(a) * r * 0.94], fill=color, width=4)

def card(w, h, sym, paper=(247, 242, 231)):
    c = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    cd = ImageDraw.Draw(c, 'RGBA')
    cd.rounded_rectangle([0, 0, w - 1, h - 1], radius=8, fill=paper + (255,))
    cd.rounded_rectangle([int(w * .055), int(w * .055), w - int(w * .055), h - int(w * .055)],
                         radius=2, outline=(198, 168, 96, 175), width=2)
    cx, cy = w // 2, h // 2
    r = min(w, h) * 0.24
    if sym == 'cross':
        cd.rectangle([cx - 8, cy - 78, cx + 8, cy + 78], fill=GOLDLINE)
        cd.rectangle([cx - 52, cy - 26, cx + 52, cy - 10], fill=GOLDLINE)
    elif sym == 'knot':
        triquetra(cd, cx, cy, r * 1.5, GOLDLINE, 4)
    elif sym == 'wheel':
        wheel(cd, cx, cy, r * 1.3, GOLDLINE)
    else:
        lotus_cross(cd, cx, cy, r * 1.35, GOLDLINE)
    return c

# ---------- one card, the pocket mark ----------
base = Image.new('RGB', (S, S), (33, 31, 34))
d = ImageDraw.Draw(base, 'RGBA')
for y in range(S):
    t = y / S
    d.line([(0, y), (S, y)], fill=(int(40 - 9 * t), int(38 - 9 * t), int(41 - 9 * t)))
for _ in range(24000):
    d.point((random.randrange(S), random.randrange(S)), fill=(255, 255, 255, random.randint(0, 10)))

c = card(520, 740, 'lotus')
c = c.rotate(-7, expand=True, resample=Image.BICUBIC)
x, y = (S - c.size[0]) // 2, (S - c.size[1]) // 2
sh = Image.new('L', (S, S), 0)
ImageDraw.Draw(sh).rounded_rectangle([x + 14, y + 22, x + c.size[0] + 14, y + c.size[1] + 22], radius=10, fill=105)
sh = sh.filter(ImageFilter.GaussianBlur(18))
base.paste(Image.new('RGB', (S, S), (0, 0, 0)), (0, 0), sh)
base.paste(c, (x, y), c)

v = Image.new('L', (S, S), 255)
ImageDraw.Draw(v).ellipse([-S * .25, -S * .3, S * 1.25, S * 1.25], fill=105)
v = v.filter(ImageFilter.GaussianBlur(190))
base = Image.composite(Image.new('RGB', (S, S), (9, 9, 10)), base, v)
base.save(f'{OUT}/marks_pocket.jpg', quality=93, optimize=True)

# ---------- the printable sheet (A4, four marks) ----------
W, H = 940, 1330
sheet = Image.new('RGB', (W, H), (250, 247, 240))
sd = ImageDraw.Draw(sheet, 'RGBA')
sd.rectangle([40, 40, W - 40, H - 40], outline=(198, 168, 96, 120), width=2)
for i, sym in enumerate(['cross', 'knot', 'wheel', 'lotus']):
    cw, ch = 330, 470
    cx = 40 + (i % 2) * (cw + 60) + 60
    cy = 90 + (i // 2) * (ch + 90)
    cc = card(cw, ch, sym)
    sd.rounded_rectangle([cx, cy, cx + cw, cy + ch], radius=8, fill=(255, 253, 248, 255),
                         outline=(214, 204, 182, 255), width=1)
    sheet.paste(cc, (cx, cy), cc)
    names = ['the cross', 'the knot', 'the wheel', 'the lotus']
    sd.text((cx + 12, cy + ch + 22), names[i], font=None, fill=(120, 112, 96))

# photographed: place the sheet on a warm surface with shadow
bg = Image.new('RGB', (S, S), (226, 219, 205))
bd = ImageDraw.Draw(bg, 'RGBA')
for y in range(S):
    t = y / S
    bd.line([(0, y), (S, y)], fill=(int(230 - 14 * t), int(223 - 14 * t), int(209 - 14 * t)))
for _ in range(30000):
    bd.point((random.randrange(S), random.randrange(S)), fill=(255, 255, 255, random.randint(0, 16)))

sw = 760
sh_h = int(H * sw / W)
small = sheet.resize((sw, sh_h), Image.LANCZOS).rotate(-4, expand=True, resample=Image.BICUBIC)
sx, sy = (S - small.size[0]) // 2, (S - small.size[1]) // 2
sh = Image.new('L', (S, S), 0)
ImageDraw.Draw(sh).rectangle([sx + 18, sy + 26, sx + small.size[0] + 18, sy + small.size[1] + 26], fill=95)
sh = sh.filter(ImageFilter.GaussianBlur(20))
bg.paste(Image.new('RGB', (S, S), (70, 62, 46)), (0, 0), sh)
bg.paste(small.convert('RGBA'), (sx, sy), small.convert('RGBA'))
v = Image.new('L', (S, S), 255)
ImageDraw.Draw(v).ellipse([-S * .3, -S * .3, S * 1.3, S * 1.3], fill=150)
v = v.filter(ImageFilter.GaussianBlur(200))
bg = Image.composite(Image.new('RGB', (S, S), (150, 143, 128)), bg, v)
bg.save(f'{OUT}/marks_sheet.jpg', quality=93, optimize=True)
print('pocket + sheet images written')
