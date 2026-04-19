#!/usr/bin/env python3
"""Remove edge-connected near-white pixels (typical flat export BG) without eating interior whites."""
from __future__ import annotations

import sys
from collections import deque

from PIL import Image


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: strip_white_bg_edges.py <input.png> [output.png]", file=sys.stderr)
        sys.exit(1)
    inp = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else inp
    threshold = int(sys.argv[3]) if len(sys.argv) > 3 else 232

    img = Image.open(inp).convert("RGBA")
    pixels = img.load()
    w, h = img.size

    def is_bg(r: int, g: int, b: int, _a: int) -> bool:
        return r >= threshold and g >= threshold and b >= threshold

    visited = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    for x in range(w):
        for y in (0, h - 1):
            if not visited[y][x]:
                r, g, b, a = pixels[x, y]
                if is_bg(r, g, b, a):
                    visited[y][x] = True
                    q.append((x, y))

    for y in range(h):
        for x in (0, w - 1):
            if not visited[y][x]:
                r, g, b, a = pixels[x, y]
                if is_bg(r, g, b, a):
                    visited[y][x] = True
                    q.append((x, y))

    while q:
        x, y = q.popleft()
        r, g, b, _a = pixels[x, y]
        pixels[x, y] = (r, g, b, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if nx < 0 or nx >= w or ny < 0 or ny >= h or visited[ny][nx]:
                continue
            r2, g2, b2, a2 = pixels[nx, ny]
            if is_bg(r2, g2, b2, a2):
                visited[ny][nx] = True
                q.append((nx, ny))

    img.save(out, "PNG")
    print(out, w, h)


if __name__ == "__main__":
    main()
