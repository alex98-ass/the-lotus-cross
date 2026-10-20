import os, math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = r'C:/Users/iulia/Desktop/TheLotusCross/server/public/img/shop'
GOLD = (196, 158, 62)
GOLD_LIGHT = (224, 190, 108)

def noise(size, amp=6):
    w, h = size
    n = Image.new('L', (w, h))
    px = n.load()
    random.seed(3)
    for y in range(h):
        for x in range(0, w, 1):
            px[x, y] = 128 + random.randint(-amp, amp)
    return n

def vignette(im, color=(0, 0, 0), strength=150, blur=170):
    w, h = im.size
    v = Image.new('L', (w, h), 255)
    d = ImageDraw.Draw(v)
    d.ellipse([-w * .25, -h * .3, w * 1.25, h * 1.25], fill=255 - strength)
    v = v.filter(ImageFilter.GaussianBlur(blur))
    return Image.composite(Image.new('RGB', (w, h), color), im, v)

def lotus_cross(d, cx, cy, r, color=GOLD):
    for i in range(8):
        a = math.radians(i * 45)
        px, py = cx + math.cos(a) * r * 0.78, cy + math.sin(a) * r * 0.78
        rr = r * 0.32
        d.ellipse([px - rr, py - rr, px + rr, py + rr], outline=color, width=max(2, int(r * 0.07)))
    w = r * 0.26
    d.rectangle([cx - w / 2, cy - r * 0.6, cx + w / 2, cy + r * 0.6], fill=color)
    d.rectangle([cx - r * 0.42, cy - w / 2, cx + r * 0.42, cy + w / 2], fill=color)

def triquetra(d, cx, cy, r, color=GOLD, width=5):
    for k in (-1, 1):
        for ang in (0, 120, 240):
            a = math.radians(ang)
            ox, oy = cx + math.cos(a) * r * 0.30 * k * 0 + math.cos(a + math.pi / 3) * r * 0.30, cy + math.sin(a + math.pi / 3) * r * 0.30
        # three overlapping circles
    offs = [(0, -0.30), (-0.26, 0.16), (0.26, 0.16)]
    for ox, oy in offs:
        x, y = cx + ox * r, cy + oy * r
        rr = r * 0.46
        d.arc([x - rr, y - rr, x + rr, y + rr], 0, 360, fill=color, width=width)

S = 1200

# 1 — the pocket mark: a brass disc on a cord, on dark linen
base = Image.new('RGB', (S, S), (26, 24, 27))
d = ImageDraw.Draw(base, 'RGBA')
for y in range(S):
    t = y / S
    d.line([(0, y), (S, y)], fill=(int(30 - 6 * t), int(28 - 6 * t), int(31 - 6 * t)))
for _ in range(26000):
    d.point((random.randrange(S), random.randrange(S)), fill=(255, 255, 255, random.randint(0, 12)))

# cord
sh = Image.new('L', (S, S), 0)
ImageDraw.Draw(sh).ellipse([300, 120, 900, 720], outline=90, width=9)
sh = sh.filter(ImageFilter.GaussianBlur(9))
base.paste(Image.new('RGB', (S, S), (0, 0, 0)), (0, 0), sh)

cd = ImageDraw.Draw(base, 'RGBA')
cd.ellipse([300, 120, 900, 720], outline=(58, 52, 44, 230), width=10)
cd.ellipse([300, 120, 900, 720], outline=(78, 70, 58, 120), width=3)

# disc shadow
ds = Image.new('L', (S, S), 0)
ImageDraw.Draw(ds).ellipse([452, 612, 748, 908], fill=120)
ds = ds.filter(ImageFilter.GaussianBlur(22))
base.paste(Image.new('RGB', (S, S), (0, 0, 0)), (0, 0), ds)

# disc
cd = ImageDraw.Draw(base, 'RGBA')
cx, cy, rr = 600, 760, 148
for i in range(28, 0, -1):
    f = i / 28
    c = (int(120 + 70 * f), int(96 + 62 * f), int(40 + 40 * f), 255)
    cd.ellipse([cx - rr * f, cy - rr * f, cx + rr * f, cy + rr * f], fill=c)
cd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=(232, 194, 112, 200), width=3)
cd.ellipse([cx - rr * 0.92, cy - rr * 0.92, cx + rr * 0.92, cy + rr * 0.92], outline=(120, 96, 44, 160), width=2)
lotus_cross(cd, cx, cy, 74, (48, 36, 16))
cd.ellipse([cx - 12, cy - rr - 6, cx + 12, cy - rr + 18], fill=(40, 34, 26, 255))
base = vignette(base, (10, 9, 10), 120, 190)
base.save(f'{OUT}/marks_pendant.jpg', quality=92, optimize=True)

# 2 — the knot, cast in stone
base = Image.new('RGB', (S, S), (206, 199, 186))
d = ImageDraw.Draw(base, 'RGBA')
for y in range(S):
    t = y / S
    d.line([(0, y), (S, y)], fill=(int(210 - 18 * t), int(203 - 18 * t), int(190 - 18 * t)))
for _ in range(60000):
    x, y = random.randrange(S), random.randrange(S)
    v = random.randint(-16, 16)
    d.point((x, y), fill=(max(0, 200 + v), max(0, 193 + v), max(0, 180 + v)))
# grooves
for _ in range(90):
    x1, y1 = random.randrange(S), random.randrange(S)
    x2, y2 = x1 + random.randint(-260, 260), y1 + random.randint(-260, 260)
    d.line([x1, y1, x2, y2], fill=(190, 183, 170, random.randint(20, 50)), width=random.choice([1, 1, 2]))
for _ in range(7000):
    d.point((random.randrange(S), random.randrange(S)), fill=(255, 255, 255, random.randint(0, 26)))

# sunken panel + engraved knot
ps = Image.new('L', (S, S), 0)
ImageDraw.Draw(ps).rounded_rectangle([140, 140, 1060, 1060], radius=28, fill=70)
ps = ps.filter(ImageFilter.GaussianBlur(16))
base.paste(Image.new('RGB', (S, S), (30, 28, 24)), (0, 0), ps)

d = ImageDraw.Draw(base, 'RGBA')
d.rounded_rectangle([140, 140, 1060, 1060], radius=28, outline=(186, 178, 163, 190), width=3)
triquetra(d, 600, 600, 330, (150, 128, 74, 235), 7)
triquetra(d, 600, 604, 330, (232, 226, 212, 120), 3)
base = vignette(base, (150, 143, 130), 90, 220)
base.save(f'{OUT}/marks_stone.jpg', quality=92, optimize=True)

# 3 — four marks, cards
base = Image.new('RGB', (S, S), (32, 30, 33))
d = ImageDraw.Draw(base, 'RGBA')
for y in range(S):
    t = y / S
    d.line([(0, y), (S, y)], fill=(int(38 - 8 * t), int(36 - 8 * t), int(39 - 8 * t)))
for _ in range(24000):
    d.point((random.randrange(S), random.randrange(S)), fill=(255, 255, 255, random.randint(0, 10)))

cards = []
for i, (rot, sym) in enumerate([(-9, 'cross'), (-3, 'knot'), (4, 'wheel'), (11, 'lotus')]):
    c = Image.new('RGBA', (420, 600), (0, 0, 0, 0))
    cd = ImageDraw.Draw(c, 'RGBA')
    cd.rounded_rectangle([0, 0, 419, 599], radius=6, fill=(247, 242, 231, 255))
    cd.rounded_rectangle([24, 24, 395, 575], radius=2, outline=(198, 168, 96, 190), width=2)
    if sym == 'cross':
        cd.rectangle([204, 200, 216, 400], fill=(150, 122, 52, 255))
        cd.rectangle([152, 250, 268, 262], fill=(150, 122, 52, 255))
    elif sym == 'knot':
        triquetra(cd, 210, 300, 118, (150, 122, 52, 255), 4)
    elif sym == 'wheel':
        cd.ellipse([106, 196, 314, 404], outline=(150, 122, 52, 255), width=5)
        for k in range(8):
            a = math.radians(k * 45)
            cd.line([210 + math.cos(a) * 20, 300 + math.sin(a) * 20,
                     210 + math.cos(a) * 96, 300 + math.sin(a) * 96], fill=(150, 122, 52, 255), width=4)
    else:
        lotus_cross(cd, 210, 300, 96, (150, 122, 52, 255))
    cards.append(c.rotate(rot, expand=True, resample=Image.BICUBIC))

order = [0, 3, 1, 2]
for k, idx in enumerate(order):
    c = cards[idx]
    x = 180 + k * 70
    y = 300 - (c.size[1] - 600) // 2
    sh = Image.new('L', (S, S), 0)
    ImageDraw.Draw(sh).rounded_rectangle([x + 8, y + 16, x + c.size[0] + 8, y + c.size[1] + 16], radius=6, fill=90)
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    base.paste(Image.new('RGB', (S, S), (0, 0, 0)), (0, 0), sh)
    base.paste(c, (x, y), c)

base = vignette(base, (8, 8, 9), 110, 200)
base.save(f'{OUT}/marks_cards.jpg', quality=92, optimize=True)
print('three mark images written')
