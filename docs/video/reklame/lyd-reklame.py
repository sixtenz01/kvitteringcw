# Lydspor til reklamen. Leser lyd-hendelsene (cues) fra siden og legger lyd under bildene.
#   python3 lyd-reklame.py cues.json lyd.wav
# Musikken er enkel og syntetisk (drone, puls, arpeggio, kjerne-akkorder). Alt er egenkomponert i koden.
import json, math, random, struct, sys, wave
SR = 44100
D = json.load(open(sys.argv[1])); DUR = D['total'] + .6; N = int(DUR * SR)
START = {s['id']: s['start'] for s in D['scenes']}
K = {s['id']: s.get('k', 1) for s in D['scenes']}
random.seed(8)
mix = [0.0] * N
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)

def put(t0, arr, g=1.0):
    n0 = int(t0 * SR)
    for k in range(min(len(arr), N - n0)):
        if n0 + k >= 0: mix[n0 + k] += g * arr[k]

_c = {}
def pluck(m, dur=.9, bright=1.0):          # elektrisk pluck (cachet)
    key = (m, dur, bright)
    if key in _c: return _c[key]
    f = hz(m); L = int(dur * SR); out = [0.0] * L
    for k in range(L):
        t = k / SR; v = 0.0
        for h in (1, 2, 3, 4, 5, 6): v += (1.0 / h ** 1.6) * math.exp(-t * (5 + h * 3.5 / bright)) * math.sin(2 * math.pi * f * h * t)
        out[k] = v * min(1.0, t / .003)
    _c[key] = out; return out
def bell(m, dur=2.2):
    key = ('b', m, dur)
    if key in _c: return _c[key]
    f = hz(m); L = int(dur * SR); out = [0.0] * L
    for k in range(L):
        t = k / SR
        out[k] = sum(a * math.exp(-t * d) * math.sin(2 * math.pi * f * r * t) for r, a, d in ((1, 1, 1.6), (2.76, .35, 2.4), (5.4, .18, 3.6), (8.9, .08, 5.0))) * min(1.0, t / .002)
    _c[key] = out; return out
def noise_sweep(t0, dur, f1, f2, g, shape=lambda x: math.sin(math.pi * x) ** 2):
    n0 = int(t0 * SR); lp = 0.0; hp = 0.0
    for k in range(int(dur * SR)):
        x = k / (dur * SR); a = clamp(lerp(f1, f2, x) / SR * 6.0, .002, .9)
        lp += a * ((random.random() * 2 - 1) - lp)
        if n0 + k < N: mix[n0 + k] += g * shape(x) * lp * 2.4
def tone(t0, f, dur, g, f2=None, kind='sine', env=None):
    n0 = int(t0 * SR); ph = 0.0
    for k in range(int(dur * SR)):
        x = k / (dur * SR); ff = f if f2 is None else f * (f2 / f) ** x
        ph += 2 * math.pi * ff / SR
        v = math.sin(ph) if kind == 'sine' else (2 * (ph / (2 * math.pi) % 1) - 1) * .5 if kind == 'saw' else math.sin(ph)
        e = env(x) if env else math.exp(-x * 5) * min(1.0, k / (.004 * SR))
        if n0 + k < N: mix[n0 + k] += g * e * v
clamp = lambda x, a, b: max(a, min(b, x)); lerp = lambda a, b, x: a + (b - a) * x

# ---------- musikalsk seng ----------
def drone(t0, t1, m, g):                   # lav, rolig flate
    f = hz(m)
    for i in range(int(t0 * SR), min(N, int(t1 * SR))):
        t = i / SR; e = min(1.0, (t - t0) / 1.2) * min(1.0, (t1 - t) / 1.0)
        mix[i] += g * e * (math.sin(2 * math.pi * f * t) + .4 * math.sin(2 * math.pi * 2 * f * t + 1.1) + .15 * math.sin(2 * math.pi * 3.01 * f * t)) * (.85 + .15 * math.sin(2 * math.pi * .13 * t))
def thump(t, g=.5):
    tone(t, 120, .22, g, 42, env=lambda x: math.exp(-x * 5.5))
CH = {'A': [57, 64, 69, 73, 69, 64, 61, 64], 'E': [56, 64, 68, 71, 68, 64, 59, 64], 'F': [54, 61, 66, 69, 66, 61, 57, 61], 'D': [50, 57, 62, 66, 62, 57, 54, 57]}
ROOT = {'A': 33, 'E': 40, 'F': 30, 'D': 38}
PROG = ['A', 'E', 'F', 'D']

# 1 · hook + problem: mørk drone og hjerteslag som øker
drone(0, START['produkt'] + .4, 33, .10); drone(0, START['produkt'] + .4, 40, .06)
t = .9; gap = 1.0
while t < START['produkt'] - .1:
    thump(t, .26); thump(t + .22, .16); t += gap; gap = max(.46, gap * .92)
noise_sweep(START['problem'] - .2, 1.6, 400, 4500, .02)
# 2 · produkt: sprekker opp
tp = START['produkt']
noise_sweep(tp - .55, .6, 500, 6000, .06, shape=lambda x: x * x)
for i, m in enumerate((57, 64, 69, 73, 76)): put(tp + .02 + i * .045, bell(m, 3.0), .09)
drone(tp, START['cta'] - .2, 45, .05); drone(tp, START['cta'] - .2, 52, .04)

# 3 · arpeggio-puls (fra «Hent» til CTA), intensiteten følger fortellingen
t = START['hent']; step = .25; i = 0; end = START['cta'] + .3
while t < end:
    bar = int((t - START['hent']) / 2.0); ch = PROG[bar % 4]; m = CH[ch][i % 8]
    inten = .6 + .5 * clamp((t - START['analyse']) / 8, 0, 1) + (.35 if START['analyse'] <= t < START['tolv'] else 0)
    if START['tolv'] + 1.9 / K['tolv'] <= t < START['sjekk']: inten *= .55          # åndepause rundt «12»
    vel = (.075 + (.03 if i % 8 == 0 else 0)) * inten
    put(t, pluck(m + (12 if (t > START['sjekk'] and i % 16 > 7) else 0), .8), vel)
    if i % 8 == 0: tone(t, hz(ROOT[ch]), 1.9, .13 * min(1, inten), env=lambda x: min(1, x * 25) * math.exp(-x * 1.6))
    t += step; i += 1
# 4 · puls fra «Sjekk først» til rapporten
t = START['sjekk']
while t < START['rapport'] + 2.0: thump(t, .22); t += .5
# 5 · stor løsning på «12» og i finalen
t12 = START['tolv'] + 2.55 / K['tolv']
noise_sweep(t12 - .9, .9, 300, 7000, .08, shape=lambda x: x ** 3)
thump(t12, .85)
for i, m in enumerate((57, 61, 64, 69, 73, 76, 81)): put(t12 + .03 + i * .04, bell(m, 3.2), .1)
tc = START['cta']
for i, m in enumerate((45, 57, 64, 69, 73, 76)): put(tc + .6 + i * .05, bell(m, 3.6), .10)
tone(tc + .6, 55, 2.6, .5, 40, env=lambda x: math.exp(-x * 2.4))

# ---------- lydeffekter fra cues ----------
for c in D['cues']:
    t, n = c['t'], c['name']
    if n == 'scene-transition': noise_sweep(t - .05, .5, 350, 3200, .05)
    elif n == 'count-tick': tone(t, 1800, .035, .035, 1300, env=lambda x: math.exp(-x * 6))
    elif n == 'scan-tick': tone(t, 2600, .02, .018, env=lambda x: math.exp(-x * 7))
    elif n == 'risk-detection': tone(t, 880, .28, .06); tone(t + .09, 1320, .32, .05)
    elif n == 'click': tone(t, 760, .06, .07, 420, env=lambda x: math.exp(-x * 5))
    elif n == 'analysis-start': tone(t, 110, .9, .09, 560, kind='saw', env=lambda x: math.sin(math.pi * x) ** 1.4); noise_sweep(t, .9, 200, 5200, .06)
    elif n == 'report-complete':
        for i, m in enumerate((69, 73, 76, 81)): put(t + i * .06, pluck(m, 1.4, .6), .09)

# fade ut og normaliser
fo = int((DUR - 1.6) * SR)
for i in range(fo, N): mix[i] *= max(0.0, (N - i) / (N - fo))
g = .72 / (max(abs(x) for x in mix) or 1)
with wave.open(sys.argv[2], 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x * g)) * 32767)) for x in mix))
print('lyd skrevet', sys.argv[2], round(DUR, 1), 's')
