#!/usr/bin/env python3
"""앱 아이콘 PNG 생성기 (외부 의존성 없이 stdlib zlib만 사용).
icons/icon.svg 와 동일한 디자인의 건물 로고를 래스터화한다."""
import struct, zlib, os

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")

def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def make_icon(S, maskable=False):
    # 512 기준 좌표를 S로 스케일
    sc = S / 512.0
    # RGBA buffer
    buf = bytearray(S * S * 4)

    def put(x, y, rgba):
        if 0 <= x < S and 0 <= y < S:
            i = (y * S + x) * 4
            buf[i:i+4] = bytes(rgba)

    def fill_rect(x, y, w, h, rgb, rad=0, a=255):
        x0, y0 = int(x*sc), int(y*sc)
        x1, y1 = int((x+w)*sc), int((y+h)*sc)
        rr = rad*sc
        for yy in range(y0, y1):
            for xx in range(x0, x1):
                if rr > 0:
                    # rounded corner test
                    cx = min(max(xx, x0+rr), x1-rr)
                    cy = min(max(yy, y0+rr), y1-rr)
                    dx, dy = xx-cx, yy-cy
                    if dx*dx + dy*dy > rr*rr:
                        continue
                put(xx, yy, (*rgb, a))

    # 배경 그라데이션 (옵션 라운드 코너 — maskable은 풀블리드)
    top = (44, 82, 130)    # #2c5282
    bot = (30, 58, 95)     # #1e3a5f
    radius = 0 if maskable else 110*sc
    for yy in range(S):
        t = yy / (S - 1)
        col = lerp(top, bot, t)
        for xx in range(S):
            if radius > 0:
                cx = min(max(xx, radius), S-radius)
                cy = min(max(yy, radius), S-radius)
                dx, dy = xx-cx, yy-cy
                if dx*dx + dy*dy > radius*radius:
                    continue
            put(xx, yy, (*col, 255))

    # maskable이면 콘텐츠를 안전영역(약 78%)으로 축소: 좌표를 중심 기준 스케일
    inset = 0.82 if maskable else 1.0
    def C(v):  # 512 좌표 -> inset 적용 (중심 256 기준)
        return 256 + (v - 256) * inset

    white = (255, 255, 255)
    light = (226, 232, 240)
    blue = (44, 82, 130)
    dark = (30, 58, 95)
    gold = (246, 196, 83)

    def R(x, y, w, h, rgb, rad=0):
        # 중심 기준 inset
        nx, ny = C(x), C(y)
        nw, nh = w*inset, h*inset
        fill_rect(nx, ny, nw, nh, rgb, rad*inset)

    # 옥상
    R(176, 96, 160, 28, light, 8)
    # 본체
    R(146, 120, 220, 276, white, 16)
    # 창문
    wins = [(170,150),(236,150),(302,150),(170,212),(302,212),(170,274),(236,274),(302,274)]
    for (wx, wy) in wins:
        R(wx, wy, 40, 40, blue, 6)
    R(236, 212, 40, 40, gold, 6)   # 점등 창문
    # 출입문
    R(232, 338, 48, 58, dark, 8)

    return bytes(buf)

def write_png(path, S, rgba):
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        return c + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0)
    raw = bytearray()
    for y in range(S):
        raw.append(0)  # filter type none
        raw.extend(rgba[y*S*4:(y+1)*S*4])
    idat = zlib.compress(bytes(raw), 9)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path, S)

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    write_png(os.path.join(OUT, "icon-192.png"), 192, make_icon(192))
    write_png(os.path.join(OUT, "icon-512.png"), 512, make_icon(512))
    write_png(os.path.join(OUT, "icon-512-maskable.png"), 512, make_icon(512, maskable=True))
