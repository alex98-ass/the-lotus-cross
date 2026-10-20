import re, io

# ---------- 1. new practices: reading the guide, one step at a time ----------
p = r'C:/Users/iulia/Desktop/TheLotusCross/server/practices.js'
s = open(p, encoding='utf-8').read()
tail = """  { min: 0, xp: 50, tier: 'circle', title: 'One page of marginalia', desc: 'In the Scriptorium, take one note that troubles you and answer it in your own hand, on paper, for one page. Then photograph the page.', hint: 'A full page, legible, written by you.' }
];"""
assert s.count(tail) == 1
new = """  { min: 0, xp: 50, tier: 'circle', title: 'One page of marginalia', desc: 'In the Scriptorium, take one note that troubles you and answer it in your own hand, on paper, for one page. Then photograph the page.', hint: 'A full page, legible, written by you.' },
  { min: 40, xp: 30, tier: 'free', title: 'Read one chapter of the guide out loud', desc: 'Open The Red Lotus Way, pick any chapter, and read it aloud — not silently, aloud. Then photograph the page and say in the caption, in two lines, what you actually understood. Not what it said; what you understood.', hint: 'The open page. The caption is the practice.' },
  { min: 50, xp: 35, tier: 'free', title: 'Copy the sentence you resisted', desc: 'Find one sentence in the guide you disagree with, or that embarrassed you. Copy it by hand, once, on real paper. Do not explain it away. Photograph what you wrote.', hint: 'Your handwriting, one sentence, nothing typed.' },
  { min: 65, xp: 40, tier: 'free', title: 'Explain one idea to a person', desc: 'Take one idea from the guide and explain it to another human being, in your own words, without the book in your hand. Then write down what they asked you back, and photograph your note.', hint: 'The note of their question — not the book.' },
  { min: 80, xp: 45, tier: 'free', title: 'Find the chapter that argues with you', desc: 'There is one chapter in the guide written against the way you already think. Find it, read it twice, and mark the passage that stings. Photograph the marked page.', hint: 'The marked page, in your copy. A photo of a screen does not count.' }
];"""
s = s.replace(tail, new)
open(p, 'w', encoding='utf-8').write(s)

# ---------- 2. portal: swipe hint + a quiet policies link ----------
p = r'C:/Users/iulia/Desktop/TheLotusCross/server/public/portal.html'
s = open(p, encoding='utf-8').read()

# markup: hint pill just before </aside><... main>; put it right after the sidebar closes
anchor = '''      <button class="logout" id="logoutBtn" title="Sign out" aria-label="Sign out"><span class="ico">⎋</span><span class="txt">Sign out</span></button>'''
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + '''
      <a href="policies.html" class="policy-link">Policies</a>''')

# hint element goes inside the app, after the sidebar
old_main_open = '<div class="main">'
assert s.count(old_main_open) == 1
s = s.replace(old_main_open, '''<div id="barHint" aria-hidden="true"><span>Swipe the menu for more</span><span class="arrow">→</span></div>
    <div class="main">''')

# styles
css_anchor = '@media (prefers-reduced-motion: reduce){'
assert s.count(css_anchor) == 1
extra = '''.sidebar .policy-link{display:block;text-align:center;font-size:.7rem;letter-spacing:.6px;color:var(--muted);text-decoration:none;opacity:.75;padding:.6rem 0 0;transition:opacity .2s,color .2s}
.sidebar .policy-link:hover{opacity:1;color:var(--gold-deep)}
#barHint{display:none}
@media(max-width:600px){
  #barHint{position:fixed;bottom:82px;left:50%;transform:translateX(-50%) translateY(10px);display:flex;align-items:center;gap:.45rem;
    background:rgba(22,20,17,.94);color:#f4ece0;font-size:.74rem;font-weight:500;letter-spacing:.2px;
    padding:.55rem 1rem;border-radius:999px;box-shadow:0 10px 26px rgba(0,0,0,.28);
    z-index:210;pointer-events:none;white-space:nowrap;opacity:0;
    transition:opacity .45s ease,transform .45s cubic-bezier(.2,.7,.2,1)}
  #barHint.show{opacity:1;transform:translateX(-50%) translateY(0)}
  #barHint .arrow{animation:hintNudge 1.3s ease-in-out infinite;color:#e8c876}
  .sidebar .policy-link{display:none}
}
@keyframes hintNudge{0%,100%{transform:translateX(0)}50%{transform:translateX(5px)}}

'''
s = s.replace(css_anchor, extra + css_anchor, 1)

# behaviour: show once per device, only when the bar actually overflows
hook = "  document.getElementById('portalScreen').style.display = 'block';"
assert s.count(hook) == 1
s = s.replace(hook, hook + "\n  setTimeout(maybeBarHint, 900);")

fn = '''function maybeBarHint(){
  try{
    if(window.innerWidth > 600) return;
    if(localStorage.getItem('lotus_bar_hint')) return;
    var bar = document.querySelector('.sidebar');
    var hint = document.getElementById('barHint');
    if(!bar || !hint) return;
    if(bar.scrollWidth <= bar.clientWidth + 12) return;
    hint.classList.add('show');
    localStorage.setItem('lotus_bar_hint', '1');
    var hide = function(){ hint.classList.remove('show'); };
    setTimeout(hide, 7000);
    bar.addEventListener('scroll', hide, {once:true, passive:true});
    bar.addEventListener('touchstart', hide, {once:true, passive:true});
  }catch(e){}
}

function showPortal'''
assert s.count('function showPortal') == 1
s = s.replace('function showPortal', fn, 1)

# plans modal footer gets the same quiet link
old_foot = '<p style="font-size:.8rem;color:var(--muted);margin-top:1rem">Nothing essential is behind these.'
assert s.count(old_foot) == 1
s = s.replace(old_foot, '<p style="font-size:.8rem;color:var(--muted)">Refunds, membership terms and conduct: <a href="policies.html" style="color:var(--gold-deep)">Policies</a>.</p>\n    ' + old_foot)

open(p, 'w', encoding='utf-8').write(s)

# ---------- 3. footers across the public pages ----------
for f, old, new in [
    ('index.html', '<a href="cookies.html">Cookies</a>', '<a href="cookies.html">Cookies</a> · <a href="policies.html">Policies</a>'),
    ('mission.html', '<a href="cookies.html">Cookies</a>', '<a href="cookies.html">Cookies</a> · <a href="policies.html">Policies</a>'),
    ('archive.html', '<a href="terms.html">Terms</a>', '<a href="terms.html">Terms</a><a href="policies.html">Policies</a>'),
    ('shop.html', '<a href="cookies.html">Cookies</a></p>', '<a href="cookies.html">Cookies</a><a href="policies.html">Policies</a></p>'),
]:
    path = 'C:/Users/iulia/Desktop/TheLotusCross/server/public/' + f
    t = open(path, encoding='utf-8').read()
    if old in t and 'policies.html' not in t:
        t = t.replace(old, new, 1)
        open(path, 'w', encoding='utf-8').write(t)
        print('footer link:', f)
    else:
        print('skip', f, old in t, 'policies.html' in t)

m = re.search(r'<script>(.*?)</script>', open(r'C:/Users/iulia/Desktop/TheLotusCross/server/public/portal.html', encoding='utf-8').read(), re.S)
open(r'C:/Users/iulia/AppData/Local/Temp/lotuscheck/portal9.js', 'w', encoding='utf-8').write(m.group(1))
print('done')
