# Lydspor for den lange annonsen (36 s): akkordflate som skifter, sveip ved scenebytter, tikk på kortene og klokke på slutten.
import math, random, struct, sys, wave
SR = 44100; DUR = 36; N = SR * DUR
random.seed(5)
buf = [0.0] * N
CH = [(110, 164.81, 220, 277.18), (92.5, 138.59, 185, 220), (73.42, 110, 146.83, 185), (82.41, 123.47, 164.81, 207.65)]
def w(t, i):  # myk overgang mellom fire akkorder, 9 s hver
    c = t / 9 - i
    return max(0.0, math.cos(min(1.0, abs(c)) * math.pi / 2)) ** 2 if abs(c) < 1 else 0.0
for i in range(N):
    t = i / SR
    f = min(1.0, t / 1.2) * min(1.0, (DUR - t) / 1.5)
    s = 0
    for ci, ch in enumerate(CH):
        wt = w(t + 4.5, ci)
        if wt <= 0: continue
        for hz, a in zip(ch, (.10, .07, .06, .035)):
            s += wt * a * math.sin(2 * math.pi * hz * t + 0.4 * math.sin(2 * math.pi * 0.25 * t))
    buf[i] += s * f * (0.85 + 0.15 * math.sin(2 * math.pi * 0.5 * t))
def swoosh(t0, dur=0.55, amp=0.16):
    n0 = int(t0 * SR); lp = 0.0
    for k in range(int(dur * SR)):
        x = k / (dur * SR); e = math.sin(math.pi * x) ** 2
        lp += (0.02 + 0.28 * x) * ((random.random() * 2 - 1) - lp)
        if n0 + k < N: buf[n0 + k] += amp * e * lp * 3
for t in (2.85, 7.6, 11.4, 15.3, 19.4, 24.2, 28.0, 32.2): swoosh(t)
def tick(t0, hz=1318.5, amp=0.07):
    n0 = int(t0 * SR)
    for k in range(int(0.25 * SR)):
        t = k / SR
        if n0 + k < N: buf[n0 + k] += amp * math.exp(-t * 16) * math.sin(2 * math.pi * hz * t)
for t in (3.45, 3.95, 4.45, 16.1, 16.6, 21.5, 24.9, 25.25, 25.6, 30.0, 30.3, 30.6, 30.9): tick(t)
def bell(t0, base=880, amp=0.11):
    n0 = int(t0 * SR)
    for k in range(int(1.6 * SR)):
        t = k / SR
        v = sum(a * math.exp(-t * d) * math.sin(2 * math.pi * base * m * t) for m, a, d in ((1, 1, 3.0), (2.0, .5, 4.0), (3.0, .25, 6.0), (4.2, .12, 8.0)))
        if n0 + k < N: buf[n0 + k] += amp * v
bell(22.4, 1174.7, .07)   # svar Ja på kampanjen
bell(32.7)                # logoen
g = 0.6 / (max(abs(x) for x in buf) or 1)
with wave.open(sys.argv[1], 'wb') as wv:
    wv.setnchannels(1); wv.setsampwidth(2); wv.setframerate(SR)
    wv.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x * g)) * 32767)) for x in buf))
