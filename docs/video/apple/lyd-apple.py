# Lydspor (44 s, 60 slag/min) i rolig, minimalistisk stil: pad, klaverlignende toner med romklang og dyp bass.
import math, random, struct, sys, wave
SR = 44100; DUR = 44; N = SR * DUR
random.seed(11)
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)
dry = [0.0] * N     # pad og bass
pno = [0.0] * N     # toner som får romklang
cache = {}
def tone(m):        # én tone, hentes fra cache (3,6 s)
    if m in cache: return cache[m]
    f = hz(m); L = int(3.6 * SR); out = [0.0] * L
    hs = ((1, 1.0, 1.5), (2, .50, 2.4), (3, .27, 3.4), (4, .16, 4.6), (5, .09, 6.0), (6, .05, 8.0))
    for k in range(L):
        t = k / SR; v = 0.0
        for h, a, d in hs: v += a * math.exp(-t * d) * math.sin(2 * math.pi * f * h * (1 + 0.0003 * h * h) * t)
        out[k] = v * min(1.0, t / 0.003)
    cache[m] = out; return out
def note(t0, m, vel=.3):
    n0 = int(t0 * SR); tn = tone(m)
    for k in range(min(len(tn), N - n0)): pno[n0 + k] += vel * tn[k]
def chord(t0, ms, vel=.3, spread=.045):
    for i, m in enumerate(ms): note(t0 + i * spread, m, vel)
def pad(t0, t1, ms, amp=.05):
    for m in ms:
        f = hz(m)
        for det in (-.6, .6):
            for i in range(int(t0 * SR), min(N, int((t1 + 1.8) * SR))):
                t = i / SR
                e = min(1.0, (t - t0) / 1.4) * min(1.0, max(0.0, (t1 + 1.8 - t) / 1.8))
                dry[i] += amp * e * (math.sin(2 * math.pi * (f + det) * t) + .25 * math.sin(2 * math.pi * 2 * (f + det) * t)) * (0.85 + 0.15 * math.sin(2 * math.pi * .2 * t))
def sub(t0, t1, m, amp, shape):
    f = hz(m)
    for i in range(int(t0 * SR), min(N, int(t1 * SR))):
        t = i / SR; dry[i] += amp * shape((t - t0) / (t1 - t0)) * math.sin(2 * math.pi * f * t)
# akkorder: Cadd9 · Fmaj7 · Am7 · Fmaj7 · Gsus · Cmaj9
for t0, t1, ms in ((0, 8, (36, 48, 55, 62, 64)), (8, 16, (29, 41, 48, 57, 64)), (16, 24, (33, 45, 52, 60, 67)), (24, 32, (29, 41, 48, 57, 64)), (32, 40.2, (31, 43, 50, 57, 62)), (40.2, 44, (36, 48, 55, 62, 64, 71))):
    pad(t0, t1, ms)
# 1 · åpning, glissende enkeltoner
for t, m, v in ((.6, 76, .22), (2.8, 79, .26), (3.9, 72, .16), (5.7, 81, .26), (6.8, 79, .2), (7.5, 76, .16)): note(t, m, v)
# 2 · produktet: tittel, så åttedelsarpeggio
chord(8.6, (65, 69, 72, 76), .28); note(13.7, 84, .3)
P = (69, 72, 76, 79, 76, 72)
t = 9.0; i = 0
while t < 16.2: note(t, P[i % 6], .14 + (.04 if i % 6 == 0 else 0)); t += .5; i += 1
# 3 · tallene
chord(16.7, (57, 64, 69, 72), .32); chord(17.7, (55, 62, 67, 71), .32); chord(18.7, (53, 60, 65, 72, 77), .4)
note(20.4, 88, .14); note(21.1, 84, .12)
# 4 · ordene: sekstendedeler som stiger
for b, (b0, base) in enumerate(((22.0, 72), (24.25, 69), (26.5, 67), (28.75, 72))):
    note(b0, base - 36, .34)
    for i in range(8):
        note(b0 + .25 * i, base + (0, 4, 7, 12, 7, 4, 9, 4)[i], .12 + (.05 if i == 0 else 0))
# 5 · rapporten: brede akkorder
chord(31.0, (57, 64, 67, 72, 74), .36); chord(33.0, (53, 60, 64, 69), .34); chord(35.0, (55, 62, 67, 71, 76), .36)
t = 31.5; i = 0
while t < 36.2: note(t, (81, 76, 72, 76)[i % 4], .11); t += 1.0; i += 1
# 6 · personvern: ett tone, stigende bass
for k, tt in enumerate((36.9, 37.9, 38.9, 39.6)): note(tt, 79, .2 + .02 * k)
sub(36.6, 40.35, 31, .10, lambda x: x ** 2)
# slutt: løsning, lav bass og klokker
chord(40.4, (60, 64, 67, 71, 74), .42, .06); note(40.4, 36, .45); sub(40.4, 44, 28, .22, lambda x: math.exp(-x * 3))
note(41.2, 88, .16); note(41.9, 91, .13); note(42.7, 95, .08)
# romklang (Schroeder) på pianosiden
def comb(x, d, g):
    y = x[:]
    for i in range(d, N): y[i] += g * y[i - d]
    return y
wet = [0.0] * N
for d, g in ((int(.0297 * SR), .76), (int(.0371 * SR), .74), (int(.0411 * SR), .72), (int(.0437 * SR), .70)):
    c = comb(pno, d, g)
    for i in range(N): wet[i] += c[i] * .25
for d, g in ((int(.005 * SR), .5), (int(.0017 * SR), .5)):
    y = wet[:]
    for i in range(d, N): y[i] = -g * wet[i] + wet[i - d] + g * y[i - d]
    wet = y
mix = [dry[i] + pno[i] * .75 + wet[i] * .55 for i in range(N)]
for i in range(int((DUR - 1.2) * SR), N): mix[i] *= max(0.0, (N - i) / (1.2 * SR))
g = 0.62 / (max(abs(x) for x in mix) or 1)
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x * g)) * 32767)) for x in mix))
