# Lager et lett lydspor (10 s): myk akkordflate, lette "sveip" ved scenebytter og en klokke på slutten.
import math, random, struct, sys, wave
SR = 44100; N = SR * 10
random.seed(3)
buf = [0.0] * N
def env_att_rel(t, a, d):  # 0..1
    return min(1.0, t / a) * math.exp(-t / d) if d else min(1.0, t / a)
# akkordflate: A2 + E3 + A3 + C#4, rolig fade inn og ut
for i in range(N):
    t = i / SR
    f = min(1.0, t / 1.2) * min(1.0, (10 - t) / 1.0)
    s = 0
    for hz, a in ((110, .10), (164.81, .07), (220, .06), (277.18, .035)):
        s += a * math.sin(2 * math.pi * hz * t + 0.4 * math.sin(2 * math.pi * 0.25 * t))
    buf[i] += s * f * (0.85 + 0.15 * math.sin(2 * math.pi * 0.5 * t))
# sveip: filtrert støy med stigende lysstyrke
def swoosh(t0, dur=0.55, amp=0.16):
    n0 = int(t0 * SR); lp = 0.0
    for k in range(int(dur * SR)):
        x = k / (dur * SR)
        e = math.sin(math.pi * x) ** 2
        a = 0.02 + 0.28 * x  # lavpass åpner seg
        lp += a * ((random.random() * 2 - 1) - lp)
        if n0 + k < N: buf[n0 + k] += amp * e * lp * 3
for t in (1.85, 4.15, 6.7, 8.5): swoosh(t)
# små tikk på kortene
def tick(t0, hz=1318.5, amp=0.07):
    n0 = int(t0 * SR)
    for k in range(int(0.25 * SR)):
        t = k / SR
        if n0 + k < N: buf[n0 + k] += amp * math.exp(-t * 16) * math.sin(2 * math.pi * hz * t)
for t in (6.95, 7.12, 7.29, 7.46): tick(t)
# klokke på logoen
def bell(t0, base=880, amp=0.11):
    n0 = int(t0 * SR)
    for k in range(int(1.4 * SR)):
        t = k / SR
        v = sum(a * math.exp(-t * d) * math.sin(2 * math.pi * base * m * t) for m, a, d in ((1, 1, 3.0), (2.0, .5, 4.0), (3.0, .25, 6.0), (4.2, .12, 8.0)))
        if n0 + k < N: buf[n0 + k] += amp * v
bell(8.65)
pk = max(abs(x) for x in buf) or 1
g = 0.6 / pk
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x * g)) * 32767)) for x in buf))
