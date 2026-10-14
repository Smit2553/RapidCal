#!/usr/bin/env python3
"""
RapidCal Promotional Video Generator
====================================
Generates a 32-second (1920x1080 @ 60fps) animated promotional launch video
(`docs/promo.mp4`) and high-resolution poster image (`docs/promo-poster.png`)
for RapidCal using PyCairo, PangoCairo, Pillow, NumPy audio synthesis, and FFmpeg.
"""

from __future__ import annotations

import math
import subprocess
import tempfile
import time
import wave
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cairo
import gi
import numpy as np
from PIL import Image

gi.require_version("Pango", "1.0")
gi.require_version("PangoCairo", "1.0")
from gi.repository import Pango, PangoCairo

# ---------------------------------------------------------------------------
# Video & Canvas Constants
# ---------------------------------------------------------------------------
WIDTH = 1920
HEIGHT = 1080
FPS = 60
DURATION_SEC = 32.0
TOTAL_FRAMES = int(DURATION_SEC * FPS)  # 1920 frames

ROOT_DIR = Path(__file__).resolve().parent.parent
DOCS_DIR = ROOT_DIR / "docs"
SCREENSHOTS_DIR = ROOT_DIR / "tests" / "e2e" / "screenshots"
OUTPUT_MP4 = DOCS_DIR / "promo.mp4"
OUTPUT_POSTER = DOCS_DIR / "promo-poster.png"
OUTPUT_POSTER_WEBP = DOCS_DIR / "promo-poster.webp"

# ---------------------------------------------------------------------------
# Brand Palette (Normalized RGB 0..1)
# ---------------------------------------------------------------------------
C_BG_OBS = (9 / 255, 9 / 255, 11 / 255)             # #09090b
C_BG_ELEV = (17 / 255, 17 / 255, 21 / 255)          # #111115
C_BG_CARD = (24 / 255, 24 / 255, 27 / 255)          # #18181b
C_BG_ZINC900 = (24 / 255, 24 / 255, 27 / 255)       # #18181b
C_BG_ZINC800 = (39 / 255, 39 / 255, 42 / 255)       # #27272a
C_BORDER = (63 / 255, 63 / 255, 70 / 255)           # #3f3f46
C_TEXT_PRI = (244 / 255, 244 / 255, 245 / 255)      # #f4f4f5
C_TEXT_SEC = (161 / 255, 161 / 255, 170 / 255)      # #a1a1aa
C_TEXT_MUT = (113 / 255, 113 / 255, 122 / 255)      # #71717a

C_INDIGO = (99 / 255, 102 / 255, 241 / 255)         # #6366f1
C_INDIGO_LT = (129 / 255, 140 / 255, 248 / 255)     # #818cf8
C_INDIGO_PALE = (199 / 255, 210 / 255, 254 / 255)   # #c7d2fe
C_SKY = (14 / 255, 165 / 255, 233 / 255)            # #0ea5e9
C_SKY_LT = (125 / 255, 211 / 255, 252 / 255)       # #7dd3fc
C_EMERALD = (16 / 255, 185 / 255, 129 / 255)        # #10b981
C_EMERALD_LT = (110 / 255, 231 / 255, 183 / 255)    # #6ee7b7
C_ROSE = (244 / 255, 63 / 255, 94 / 255)            # #f43f5e
C_AMBER = (245 / 255, 158 / 255, 11 / 255)          # #f59e0b
C_WHITE = (1.0, 1.0, 1.0)


# ---------------------------------------------------------------------------
# Math & Easing Helpers
# ---------------------------------------------------------------------------
def clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def norm_window(t: float, t0: float, t1: float) -> float:
    if t1 <= t0:
        return 1.0 if t >= t0 else 0.0
    return clamp((t - t0) / (t1 - t0), 0.0, 1.0)


def ease_out_cubic(x: float) -> float:
    x = clamp(x)
    return 1.0 - (1.0 - x) ** 3


def ease_in_out_cubic(x: float) -> float:
    x = clamp(x)
    return 4.0 * x * x * x if x < 0.5 else 1.0 - ((-2.0 * x + 2.0) ** 3) / 2.0


def ease_out_expo(x: float) -> float:
    x = clamp(x)
    return 1.0 if x >= 1.0 else 1.0 - math.pow(2.0, -10.0 * x)


def ease_out_back(x: float, overshoot: float = 1.35) -> float:
    x = clamp(x)
    c1 = overshoot
    c3 = c1 + 1.0
    return 1.0 + c3 * math.pow(x - 1.0, 3) + c1 * math.pow(x - 1.0, 2)


def spring_ease(x: float) -> float:
    x = clamp(x)
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    return 1.0 - math.exp(-7.5 * x) * math.cos(10.0 * x)


def scene_fade(t: float, start: float, end: float, fade_in: float = 0.45, fade_out: float = 0.45) -> float:
    if t < start or t > end:
        return 0.0
    alpha = 1.0
    if fade_in > 0 and t < start + fade_in:
        alpha = min(alpha, ease_in_out_cubic((t - start) / fade_in))
    if fade_out > 0 and t > end - fade_out:
        alpha = min(alpha, ease_in_out_cubic((end - t) / fade_out))
    return clamp(alpha)


# ---------------------------------------------------------------------------
# Cairo Drawing Primitives
# ---------------------------------------------------------------------------
def rounded_rect(ctx: cairo.Context, x: float, y: float, w: float, h: float, r: float) -> None:
    r = max(0.0, min(r, w / 2.0, h / 2.0))
    ctx.new_sub_path()
    ctx.arc(x + w - r, y + r, r, -math.pi / 2, 0)
    ctx.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
    ctx.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
    ctx.arc(x + r, y + r, r, math.pi, 3 * math.pi / 2)
    ctx.close_path()


def fill_rounded_rect(
    ctx: cairo.Context,
    x: float,
    y: float,
    w: float,
    h: float,
    r: float,
    color: Tuple[float, float, float],
    alpha: float = 1.0,
) -> None:
    rounded_rect(ctx, x, y, w, h, r)
    ctx.set_source_rgba(color[0], color[1], color[2], alpha)
    ctx.fill()


def stroke_rounded_rect(
    ctx: cairo.Context,
    x: float,
    y: float,
    w: float,
    h: float,
    r: float,
    color: Tuple[float, float, float],
    alpha: float = 1.0,
    line_width: float = 1.0,
) -> None:
    rounded_rect(ctx, x, y, w, h, r)
    ctx.set_source_rgba(color[0], color[1], color[2], alpha)
    ctx.set_line_width(line_width)
    ctx.stroke()


def draw_glass_card(
    ctx: cairo.Context,
    x: float,
    y: float,
    w: float,
    h: float,
    r: float = 16.0,
    bg_color: Tuple[float, float, float] = C_BG_CARD,
    bg_alpha: float = 0.88,
    border_color: Tuple[float, float, float] = C_BORDER,
    border_alpha: float = 0.65,
    glow_color: Optional[Tuple[float, float, float]] = None,
    glow_alpha: float = 0.22,
    shadow_alpha: float = 0.45,
) -> None:
    if shadow_alpha > 0:
        for i, offset in enumerate([(14, 0.35), (6, 0.65)]):
            dy, mult = offset
            rounded_rect(ctx, x - 3 + i, y + dy, w + 6 - 2 * i, h, r + 3)
            ctx.set_source_rgba(0, 0, 0, shadow_alpha * mult)
            ctx.fill()

    if glow_color is not None and glow_alpha > 0:
        for spread, mult in [(12, 0.22), (5, 0.45)]:
            rounded_rect(ctx, x - spread, y - spread, w + 2 * spread, h + 2 * spread, r + spread)
            ctx.set_source_rgba(glow_color[0], glow_color[1], glow_color[2], glow_alpha * mult)
            ctx.fill()

    rounded_rect(ctx, x, y, w, h, r)
    grad = cairo.LinearGradient(x, y, x, y + h)
    grad.add_color_stop_rgba(0.0, min(1.0, bg_color[0] + 0.03), min(1.0, bg_color[1] + 0.03), min(1.0, bg_color[2] + 0.04), bg_alpha)
    grad.add_color_stop_rgba(1.0, bg_color[0], bg_color[1], bg_color[2], bg_alpha)
    ctx.set_source(grad)
    ctx.fill()

    ctx.save()
    rounded_rect(ctx, x, y, w, h, r)
    ctx.clip()
    ctx.move_to(x + r * 0.5, y + 1)
    ctx.line_to(x + w - r * 0.5, y + 1)
    ctx.set_source_rgba(1.0, 1.0, 1.0, 0.14 * bg_alpha)
    ctx.set_line_width(1.5)
    ctx.stroke()
    ctx.restore()

    stroke_rounded_rect(ctx, x, y, w, h, r, border_color, border_alpha, 1.2)


_FONT_CACHE: Dict[str, Pango.FontDescription] = {}


def get_font(desc_str: str) -> Pango.FontDescription:
    if desc_str not in _FONT_CACHE:
        normalized = desc_str
        if desc_str.startswith("Inter Display "):
            normalized = "Inter Display, Inter, DejaVu Sans, Sans " + desc_str[len("Inter Display "):]
        elif desc_str.startswith("Inter "):
            normalized = "Inter, DejaVu Sans, Sans " + desc_str[len("Inter "):]
        elif desc_str.startswith("DejaVu Sans Mono "):
            normalized = "DejaVu Sans Mono, Monospace " + desc_str[len("DejaVu Sans Mono "):]
        _FONT_CACHE[desc_str] = Pango.FontDescription(normalized)
    return _FONT_CACHE[desc_str]


def draw_text(
    ctx: cairo.Context,
    text: str,
    x: float,
    y: float,
    font_str: str = "Inter SemiBold 16",
    color: Tuple[float, float, float] = C_TEXT_PRI,
    alpha: float = 1.0,
    align: str = "left",
    valign: str = "top",
    max_width: Optional[int] = None,
    letter_spacing: int = 0,
) -> Tuple[int, int]:
    if alpha <= 0.005 or not text:
        return 0, 0
    layout = PangoCairo.create_layout(ctx)
    layout.set_font_description(get_font(font_str))
    if max_width is not None:
        layout.set_width(int(max_width * Pango.SCALE))
        layout.set_wrap(Pango.WrapMode.WORD_CHAR)
    if align == "center":
        layout.set_alignment(Pango.Alignment.CENTER)
    elif align == "right":
        layout.set_alignment(Pango.Alignment.RIGHT)
    else:
        layout.set_alignment(Pango.Alignment.LEFT)

    if letter_spacing != 0:
        attrs = Pango.AttrList()
        attrs.insert(Pango.attr_letter_spacing_new(letter_spacing * Pango.SCALE))
        layout.set_attributes(attrs)

    layout.set_text(text, -1)
    tw, th = layout.get_pixel_size()

    dx = x
    if max_width is None:
        if align == "center":
            dx = x - tw / 2.0
        elif align == "right":
            dx = x - tw
    else:
        if align == "center":
            dx = x - max_width / 2.0
        elif align == "right":
            dx = x - max_width

    dy = y
    if valign == "middle":
        dy = y - th / 2.0
    elif valign == "bottom":
        dy = y - th

    ctx.save()
    ctx.move_to(dx, dy)
    ctx.set_source_rgba(color[0], color[1], color[2], alpha)
    PangoCairo.show_layout(ctx, layout)
    ctx.restore()
    return tw, th


def draw_gradient_text(
    ctx: cairo.Context,
    text: str,
    x: float,
    y: float,
    font_str: str,
    c1: Tuple[float, float, float],
    c2: Tuple[float, float, float],
    c3: Optional[Tuple[float, float, float]] = None,
    alpha: float = 1.0,
    align: str = "center",
    valign: str = "middle",
) -> Tuple[int, int]:
    if alpha <= 0.005 or not text:
        return 0, 0
    layout = PangoCairo.create_layout(ctx)
    layout.set_font_description(get_font(font_str))
    layout.set_text(text, -1)
    tw, th = layout.get_pixel_size()

    dx = x - tw / 2.0 if align == "center" else (x - tw if align == "right" else x)
    dy = y - th / 2.0 if valign == "middle" else (y - th if valign == "bottom" else y)

    ctx.save()
    ctx.move_to(dx, dy)
    PangoCairo.layout_path(ctx, layout)
    grad = cairo.LinearGradient(dx, dy, dx + tw, dy + th * 0.4)
    grad.add_color_stop_rgba(0.0, c1[0], c1[1], c1[2], alpha)
    if c3 is not None:
        grad.add_color_stop_rgba(0.52, c2[0], c2[1], c2[2], alpha)
        grad.add_color_stop_rgba(1.0, c3[0], c3[1], c3[2], alpha)
    else:
        grad.add_color_stop_rgba(1.0, c2[0], c2[1], c2[2], alpha)
    ctx.set_source(grad)
    ctx.fill()
    ctx.restore()
    return tw, th


def draw_icon_video(
    ctx: cairo.Context,
    cx: float,
    cy: float,
    size: float = 11.0,
    color: Tuple[float, float, float] = C_WHITE,
    alpha: float = 1.0,
) -> None:
    if alpha <= 0.005:
        return
    bw = size * 0.78
    bh = size * 0.58
    bx = cx - size * 0.52
    by = cy - bh / 2.0
    fill_rounded_rect(ctx, bx, by, bw, bh, size * 0.16, color, alpha)
    ctx.move_to(bx + bw + size * 0.04, cy)
    ctx.line_to(bx + bw + size * 0.34, cy - bh * 0.42)
    ctx.line_to(bx + bw + size * 0.34, cy + bh * 0.42)
    ctx.close_path()
    ctx.set_source_rgba(color[0], color[1], color[2], alpha)
    ctx.fill()


def draw_icon_bolt(
    ctx: cairo.Context,
    cx: float,
    cy: float,
    size: float = 12.0,
    color: Tuple[float, float, float] = C_AMBER,
    alpha: float = 1.0,
) -> None:
    if alpha <= 0.005:
        return
    r = size * 0.5
    ctx.save()
    ctx.translate(cx, cy)
    ctx.move_to(r * 0.15, -r)
    ctx.line_to(-r * 0.65, r * 0.08)
    ctx.line_to(-r * 0.05, r * 0.08)
    ctx.line_to(-r * 0.25, r)
    ctx.line_to(r * 0.65, -r * 0.12)
    ctx.line_to(r * 0.05, -r * 0.12)
    ctx.close_path()
    ctx.set_source_rgba(color[0], color[1], color[2], alpha)
    ctx.fill()
    ctx.restore()


def draw_icon_search(
    ctx: cairo.Context,
    cx: float,
    cy: float,
    size: float = 12.0,
    color: Tuple[float, float, float] = C_TEXT_SEC,
    alpha: float = 1.0,
) -> None:
    if alpha <= 0.005:
        return
    r = size * 0.34
    ctx.save()
    ctx.arc(cx - size * 0.08, cy - size * 0.08, r, 0, 2 * math.pi)
    ctx.set_source_rgba(color[0], color[1], color[2], alpha)
    ctx.set_line_width(max(1.5, size * 0.14))
    ctx.stroke()
    ctx.move_to(cx + r * 0.55, cy + r * 0.55)
    ctx.line_to(cx + size * 0.42, cy + size * 0.42)
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.stroke()
    ctx.restore()


def draw_icon_sparkle(
    ctx: cairo.Context,
    cx: float,
    cy: float,
    size: float = 11.0,
    color: Tuple[float, float, float] = C_INDIGO_PALE,
    alpha: float = 1.0,
) -> None:
    if alpha <= 0.005:
        return
    r = size * 0.52
    ri = r * 0.28
    ctx.save()
    ctx.translate(cx, cy)
    ctx.move_to(0, -r)
    ctx.line_to(ri, -ri)
    ctx.line_to(r, 0)
    ctx.line_to(ri, ri)
    ctx.line_to(0, r)
    ctx.line_to(-ri, ri)
    ctx.line_to(-r, 0)
    ctx.line_to(-ri, -ri)
    ctx.close_path()
    ctx.set_source_rgba(color[0], color[1], color[2], alpha)
    ctx.fill()
    ctx.restore()


def draw_icon_lock(
    ctx: cairo.Context,
    cx: float,
    cy: float,
    size: float = 14.0,
    color: Tuple[float, float, float] = C_EMERALD_LT,
    alpha: float = 1.0,
) -> None:
    if alpha <= 0.005:
        return
    bw = size * 0.78
    bh = size * 0.56
    bx = cx - bw / 2.0
    by = cy - size * 0.04
    ctx.save()
    ctx.arc(cx, by, bw * 0.30, math.pi, 2 * math.pi)
    ctx.set_source_rgba(color[0], color[1], color[2], alpha)
    ctx.set_line_width(max(1.6, size * 0.13))
    ctx.stroke()
    fill_rounded_rect(ctx, bx, by, bw, bh, size * 0.14, color, alpha)
    ctx.restore()


def draw_keycap(
    ctx: cairo.Context,
    label: str,
    x: float,
    y: float,
    w: float = 64.0,
    h: float = 54.0,
    pressed: float = 0.0,
    accent: Tuple[float, float, float] = C_INDIGO,
    alpha: float = 1.0,
    font_str: str = "DejaVu Sans Mono Bold 18",
) -> None:
    if alpha <= 0.01:
        return
    press_dy = pressed * 4.5
    depth = max(1.5, 6.0 - press_dy)

    fill_rounded_rect(
        ctx,
        x,
        y + press_dy + depth,
        w,
        h,
        12.0,
        (0.04, 0.04, 0.06),
        alpha * 0.95,
    )
    stroke_rounded_rect(
        ctx,
        x,
        y + press_dy + depth,
        w,
        h,
        12.0,
        accent if pressed > 0.3 else C_BORDER,
        alpha * (0.85 if pressed > 0.3 else 0.55),
        1.5,
    )

    if pressed > 0.05:
        rounded_rect(ctx, x - 6, y + press_dy - 6, w + 12, h + 12, 16)
        ctx.set_source_rgba(accent[0], accent[1], accent[2], alpha * pressed * 0.32)
        ctx.fill()

    top_color = (
        lerp(0.13, accent[0] * 0.45, pressed),
        lerp(0.13, accent[1] * 0.45, pressed),
        lerp(0.16, accent[2] * 0.55, pressed),
    )
    fill_rounded_rect(ctx, x, y + press_dy, w, h, 12.0, top_color, alpha * 0.98)
    stroke_rounded_rect(
        ctx,
        x,
        y + press_dy,
        w,
        h,
        12.0,
        C_INDIGO_LT if pressed > 0.3 else (0.35, 0.35, 0.40),
        alpha * 0.9,
        1.5,
    )

    draw_text(
        ctx,
        label,
        x + w / 2.0,
        y + press_dy + h / 2.0,
        font_str,
        C_WHITE,
        alpha,
        align="center",
        valign="middle",
    )


def draw_rapidcal_logo(
    ctx: cairo.Context,
    cx: float,
    cy: float,
    size: float = 120.0,
    alpha: float = 1.0,
    needle_progress: float = 1.0,
    pulse: float = 0.0,
) -> None:
    scale = size / 120.0
    ctx.save()
    ctx.translate(cx - size / 2.0, cy - size / 2.0)
    ctx.scale(scale, scale)

    rounded_rect(ctx, -10, -10, 140, 140, 34)
    ctx.set_source_rgba(C_INDIGO[0], C_INDIGO[1], C_INDIGO[2], alpha * (0.24 + 0.10 * pulse))
    ctx.fill()

    rounded_rect(ctx, 0, 0, 120, 120, 28)
    bg_grad = cairo.LinearGradient(0, 0, 120, 120)
    bg_grad.add_color_stop_rgba(0, 24 / 255, 24 / 255, 27 / 255, alpha)
    bg_grad.add_color_stop_rgba(1, 9 / 255, 9 / 255, 11 / 255, alpha)
    ctx.set_source(bg_grad)
    ctx.fill()
    stroke_rounded_rect(ctx, 0, 0, 120, 120, 28, (0.28, 0.28, 0.33), alpha, 2.2)

    fill_rounded_rect(ctx, 22, 26, 76, 72, 14, C_BG_OBS, alpha)
    stroke_rounded_rect(ctx, 22, 26, 76, 72, 14, C_BORDER, alpha, 2.0)

    ctx.save()
    rounded_rect(ctx, 22, 26, 76, 72, 14)
    ctx.clip()
    ctx.rectangle(22, 26, 76, 20)
    acc_grad = cairo.LinearGradient(20, 20, 100, 100)
    acc_grad.add_color_stop_rgba(0, C_INDIGO_LT[0], C_INDIGO_LT[1], C_INDIGO_LT[2], alpha)
    acc_grad.add_color_stop_rgba(1, 79 / 255, 70 / 255, 229 / 255, alpha)
    ctx.set_source(acc_grad)
    ctx.fill()
    ctx.restore()

    fill_rounded_rect(ctx, 38, 18, 6, 14, 3, (165 / 255, 180 / 255, 252 / 255), alpha)
    fill_rounded_rect(ctx, 76, 18, 6, 14, 3, (165 / 255, 180 / 255, 252 / 255), alpha)

    fill_rounded_rect(ctx, 32, 56, 24, 12, 4, C_INDIGO, alpha * 0.92)
    fill_rounded_rect(ctx, 62, 56, 26, 20, 4, C_SKY, alpha * 0.88)
    fill_rounded_rect(ctx, 32, 74, 24, 14, 4, C_EMERALD, alpha * 0.88)

    if needle_progress > 0:
        nx2 = lerp(28.0, 94.0, clamp(needle_progress))
        ctx.move_to(26, 70)
        ctx.line_to(nx2, 70)
        ctx.set_source_rgba(C_ROSE[0], C_ROSE[1], C_ROSE[2], alpha)
        ctx.set_line_width(2.8)
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        ctx.stroke()

        ctx.arc(28, 70, 4.2 + pulse * 0.8, 0, 2 * math.pi)
        ctx.set_source_rgba(C_ROSE[0], C_ROSE[1], C_ROSE[2], alpha)
        ctx.fill()

    ctx.restore()


def load_png_as_surface(path: Path) -> Optional[cairo.ImageSurface]:
    if not path.exists():
        return None
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    r, g, b, a = img.split()
    bgra = Image.merge("RGBA", (b, g, r, a))
    buf = bytearray(bgra.tobytes())
    return cairo.ImageSurface.create_for_data(buf, cairo.FORMAT_ARGB32, w, h, w * 4)


# ---------------------------------------------------------------------------
# Pre-rendered Base Ambient Background & HUD
# ---------------------------------------------------------------------------
def create_base_background_surface() -> cairo.ImageSurface:
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, WIDTH, HEIGHT)
    ctx = cairo.Context(surf)

    ctx.rectangle(0, 0, WIDTH, HEIGHT)
    ctx.set_source_rgb(*C_BG_OBS)
    ctx.fill()

    g1 = cairo.RadialGradient(WIDTH * 0.20, HEIGHT * 0.18, 20, WIDTH * 0.20, HEIGHT * 0.18, 780)
    g1.add_color_stop_rgba(0.0, C_INDIGO[0], C_INDIGO[1], C_INDIGO[2], 0.17)
    g1.add_color_stop_rgba(0.55, C_INDIGO[0], C_INDIGO[1], C_INDIGO[2], 0.05)
    g1.add_color_stop_rgba(1.0, 0, 0, 0, 0.0)
    ctx.set_source(g1)
    ctx.rectangle(0, 0, WIDTH, HEIGHT)
    ctx.fill()

    g2 = cairo.RadialGradient(WIDTH * 0.82, HEIGHT * 0.76, 20, WIDTH * 0.82, HEIGHT * 0.76, 720)
    g2.add_color_stop_rgba(0.0, C_SKY[0], C_SKY[1], C_SKY[2], 0.13)
    g2.add_color_stop_rgba(0.6, C_EMERALD[0], C_EMERALD[1], C_EMERALD[2], 0.04)
    g2.add_color_stop_rgba(1.0, 0, 0, 0, 0.0)
    ctx.set_source(g2)
    ctx.rectangle(0, 0, WIDTH, HEIGHT)
    ctx.fill()

    grid_step = 64
    ctx.set_line_width(1.0)
    ctx.set_source_rgba(1.0, 1.0, 1.0, 0.026)
    for x in range(0, WIDTH + grid_step, grid_step):
        ctx.move_to(x + 0.5, 0)
        ctx.line_to(x + 0.5, HEIGHT)
    for y in range(0, HEIGHT + grid_step, grid_step):
        ctx.move_to(0, y + 0.5)
        ctx.line_to(WIDTH, y + 0.5)
    ctx.stroke()

    surf.flush()
    return surf


def draw_top_cinema_hud(ctx: cairo.Context, t: float) -> None:
    if t < 1.2 or t > DURATION_SEC - 0.5:
        return
    hud_alpha = min(
        clamp((t - 1.2) / 0.6),
        clamp((DURATION_SEC - 0.5 - t) / 0.6),
    ) * 0.88

    # Top-left compact brand pill with clean spacing
    if 4.4 <= t <= 28.8:
        fill_rounded_rect(ctx, 42, 26, 198, 36, 18, C_BG_CARD, hud_alpha * 0.9)
        stroke_rounded_rect(ctx, 42, 26, 198, 36, 18, C_BORDER, hud_alpha * 0.75, 1.0)
        ctx.arc(62, 44, 5.0, 0, 2 * math.pi)
        ctx.set_source_rgba(C_INDIGO[0], C_INDIGO[1], C_INDIGO[2], hud_alpha)
        ctx.fill()
        draw_text(ctx, "RapidCal", 76, 44, "Inter Bold 13", C_TEXT_PRI, hud_alpha, valign="middle")
        fill_rounded_rect(ctx, 162, 33, 66, 22, 11, C_INDIGO, hud_alpha * 0.25)
        draw_text(ctx, "<1ms", 195, 44, "DejaVu Sans Mono Bold 10.5", C_INDIGO_LT, hud_alpha, align="center", valign="middle")

    # Bottom sleek timeline progress bar
    bar_w = WIDTH - 120
    bar_x = 60
    bar_y = HEIGHT - 22
    fill_rounded_rect(ctx, bar_x, bar_y, bar_w, 3, 1.5, C_BORDER, hud_alpha * 0.35)
    prog = clamp(t / DURATION_SEC)
    fill_rounded_rect(ctx, bar_x, bar_y, max(6.0, bar_w * prog), 3, 1.5, C_INDIGO_LT, hud_alpha * 0.85)


# ---------------------------------------------------------------------------
# Scene 1 (0.0s – 4.48s): Hook & Brand Reveal
# ---------------------------------------------------------------------------
def render_scene_1(ctx: cairo.Context, t: float) -> None:
    alpha = scene_fade(t, 0.0, 4.48, fade_in=0.25, fade_out=0.35)
    if alpha <= 0.005:
        return

    sweep_p = ease_in_out_cubic(norm_window(t, 0.68, 1.24))
    lx = lerp(120.0, WIDTH - 120.0, sweep_p)

    # Part A (0.0s - 1.24s): Legacy Electron / Cloud Calendar Bloat Warning -> Sliced by Needle
    if t < 1.24:
        pop = ease_out_back(norm_window(t, 0.05, 0.42))
        cw, ch = 980 * pop, 142 * pop
        cx, cy = WIDTH / 2 - cw / 2, HEIGHT / 2 - ch / 2 - 20

        ctx.save()
        if t >= 0.68:
            # Slice and wipe the bloat card from left to right as the laser needle sweeps across
            ctx.rectangle(lx, 0, max(0.0, WIDTH - lx), HEIGHT)
            ctx.clip()

        draw_glass_card(
            ctx, cx, cy, cw, ch, 18,
            bg_color=(0.12, 0.07, 0.09),
            bg_alpha=0.92 * alpha,
            border_color=C_ROSE,
            border_alpha=0.6 * alpha,
            glow_color=C_ROSE,
            glow_alpha=0.22 * alpha,
        )
        draw_text(
            ctx,
            "LEGACY CLOUD-PROXIED ELECTRON CALENDARS",
            WIDTH / 2,
            cy + 40,
            "DejaVu Sans Mono Bold 13",
            C_ROSE,
            alpha,
            align="center",
            valign="middle",
            letter_spacing=2,
        )
        draw_text(
            ctx,
            "340ms Input Lag   •   620MB RAM   •   3rd-Party Cloud Middlemen",
            WIDTH / 2,
            cy + 90,
            "Inter SemiBold 22",
            C_TEXT_SEC,
            alpha,
            align="center",
            valign="middle",
        )
        ctx.restore()

    # Laser Live-Time Needle sweep across screen (0.68s - 1.48s)
    if 0.68 <= t <= 1.48:
        sweep_fade = clamp(1.0 - norm_window(t, 1.18, 1.48)) * alpha
        ly = HEIGHT / 2 - 20
        grad = cairo.LinearGradient(120, ly, max(121.0, lx), ly)
        grad.add_color_stop_rgba(0.0, C_ROSE[0], C_ROSE[1], C_ROSE[2], 0.0)
        grad.add_color_stop_rgba(0.7, C_ROSE[0], C_ROSE[1], C_ROSE[2], 0.65 * sweep_fade)
        grad.add_color_stop_rgba(1.0, 1.0, 0.45, 0.55, 1.0 * sweep_fade)
        ctx.move_to(120, ly)
        ctx.line_to(lx, ly)
        ctx.set_source(grad)
        ctx.set_line_width(4.0)
        ctx.stroke()

        ctx.arc(lx, ly, 8.0, 0, 2 * math.pi)
        ctx.set_source_rgba(C_ROSE[0], C_ROSE[1], C_ROSE[2], sweep_fade)
        ctx.fill()

    # Part B (1.16s - 4.48s): RapidCal Logo & Kinetic Hero Title
    if t >= 1.16:
        logo_p = spring_ease(norm_window(t, 1.16, 1.90))
        sub_alpha = ease_out_cubic(norm_window(t, 1.28, 1.95)) * alpha
        pulse = 0.5 + 0.5 * math.sin(t * 5.0)

        logo_y = lerp(265.0, 235.0, ease_out_cubic(norm_window(t, 1.16, 1.85)))
        draw_rapidcal_logo(
            ctx,
            WIDTH / 2,
            logo_y,
            size=130 * clamp(logo_p, 0.1, 1.15),
            alpha=alpha * clamp((t - 1.16) / 0.22),
            needle_progress=ease_out_cubic(norm_window(t, 1.38, 2.05)),
            pulse=pulse,
        )

        # Eyebrow Pill (generous width 760px so text fits cleanly inside)
        pill_w, pill_h = 760, 38
        pill_x, pill_y = WIDTH / 2 - pill_w / 2, 336 + (1.0 - sub_alpha) * 20
        fill_rounded_rect(ctx, pill_x, pill_y, pill_w, pill_h, 19, C_BG_CARD, sub_alpha * 0.92)
        stroke_rounded_rect(ctx, pill_x, pill_y, pill_w, pill_h, 19, C_INDIGO, sub_alpha * 0.65, 1.2)
        draw_text(
            ctx,
            "ENGINEERED IN RUST (TAURI V2) & SOLIDJS   •   MACOS   •   WINDOWS   •   LINUX",
            WIDTH / 2,
            pill_y + pill_h / 2,
            "DejaVu Sans Mono Bold 11.5",
            C_INDIGO_PALE,
            sub_alpha,
            align="center",
            valign="middle",
        )

        # Main Hero Title
        title_p = ease_out_expo(norm_window(t, 1.35, 2.15))
        title_y = 438 + (1.0 - title_p) * 28
        draw_gradient_text(
            ctx,
            "RapidCal",
            WIDTH / 2,
            title_y,
            "Inter Display ExtraBold 82",
            C_WHITE,
            C_INDIGO_PALE,
            C_SKY_LT,
            alpha=alpha * title_p,
        )

        # Tagline
        tag_p = ease_out_expo(norm_window(t, 1.55, 2.35))
        draw_text(
            ctx,
            "Sub-Millisecond Desktop Calendar. Zero Cloud Middlemen.",
            WIDTH / 2,
            528 + (1.0 - tag_p) * 22,
            "Inter SemiBold 30",
            C_TEXT_PRI,
            alpha * tag_p,
            align="center",
            valign="middle",
        )
        draw_text(
            ctx,
            "Direct Google Calendar v3 & Microsoft Outlook / 365 sync with local SQLite WAL + FTS5.",
            WIDTH / 2,
            576 + (1.0 - tag_p) * 22,
            "Inter Regular 19",
            C_TEXT_SEC,
            alpha * tag_p * 0.92,
            align="center",
            valign="middle",
        )

        # Three Metric Cards at Bottom (clean 3-row vertical hierarchy)
        metrics = [
            ("< 1ms", "UI Frame Budget", "Zero-VDOM SolidJS Signals + 1px Grid", C_INDIGO),
            ("< 10MB", "Background RAM", "Native Rust Tray Daemon & Sync Loop", C_SKY),
            ("< 2ms", "FTS5 Local Search", "Offline-First SQLite WAL + Outbox Queue", C_EMERALD),
        ]
        card_w, card_h, gap = 445, 168, 34
        start_x = WIDTH / 2 - (3 * card_w + 2 * gap) / 2
        for idx, (stat, title, desc, col) in enumerate(metrics):
            mp = spring_ease(norm_window(t, 1.75 + idx * 0.16, 2.55 + idx * 0.16))
            if mp <= 0.01:
                continue
            cx = start_x + idx * (card_w + gap)
            cy = 658 + (1.0 - mp) * 45
            ca = alpha * clamp((t - (1.75 + idx * 0.16)) / 0.3)
            draw_glass_card(
                ctx, cx, cy, card_w, card_h, 16,
                bg_color=C_BG_CARD, bg_alpha=0.92 * ca,
                border_color=col, border_alpha=0.6 * ca,
                glow_color=col, glow_alpha=0.18 * ca,
            )
            draw_text(ctx, stat, cx + 30, cy + 40, "DejaVu Sans Mono Bold 32", col, ca, valign="middle")
            draw_text(ctx, title, cx + 30, cy + 88, "Inter Bold 19", C_TEXT_PRI, ca, valign="middle")
            draw_text(ctx, desc, cx + 30, cy + 128, "Inter Medium 14", C_TEXT_SEC, ca * 0.95, valign="middle")


# ---------------------------------------------------------------------------
# Shared Interactive Desktop App Window Renderer (Scenes 2 & 3)
# ---------------------------------------------------------------------------
def draw_interactive_desktop_window(
    ctx: cairo.Context,
    t: float,
    win_x: float,
    win_y: float,
    win_w: float,
    win_h: float,
    alpha: float,
    drag_progress: float = 0.0,
    show_new_nlp_event: float = 0.0,
    active_tab: str = "Week",
) -> None:
    if alpha <= 0.005:
        return
    draw_glass_card(
        ctx, win_x, win_y, win_w, win_h, 16,
        bg_color=C_BG_OBS, bg_alpha=0.97 * alpha,
        border_color=C_BORDER, border_alpha=0.8 * alpha,
        glow_color=C_INDIGO, glow_alpha=0.16 * alpha,
        shadow_alpha=0.6 * alpha,
    )

    # TopBar (height 52)
    tb_h = 52
    fill_rounded_rect(ctx, win_x + 1, win_y + 1, win_w - 2, tb_h, 15, (14 / 255, 14 / 255, 18 / 255), alpha)
    ctx.move_to(win_x, win_y + tb_h)
    ctx.line_to(win_x + win_w, win_y + tb_h)
    ctx.set_source_rgba(C_BORDER[0], C_BORDER[1], C_BORDER[2], 0.65 * alpha)
    ctx.set_line_width(1.0)
    ctx.stroke()

    # Window traffic dots + Brand
    for i, dc in enumerate([(0.95, 0.3, 0.35), (0.95, 0.7, 0.2), (0.2, 0.8, 0.45)]):
        ctx.arc(win_x + 24 + i * 18, win_y + 26, 5.5, 0, 2 * math.pi)
        ctx.set_source_rgba(dc[0], dc[1], dc[2], alpha * 0.85)
        ctx.fill()

    fill_rounded_rect(ctx, win_x + 84, win_y + 20, 11, 11, 3, C_INDIGO, alpha)
    draw_text(ctx, "RapidCal", win_x + 102, win_y + 26, "Inter Bold 14", C_TEXT_PRI, alpha, valign="middle")

    # Today button & Month header (well-spaced)
    fill_rounded_rect(ctx, win_x + 196, win_y + 13, 58, 26, 6, C_BG_ZINC800, alpha * 0.85)
    stroke_rounded_rect(ctx, win_x + 196, win_y + 13, 58, 26, 6, C_BORDER, alpha * 0.7)
    draw_text(ctx, "Today", win_x + 225, win_y + 26, "Inter Medium 11.5", C_TEXT_PRI, alpha, align="center", valign="middle")
    draw_text(ctx, "October 2026", win_x + 270, win_y + 26, "Inter Bold 14", C_TEXT_PRI, alpha, valign="middle")

    # View switcher tabs with exact measured widths
    tabs = [("Day", 48), ("3-Day", 58), ("Work Week", 88), ("Week", 56), ("Month", 60), ("Schedule", 74)]
    tab_x = win_x + 408
    total_tab_w = sum(w for _, w in tabs) + (len(tabs) - 1) * 4 + 8
    fill_rounded_rect(ctx, tab_x - 4, win_y + 11, total_tab_w, 30, 8, C_BG_ZINC900, alpha)
    stroke_rounded_rect(ctx, tab_x - 4, win_y + 11, total_tab_w, 30, 8, C_BORDER, alpha * 0.6)
    cx_tab = tab_x
    for tab, tw_tab in tabs:
        if tab == active_tab:
            fill_rounded_rect(ctx, cx_tab, win_y + 14, tw_tab, 24, 6, C_INDIGO, alpha)
            draw_text(ctx, tab, cx_tab + tw_tab / 2, win_y + 26, "Inter SemiBold 11.5", C_WHITE, alpha, align="center", valign="middle")
        else:
            draw_text(ctx, tab, cx_tab + tw_tab / 2, win_y + 26, "Inter Medium 11.5", C_TEXT_SEC, alpha, align="center", valign="middle")
        cx_tab += tw_tab + 4

    # Up Next Meeting Pill + Search Bar + +Event Button
    pill_x = win_x + 832
    pill_w = 212
    fill_rounded_rect(ctx, pill_x, win_y + 12, pill_w, 28, 14, (30 / 255, 27 / 255, 75 / 255), alpha * 0.9)
    stroke_rounded_rect(ctx, pill_x, win_y + 12, pill_w, 28, 14, C_INDIGO, alpha * 0.7)
    ctx.arc(pill_x + 14, win_y + 26, 3.8, 0, 2 * math.pi)
    ctx.set_source_rgba(C_INDIGO_LT[0], C_INDIGO_LT[1], C_INDIGO_LT[2], alpha)
    ctx.fill()
    draw_text(ctx, "In 4m • Sync Call", pill_x + 25, win_y + 26, "Inter Medium 11", C_INDIGO_PALE, alpha, valign="middle")
    fill_rounded_rect(ctx, pill_x + pill_w - 58, win_y + 16, 50, 20, 10, C_INDIGO, alpha)
    draw_text(ctx, "⌘+J", pill_x + pill_w - 33, win_y + 26, "DejaVu Sans Mono Bold 10", C_WHITE, alpha, align="center", valign="middle")

    # Quick Add / Search input bar
    sb_x = win_x + 1060
    sb_w_bar = 264
    fill_rounded_rect(ctx, sb_x, win_y + 12, sb_w_bar, 28, 7, C_BG_ZINC900, alpha)
    stroke_rounded_rect(ctx, sb_x, win_y + 12, sb_w_bar, 28, 7, C_BORDER, alpha * 0.7)
    draw_text(ctx, "Quick Add / FTS5 Search...", sb_x + 12, win_y + 26, "Inter Regular 11.5", C_TEXT_MUT, alpha, valign="middle")
    draw_text(ctx, "⌘K", sb_x + sb_w_bar - 22, win_y + 26, "DejaVu Sans Mono Bold 10.5", C_TEXT_SEC, alpha, align="center", valign="middle")

    # + Event button & sync status dot
    fill_rounded_rect(ctx, win_x + win_w - 204, win_y + 12, 78, 28, 7, C_INDIGO, alpha)
    draw_text(ctx, "+ Event", win_x + win_w - 165, win_y + 26, "Inter SemiBold 11.5", C_WHITE, alpha, align="center", valign="middle")
    ctx.arc(win_x + win_w - 104, win_y + 26, 4.5, 0, 2 * math.pi)
    ctx.set_source_rgba(C_EMERALD[0], C_EMERALD[1], C_EMERALD[2], alpha)
    ctx.fill()
    draw_text(ctx, "WAL Synced", win_x + win_w - 92, win_y + 26, "DejaVu Sans Mono Medium 10.5", C_EMERALD_LT, alpha, valign="middle")

    # Body layout: LeftSidebar (270px) | Center Grid | Right Inspector (295px)
    body_y = win_y + tb_h
    body_h = win_h - tb_h
    sb_w = 270
    insp_w = 295
    grid_x = win_x + sb_w
    grid_w = win_w - sb_w - insp_w

    # Left Sidebar
    ctx.move_to(grid_x, body_y)
    ctx.line_to(grid_x, body_y + body_h)
    ctx.set_source_rgba(C_BORDER[0], C_BORDER[1], C_BORDER[2], 0.55 * alpha)
    ctx.stroke()

    draw_text(ctx, "CONNECTED ACCOUNTS", win_x + 18, body_y + 22, "Inter Bold 10.5", C_TEXT_MUT, alpha, letter_spacing=1)

    accounts = [
        ("GOOGLE", "alex@acme.com", C_INDIGO, [("Work Schedule", C_INDIGO), ("Product & Launches", C_ROSE)]),
        ("OUTLOOK", "alex@contoso.com", C_SKY, [("Contoso Team", C_SKY), ("Leadership & Ops", C_AMBER)]),
        ("GOOGLE", "alex@gmail.com", C_EMERALD, [("Personal & Wellness", C_EMERALD)]),
    ]
    ay = body_y + 44
    for provider, email, pcol, cals in accounts:
        card_h_acc = 42 + len(cals) * 26
        fill_rounded_rect(ctx, win_x + 14, ay, sb_w - 28, card_h_acc, 10, C_BG_ZINC900, alpha * 0.9)
        stroke_rounded_rect(ctx, win_x + 14, ay, sb_w - 28, card_h_acc, 10, C_BORDER, alpha * 0.55)
        fill_rounded_rect(ctx, win_x + 24, ay + 11, 58, 18, 4, pcol, alpha * 0.22)
        stroke_rounded_rect(ctx, win_x + 24, ay + 11, 58, 18, 4, pcol, alpha * 0.65)
        draw_text(ctx, provider, win_x + 53, ay + 20, "DejaVu Sans Mono Bold 9.5", pcol, alpha, align="center", valign="middle")
        draw_text(ctx, email, win_x + 90, ay + 20, "Inter Medium 11", C_TEXT_PRI, alpha, valign="middle")
        for ci, (cname, ccol) in enumerate(cals):
            cy_cal = ay + 42 + ci * 24
            fill_rounded_rect(ctx, win_x + 26, cy_cal - 6, 12, 12, 3, ccol, alpha)
            draw_text(ctx, cname, win_x + 46, cy_cal, "Inter Regular 11.5", C_TEXT_SEC, alpha, valign="middle")
        ay += card_h_acc + 12

    # Local Vault Status card in Sidebar
    fill_rounded_rect(ctx, win_x + 14, ay + 6, sb_w - 28, 76, 10, (12 / 255, 42 / 255, 34 / 255), alpha * 0.55)
    stroke_rounded_rect(ctx, win_x + 14, ay + 6, sb_w - 28, 76, 10, C_EMERALD, alpha * 0.45)
    draw_text(ctx, "LOCAL SQLITE WAL VAULT", win_x + 26, ay + 24, "DejaVu Sans Mono Bold 9.5", C_EMERALD_LT, alpha)
    draw_text(ctx, "OS Keychain + AES-256-GCM", win_x + 26, ay + 44, "Inter Medium 11", C_TEXT_PRI, alpha)
    draw_text(ctx, "Loopback 127.0.0.1 PKCE", win_x + 26, ay + 62, "DejaVu Sans Mono Regular 10", C_TEXT_SEC, alpha)

    # Center TimeGrid (Gutter 106px with distinct UTC and MST columns + 5 Weekday Columns)
    gutter_w = 106
    col_area_x = grid_x + gutter_w
    col_area_w = grid_w - gutter_w
    days = [("MON", "5", False), ("TUE", "6", False), ("WED", "7", False), ("THU", "8", True), ("FRI", "9", False)]
    col_w = col_area_w / len(days)
    hdr_h = 44

    # Dual-timezone header labels & divider
    draw_text(ctx, "UTC", grid_x + 26, body_y + 22, "DejaVu Sans Mono Bold 10", C_TEXT_MUT, alpha, align="center", valign="middle")
    draw_text(ctx, "MST", grid_x + 78, body_y + 22, "DejaVu Sans Mono Bold 10", C_TEXT_SEC, alpha, align="center", valign="middle")
    ctx.move_to(grid_x + 52, body_y)
    ctx.line_to(grid_x + 52, body_y + body_h)
    ctx.set_source_rgba(C_BORDER[0], C_BORDER[1], C_BORDER[2], 0.28 * alpha)
    ctx.stroke()

    for di, (dname, dnum, is_today) in enumerate(days):
        dx = col_area_x + di * col_w
        ctx.move_to(dx, body_y)
        ctx.line_to(dx, body_y + body_h)
        ctx.set_source_rgba(C_BORDER[0], C_BORDER[1], C_BORDER[2], 0.42 * alpha)
        ctx.stroke()

        draw_text(ctx, dname, dx + col_w / 2 - 16, body_y + 22, "Inter Bold 11.5", C_TEXT_PRI if is_today else C_TEXT_SEC, alpha, align="center", valign="middle")
        if is_today:
            ctx.arc(dx + col_w / 2 + 18, body_y + 22, 13, 0, 2 * math.pi)
            ctx.set_source_rgba(C_ROSE[0], C_ROSE[1], C_ROSE[2], alpha)
            ctx.fill()
            draw_text(ctx, dnum, dx + col_w / 2 + 18, body_y + 22, "Inter Bold 12", C_WHITE, alpha, align="center", valign="middle")
        else:
            draw_text(ctx, dnum, dx + col_w / 2 + 18, body_y + 22, "Inter SemiBold 12", C_TEXT_SEC, alpha, align="center", valign="middle")

    grid_top = body_y + hdr_h
    grid_h = body_h - hdr_h
    num_hours = 8
    hour_h = grid_h / num_hours
    for hi in range(num_hours + 1):
        hy = grid_top + hi * hour_h
        ctx.move_to(grid_x, hy)
        ctx.line_to(grid_x + grid_w, hy)
        ctx.set_source_rgba(C_BORDER[0], C_BORDER[1], C_BORDER[2], (0.55 if hi == 0 else 0.32) * alpha)
        ctx.stroke()
        if hi < num_hours:
            hr_mst = 9 + hi
            hr_utc = (hr_mst + 7) % 24
            lbl_mst = f"{hr_mst if hr_mst <= 12 else hr_mst - 12} {'AM' if hr_mst < 12 else 'PM'}"
            lbl_utc = f"{hr_utc:02d}:00"
            draw_text(ctx, lbl_utc, grid_x + 26, hy + 14, "DejaVu Sans Mono Regular 9.5", C_TEXT_MUT, alpha * 0.8, align="center", valign="middle")
            draw_text(ctx, lbl_mst, grid_x + 79, hy + 14, "DejaVu Sans Mono Medium 10", C_TEXT_SEC, alpha, align="center", valign="middle")

    # Helper to draw an event block on the grid (clipped cleanly to card bounds)
    def draw_event_block(
        day_idx: int,
        start_hr: float,
        dur_hr: float,
        title: str,
        subtitle: str,
        col: Tuple[float, float, float],
        badge: Optional[str] = None,
        badge_icon: Optional[str] = None,
        striped: bool = False,
        ev_alpha: float = 1.0,
        highlight_glow: float = 0.0,
    ) -> Tuple[float, float, float, float]:
        ex = col_area_x + day_idx * col_w + 5
        ew = col_w - 10
        ey = grid_top + (start_hr - 9.0) * hour_h + 2
        eh = dur_hr * hour_h - 4

        if highlight_glow > 0:
            rounded_rect(ctx, ex - 5, ey - 5, ew + 10, eh + 10, 10)
            ctx.set_source_rgba(col[0], col[1], col[2], alpha * ev_alpha * highlight_glow * 0.45)
            ctx.fill()

        ctx.save()
        rounded_rect(ctx, ex, ey, ew, eh, 7)
        ctx.clip()

        fill_rounded_rect(ctx, ex, ey, ew, eh, 7, (col[0] * 0.25, col[1] * 0.25, col[2] * 0.30), alpha * ev_alpha * 0.94)

        if striped:
            ctx.set_source_rgba(1.0, 1.0, 1.0, 0.07 * alpha * ev_alpha)
            ctx.set_line_width(4.0)
            for sx in range(int(ex - eh), int(ex + ew + eh), 14):
                ctx.move_to(sx, ey + eh)
                ctx.line_to(sx + eh, ey)
            ctx.stroke()

        fill_rounded_rect(ctx, ex, ey, 4.5, eh, 2.5, col, alpha * ev_alpha)

        draw_text(ctx, title, ex + 11, ey + 8, "Inter SemiBold 11.5", C_WHITE, alpha * ev_alpha)
        draw_text(ctx, subtitle, ex + 11, ey + 26, "DejaVu Sans Mono Regular 9", C_TEXT_SEC, alpha * ev_alpha)
        if badge and eh >= 56:
            icon_pad = 16 if badge_icon else 0
            bw_b = min(ew - 18, len(badge) * 6.2 + 16 + icon_pad)
            by_b = ey + eh - 24
            fill_rounded_rect(ctx, ex + 10, by_b, bw_b, 18, 4, col, alpha * ev_alpha * 0.36)
            if badge_icon == "video":
                draw_icon_video(ctx, ex + 19, by_b + 9, size=10.0, color=C_WHITE, alpha=alpha * ev_alpha)
            elif badge_icon == "bolt":
                draw_icon_bolt(ctx, ex + 19, by_b + 9, size=10.5, color=C_AMBER, alpha=alpha * ev_alpha)
            elif badge_icon == "sparkle":
                draw_icon_sparkle(ctx, ex + 19, by_b + 9, size=10.0, color=C_INDIGO_PALE, alpha=alpha * ev_alpha)
            draw_text(ctx, badge, ex + 15 + icon_pad, by_b + 9, "DejaVu Sans Mono Bold 9", C_WHITE, alpha * ev_alpha, valign="middle")

        ctx.restore()
        stroke_rounded_rect(ctx, ex, ey, ew, eh, 7, col, alpha * ev_alpha * (0.95 if highlight_glow > 0 else 0.65), 1.6 if highlight_glow > 0 else 1.1)
        return ex, ey, ew, eh

    # Events across Mon-Fri
    draw_event_block(0, 9.5, 1.25, "Rust Core Triage", "09:30 – 10:45 • Meet", C_INDIGO, "Join Meet", badge_icon="video")
    draw_event_block(0, 13.0, 1.5, "SQLite WAL Bench", "1:00 – 2:30 PM", C_EMERALD)

    draw_event_block(1, 10.0, 1.5, "Graph Delta Sync", "10:00 – 11:30 AM", C_SKY, "Teams Call", badge_icon="video")
    draw_event_block(1, 14.0, 1.25, "Quarterly Roadmap", "2:00 – 3:15 PM", C_AMBER, striped=True)

    draw_event_block(2, 9.5, 1.0, "Design Systems Sync", "09:30 – 10:30 AM", C_INDIGO)
    draw_event_block(2, 15.0, 1.25, "[Busy] Blocked Time", "Mirrored to Outlook", C_SKY, striped=True)

    # Thursday interactive dragged event
    drag_start_hr = lerp(9.5, 11.0, ease_in_out_cubic(drag_progress))
    drag_label = "09:30 – 11:00" if drag_progress < 0.15 else ("10:15 – 11:45" if drag_progress < 0.75 else "11:00 – 12:30")
    ex_d, ey_d, ew_d, eh_d = draw_event_block(
        3,
        drag_start_hr,
        1.5,
        "Architecture Sync",
        f"{drag_label} • Meet",
        C_INDIGO,
        "<0.4ms Outbox" if drag_progress > 0.1 else "Cmd+J",
        badge_icon="bolt" if drag_progress > 0.1 else "video",
        highlight_glow=1.0 if 0.05 < drag_progress < 0.95 else 0.3,
    )

    draw_event_block(3, 14.0, 1.5, "Contoso M365 Sync", "2:00 – 3:30 PM • Teams", C_SKY, "Join Teams", badge_icon="video")

    # Friday events
    draw_event_block(4, 10.0, 1.25, "Release v0.1 Build", "10:00 – 11:15 AM", C_ROSE)
    if show_new_nlp_event > 0.01:
        ev_p = spring_ease(show_new_nlp_event)
        draw_event_block(
            4,
            14.0 - (1.0 - ev_p) * 0.6,
            1.25,
            "Product Launch Sync",
            "2:00 – 3:15 PM • Meet",
            C_INDIGO,
            "Created via ⌘K",
            badge_icon="sparkle",
            ev_alpha=clamp(show_new_nlp_event * 2.0),
            highlight_glow=1.0,
        )

    # Live current-time needle across Thursday (10:42 AM)
    needle_y = grid_top + (10.7 - 9.0) * hour_h
    ctx.move_to(col_area_x, needle_y)
    ctx.line_to(col_area_x + col_area_w, needle_y)
    ctx.set_source_rgba(C_ROSE[0], C_ROSE[1], C_ROSE[2], alpha * 0.85)
    ctx.set_line_width(2.0)
    ctx.stroke()
    ctx.arc(col_area_x + 3 * col_w, needle_y, 5.0, 0, 2 * math.pi)
    ctx.set_source_rgba(C_ROSE[0], C_ROSE[1], C_ROSE[2], alpha)
    ctx.fill()

    # Animated Cursor when dragging on Thursday
    if 0.02 < drag_progress < 0.98:
        cur_x = ex_d + ew_d * 0.55
        cur_y = ey_d + eh_d * 0.48
        ctx.save()
        ctx.translate(cur_x, cur_y)
        ctx.move_to(0, 0)
        ctx.line_to(0, 22)
        ctx.line_to(6, 17)
        ctx.line_to(11, 26)
        ctx.line_to(15, 24)
        ctx.line_to(10, 15)
        ctx.line_to(17, 15)
        ctx.close_path()
        ctx.set_source_rgba(1, 1, 1, alpha)
        ctx.fill_preserve()
        ctx.set_source_rgba(0, 0, 0, alpha * 0.85)
        ctx.set_line_width(1.5)
        ctx.stroke()
        ctx.restore()

    # Right Event Inspector
    insp_x = grid_x + grid_w
    ctx.move_to(insp_x, body_y)
    ctx.line_to(insp_x, body_y + body_h)
    ctx.set_source_rgba(C_BORDER[0], C_BORDER[1], C_BORDER[2], 0.55 * alpha)
    ctx.stroke()

    draw_text(ctx, "EVENT DETAILS", insp_x + 18, body_y + 22, "Inter Bold 10.5", C_TEXT_MUT, alpha, letter_spacing=1)
    if drag_progress > 0.35:
        fill_rounded_rect(ctx, insp_x + insp_w - 116, body_y + 12, 100, 20, 5, C_EMERALD, alpha * 0.2)
        stroke_rounded_rect(ctx, insp_x + insp_w - 116, body_y + 12, 100, 20, 5, C_EMERALD, alpha * 0.7)
        draw_text(ctx, "WAL 0.38ms", insp_x + insp_w - 66, body_y + 22, "DejaVu Sans Mono Bold 9.5", C_EMERALD_LT, alpha, align="center", valign="middle")

    fill_rounded_rect(ctx, insp_x + 16, body_y + 42, insp_w - 32, 42, 8, C_BG_ZINC900, alpha)
    stroke_rounded_rect(ctx, insp_x + 16, body_y + 42, insp_w - 32, 42, 8, C_BORDER, alpha * 0.7)
    insp_title = "Product Launch Sync" if show_new_nlp_event > 0.2 else "Architecture Sync"
    draw_text(ctx, insp_title, insp_x + 28, body_y + 63, "Inter SemiBold 13", C_TEXT_PRI, alpha, valign="middle")

    fill_rounded_rect(ctx, insp_x + 16, body_y + 98, insp_w - 32, 54, 10, (30 / 255, 27 / 255, 75 / 255), alpha * 0.65)
    stroke_rounded_rect(ctx, insp_x + 16, body_y + 98, insp_w - 32, 54, 10, C_INDIGO, alpha * 0.6)
    draw_text(ctx, "GOOGLE MEET", insp_x + 28, body_y + 114, "DejaVu Sans Mono Bold 10", C_INDIGO_LT, alpha)
    draw_text(ctx, "meet.google.com/rc", insp_x + 28, body_y + 132, "DejaVu Sans Mono Regular 9.5", C_TEXT_SEC, alpha)
    fill_rounded_rect(ctx, insp_x + insp_w - 100, body_y + 110, 72, 30, 7, C_INDIGO, alpha)
    draw_text(ctx, "Join ⌘J", insp_x + insp_w - 64, body_y + 125, "Inter SemiBold 11", C_WHITE, alpha, align="center", valign="middle")

    fill_rounded_rect(ctx, insp_x + 16, body_y + 168, insp_w - 32, 86, 10, C_BG_ZINC900, alpha)
    stroke_rounded_rect(ctx, insp_x + 16, body_y + 168, insp_w - 32, 86, 10, C_BORDER, alpha * 0.6)
    draw_text(ctx, "SCHEDULE & TIMEZONE", insp_x + 26, body_y + 186, "DejaVu Sans Mono Bold 9.5", C_TEXT_MUT, alpha)
    if show_new_nlp_event > 0.2:
        insp_time_str = "Fri, Oct 9 • 2:00 – 3:15 PM"
        insp_meta_str = "CALENDAR: Work Schedule (#work)"
    else:
        ampm = "AM" if drag_progress < 0.75 else "PM"
        insp_time_str = f"Thu, Oct 8 • {drag_label} {ampm}"
        insp_meta_str = "RRULE: FREQ=WEEKLY;BYDAY=TH"
    draw_text(ctx, insp_time_str, insp_x + 26, body_y + 210, "DejaVu Sans Mono SemiBold 10", C_TEXT_PRI, alpha)
    draw_text(ctx, insp_meta_str, insp_x + 26, body_y + 232, "DejaVu Sans Mono Regular 9.5", C_INDIGO_LT, alpha)

    fill_rounded_rect(ctx, insp_x + 16, body_y + 270, insp_w - 32, 48, 10, C_BG_ZINC900, alpha)
    stroke_rounded_rect(ctx, insp_x + 16, body_y + 270, insp_w - 32, 48, 10, C_BORDER, alpha * 0.6)
    draw_text(ctx, "Going?", insp_x + 28, body_y + 294, "Inter Medium 12", C_TEXT_SEC, alpha, valign="middle")
    fill_rounded_rect(ctx, insp_x + 118, body_y + 280, 48, 28, 6, C_INDIGO, alpha)
    draw_text(ctx, "Yes", insp_x + 142, body_y + 294, "Inter SemiBold 11.5", C_WHITE, alpha, align="center", valign="middle")
    draw_text(ctx, "Maybe     No", insp_x + 214, body_y + 294, "Inter Medium 11.5", C_TEXT_MUT, alpha, align="center", valign="middle")

    fill_rounded_rect(ctx, insp_x + 16, body_y + 334, insp_w - 32, 88, 10, (14 / 255, 36 / 255, 52 / 255), alpha * 0.6)
    stroke_rounded_rect(ctx, insp_x + 16, body_y + 334, insp_w - 32, 88, 10, C_SKY, alpha * 0.5)
    draw_text(ctx, "CROSS-ACCOUNT BUSY BLOCK", insp_x + 28, body_y + 354, "DejaVu Sans Mono Bold 9.5", C_SKY_LT, alpha)
    draw_text(ctx, "Mirrored as [Busy] onto:", insp_x + 28, body_y + 376, "Inter Regular 11", C_TEXT_SEC, alpha)
    draw_text(ctx, "✓ alex@contoso.com", insp_x + 28, body_y + 398, "DejaVu Sans Mono Medium 10.5", C_EMERALD_LT, alpha)


# ---------------------------------------------------------------------------
# Scenes 2 & 3 (4.50s – 16.48s): Continuous Desktop Workspace, Drag & Cmd+K NLP
# ---------------------------------------------------------------------------
def render_scenes_2_and_3(ctx: cairo.Context, t: float) -> None:
    ws_alpha = scene_fade(t, 4.50, 16.48, fade_in=0.35, fade_out=0.35)
    if ws_alpha <= 0.005:
        return

    enter_p = ease_out_expo(norm_window(t, 4.50, 5.30))

    # Top Header transitions cleanly at 10.5s without overlap
    if t < 10.48:
        h2_a = ws_alpha * enter_p * clamp((10.48 - t) / 0.30)
        draw_text(
            ctx,
            "UNIFIED GOOGLE CALENDAR & MICROSOFT OUTLOOK 365 WORKSPACE",
            WIDTH / 2,
            46,
            "DejaVu Sans Mono Bold 12.5",
            C_INDIGO_LT,
            h2_a,
            align="center",
            valign="middle",
            letter_spacing=2,
        )
        draw_text(
            ctx,
            "1px Hairline Precision Grid  •  Dual-Timezone Gutters  •  <1ms Optimistic Outbox Edits",
            WIDTH / 2,
            82,
            "Inter Bold 26",
            C_TEXT_PRI,
            h2_a,
            align="center",
            valign="middle",
        )
    elif t >= 10.50:
        h3_a = ws_alpha * clamp((t - 10.50) / 0.30)
        draw_text(
            ctx,
            "KEYBOARD-FIRST VELOCITY  •  RUST NATURAL LANGUAGE PARSER & SQLITE FTS5",
            WIDTH / 2,
            46,
            "DejaVu Sans Mono Bold 12.5",
            C_INDIGO_LT,
            h3_a,
            align="center",
            valign="middle",
            letter_spacing=2,
        )
        draw_text(
            ctx,
            "Press Cmd/Ctrl + K to Parse Complex Schedules in <0.2ms",
            WIDTH / 2,
            82,
            "Inter Bold 26",
            C_TEXT_PRI,
            h3_a,
            align="center",
            valign="middle",
        )

    win_w, win_h = 1660, 850
    win_x = (WIDTH - win_w) / 2
    win_y = 120 + (1.0 - enter_p) * 55

    drag_p = ease_in_out_cubic(norm_window(t, 6.2, 8.3))
    nlp_created = norm_window(t, 14.98, 15.65)

    # Smoothly dim the desktop window while the Cmd+K modal is open (10.55s - 14.98s)
    dim_in = ease_in_out_cubic(norm_window(t, 10.55, 10.95))
    dim_out = ease_in_out_cubic(norm_window(t, 14.82, 15.02))
    win_dim = 1.0 - 0.64 * (dim_in * (1.0 - dim_out))

    draw_interactive_desktop_window(
        ctx,
        t,
        win_x,
        win_y,
        win_w,
        win_h,
        ws_alpha * enter_p * win_dim,
        drag_progress=drag_p,
        show_new_nlp_event=nlp_created,
    )

    # Scene 2 floating telemetry callout badge during/after drag (6.40s - 10.42s)
    if 6.40 <= t <= 10.42:
        badge_p = spring_ease(norm_window(t, 6.40, 7.10))
        badge_a = ws_alpha * clamp((t - 6.40) / 0.25) * clamp((10.42 - t) / 0.30)
        bw, bh = 680, 52
        bx, by = WIDTH / 2 - bw / 2, HEIGHT - 96 + (1.0 - badge_p) * 30
        draw_glass_card(
            ctx, bx, by, bw, bh, 26,
            bg_color=(14 / 255, 24 / 255, 22 / 255),
            bg_alpha=0.96 * badge_a,
            border_color=C_EMERALD,
            border_alpha=0.85 * badge_a,
            glow_color=C_EMERALD,
            glow_alpha=0.28 * badge_a,
        )
        ctx.arc(bx + 32, by + bh / 2, 6, 0, 2 * math.pi)
        ctx.set_source_rgba(C_EMERALD[0], C_EMERALD[1], C_EMERALD[2], badge_a)
        ctx.fill()
        draw_text(
            ctx,
            "Optimistic SQLite WAL Commit: 0.38ms   •   Delta Outbox Queued",
            bx + bw / 2 + 12,
            by + bh / 2,
            "DejaVu Sans Mono Bold 13",
            C_EMERALD_LT,
            badge_a,
            align="center",
            valign="middle",
        )

    # Scene 3 Command Palette Modal (10.55s - 14.98s), composited atomically via Cairo group
    modal_alpha = ws_alpha * clamp((t - 10.55) / 0.25) * clamp((14.98 - t) / 0.14)
    if modal_alpha > 0.005:
        modal_pop = spring_ease(norm_window(t, 10.60, 11.25))
        mw, mh = 1040, 470
        mx = WIDTH / 2 - mw / 2
        my = 225 + (1.0 - modal_pop) * 40

        ctx.push_group()
        ma = 1.0

        draw_glass_card(
            ctx, mx, my, mw, mh, 20,
            bg_color=(15 / 255, 15 / 255, 20 / 255),
            bg_alpha=0.99,
            border_color=C_INDIGO_LT,
            border_alpha=0.85,
            glow_color=C_INDIGO,
            glow_alpha=0.35,
            shadow_alpha=0.75,
        )

        fill_rounded_rect(ctx, mx + 26, my + 22, 214, 34, 9, C_INDIGO, ma)
        draw_icon_bolt(ctx, mx + 44, my + 39, size=13.0, color=C_AMBER, alpha=ma)
        draw_text(ctx, "Quick Add Event (C)", mx + 58, my + 39, "Inter SemiBold 13", C_WHITE, ma, align="left", valign="middle")

        fill_rounded_rect(ctx, mx + 252, my + 22, 210, 34, 9, C_BG_ZINC800, 0.75)
        draw_icon_search(ctx, mx + 272, my + 39, size=13.0, color=C_TEXT_SEC, alpha=ma)
        draw_text(ctx, "FTS5 Search (⌘F)", mx + 288, my + 39, "Inter Medium 13", C_TEXT_SEC, ma, align="left", valign="middle")
        draw_text(ctx, "RUST NLP AST + FTS5", mx + mw - 30, my + 39, "DejaVu Sans Mono Bold 11", C_EMERALD_LT, ma, align="right", valign="middle")

        fill_rounded_rect(ctx, mx + 26, my + 72, mw - 52, 68, 12, C_BG_OBS, ma)
        stroke_rounded_rect(ctx, mx + 26, my + 72, mw - 52, 68, 12, C_INDIGO, 0.9, 1.8)

        full_query = "Product Launch Sync tomorrow 2pm to 3:15pm #work @sarah meet"
        type_p = clamp((t - 11.15) / 3.25)
        n_chars = int(len(full_query) * type_p)
        typed_str = full_query[:n_chars]

        tw_typed, _ = draw_text(
            ctx,
            typed_str if typed_str else "Type an event in plain English...",
            mx + 46,
            my + 106,
            "DejaVu Sans Mono Medium 18.5",
            C_WHITE if typed_str else C_TEXT_MUT,
            ma,
            valign="middle",
        )
        if typed_str and (int(t * 4) % 2 == 0 or type_p < 1.0):
            caret_x = mx + 48 + tw_typed
            ctx.move_to(caret_x, my + 88)
            ctx.line_to(caret_x, my + 124)
            ctx.set_source_rgba(C_INDIGO_LT[0], C_INDIGO_LT[1], C_INDIGO_LT[2], ma)
            ctx.set_line_width(2.5)
            ctx.stroke()

        fill_rounded_rect(ctx, mx + 26, my + 160, mw - 52, 210, 14, C_BG_ZINC900, 0.98)
        stroke_rounded_rect(ctx, mx + 26, my + 160, mw - 52, 210, 14, C_BORDER, 0.8)
        draw_text(
            ctx,
            "LIVE RUST NLP PARSER PREVIEW  •  PARSE LATENCY: 0.18ms",
            mx + 48,
            my + 186,
            "DejaVu Sans Mono Bold 11",
            C_INDIGO_LT,
            ma,
        )

        tokens = [
            (11.35, "EVENT TITLE", "Product Launch Sync", C_INDIGO, False),
            (12.10, "DATE & TIME", "Fri, Oct 9, 2026  •  2:00 PM – 3:15 PM (1h 15m)", C_EMERALD, False),
            (13.15, "TARGET CALENDAR", "#work  →  Work Schedule (alex@acme.com)", C_SKY, False),
            (13.75, "ATTENDEE & VIDEO", "sarah@acme.com  •  ", C_AMBER, True),
        ]
        for idx, (appear_t, k_lbl, v_lbl, tcol, has_vid) in enumerate(tokens):
            if t < appear_t:
                continue
            tp = spring_ease(norm_window(t, appear_t, appear_t + 0.45))
            row_col = idx % 2
            row_idx = idx // 2
            tx = mx + 46 + row_col * 475
            ty = my + 212 + row_idx * 72 + (1.0 - tp) * 14
            ta = clamp((t - appear_t) / 0.2)
            fill_rounded_rect(ctx, tx, ty, 455, 58, 10, C_BG_OBS, ta * 0.95)
            stroke_rounded_rect(ctx, tx, ty, 455, 58, 10, tcol, ta * 0.75, 1.3)
            draw_text(ctx, k_lbl, tx + 16, ty + 18, "DejaVu Sans Mono Bold 9.5", tcol, ta, valign="middle")
            if has_vid:
                w_prefix, _ = draw_text(ctx, v_lbl, tx + 16, ty + 40, "Inter SemiBold 13", C_TEXT_PRI, ta, valign="middle")
                draw_icon_video(ctx, tx + 16 + w_prefix + 10, ty + 40, size=12.5, color=C_EMERALD_LT, alpha=ta)
                draw_text(ctx, "Google Meet Attached", tx + 16 + w_prefix + 24, ty + 40, "Inter SemiBold 13", C_TEXT_PRI, ta, valign="middle")
            else:
                draw_text(ctx, v_lbl, tx + 16, ty + 40, "Inter SemiBold 13", C_TEXT_PRI, ta, valign="middle")

        draw_text(
            ctx,
            "Press ↵ Enter to create optimistically in SQLite WAL  •  Instant FTS5 index updated",
            mx + 46,
            my + mh - 42,
            "Inter Medium 13",
            C_TEXT_SEC,
            ma,
            valign="middle",
        )

        kc_y = 740
        cmd_press = math.sin(clamp((t - 10.55) / 0.35) * math.pi) if 10.55 <= t <= 10.90 else 0.0
        ret_press = math.sin(clamp((t - 14.55) / 0.38) * math.pi) if 14.55 <= t <= 14.93 else 0.0

        draw_keycap(ctx, "⌘ Cmd", WIDTH / 2 - 220, kc_y, w=116, h=54, pressed=cmd_press, accent=C_INDIGO, alpha=ma)
        draw_text(ctx, "+", WIDTH / 2 - 84, kc_y + 27, "Inter Bold 22", C_TEXT_SEC, ma, align="center", valign="middle")
        draw_keycap(ctx, "K", WIDTH / 2 - 60, kc_y, w=68, h=54, pressed=cmd_press, accent=C_INDIGO, alpha=ma)
        draw_keycap(ctx, "↵ Enter", WIDTH / 2 + 64, kc_y, w=146, h=54, pressed=ret_press, accent=C_EMERALD, alpha=ma)

        ctx.pop_group_to_source()
        ctx.paint_with_alpha(modal_alpha)

    # Bottom confirmation toast once event drops into Friday
    if t >= 15.10:
        toast_p = spring_ease(norm_window(t, 15.10, 15.65))
        toast_a = ws_alpha * clamp((t - 15.10) / 0.22)
        tw_b, th_b = 840, 52
        tx_b, ty_b = WIDTH / 2 - tw_b / 2, HEIGHT - 96 + (1.0 - toast_p) * 28
        draw_glass_card(
            ctx, tx_b, ty_b, tw_b, th_b, 26,
            bg_color=(16 / 255, 24 / 255, 42 / 255),
            bg_alpha=0.96 * toast_a,
            border_color=C_INDIGO_LT,
            border_alpha=0.85 * toast_a,
            glow_color=C_INDIGO,
            glow_alpha=0.3 * toast_a,
        )
        draw_text(
            ctx,
            "✓ Created \"Product Launch Sync\" on Fri 2:00 PM – 3:15 PM  •  0.18ms Rust NLP",
            WIDTH / 2,
            ty_b + th_b / 2,
            "DejaVu Sans Mono Bold 13",
            C_INDIGO_PALE,
            toast_a,
            align="center",
            valign="middle",
        )


# ---------------------------------------------------------------------------
# Scene 4 (16.50s – 21.48s): 1-Click Video Meeting Join (Cmd+J) & Busy Blocking
# ---------------------------------------------------------------------------
def render_scene_4(ctx: cairo.Context, t: float) -> None:
    alpha = scene_fade(t, 16.50, 21.48, fade_in=0.35, fade_out=0.35)
    if alpha <= 0.005:
        return

    enter_p = ease_out_expo(norm_window(t, 16.50, 17.20))
    draw_text(
        ctx,
        "MULTI-ACCOUNT MEETING SUITE  •  ZERO DOUBLE-BOOKINGS",
        WIDTH / 2,
        52,
        "DejaVu Sans Mono Bold 12.5",
        C_SKY_LT,
        alpha * enter_p,
        align="center",
        valign="middle",
        letter_spacing=2,
    )
    draw_text(
        ctx,
        "1-Click Conference Join (Cmd+J) & Cross-Account [Busy] Mirroring",
        WIDTH / 2,
        92,
        "Inter Display Bold 34",
        C_TEXT_PRI,
        alpha * enter_p,
        align="center",
        valign="middle",
    )

    # Left Card: 1-Click Video Meeting Join (Cmd/Ctrl + J)
    lp = spring_ease(norm_window(t, 16.6, 17.45))
    lx, ly, lw, lh = 100, 165 + (1.0 - lp) * 40, 825, 790
    draw_glass_card(
        ctx, lx, ly, lw, lh, 22,
        bg_color=C_BG_CARD, bg_alpha=0.92 * alpha,
        border_color=C_INDIGO, border_alpha=0.65 * alpha,
        glow_color=C_INDIGO, glow_alpha=0.22 * alpha,
    )

    draw_text(ctx, "01  •  1-CLICK VIDEO LAUNCHER", lx + 42, ly + 42, "DejaVu Sans Mono Bold 12", C_INDIGO_LT, alpha)
    draw_text(ctx, "Launch Active Calls From Anywhere", lx + 42, ly + 74, "Inter Bold 27", C_WHITE, alpha)
    draw_text(
        ctx,
        "No more digging through email threads or browser tabs. Press Cmd/Ctrl + J to jump straight into your active or upcoming video meeting.",
        lx + 42,
        ly + 122,
        "Inter Regular 15",
        C_TEXT_SEC,
        alpha,
        max_width=lw - 84,
    )

    # Animated TopBar Countdown Pill Preview
    pulse = 0.5 + 0.5 * math.sin(t * 6.0)
    fill_rounded_rect(ctx, lx + 42, ly + 198, lw - 84, 74, 16, (26 / 255, 24 / 255, 62 / 255), alpha * 0.95)
    stroke_rounded_rect(ctx, lx + 42, ly + 198, lw - 84, 74, 16, C_INDIGO_LT, alpha * (0.65 + 0.3 * pulse), 1.6)
    ctx.arc(lx + 74, ly + 235, 7 + pulse * 2, 0, 2 * math.pi)
    ctx.set_source_rgba(C_ROSE[0], C_ROSE[1], C_ROSE[2], alpha)
    ctx.fill()
    draw_text(ctx, "STARTING IN 45s  •  Architecture Sync", lx + 98, ly + 235, "Inter SemiBold 17", C_WHITE, alpha, valign="middle")
    fill_rounded_rect(ctx, lx + lw - 210, ly + 214, 148, 42, 10, C_INDIGO, alpha)
    draw_icon_video(ctx, lx + lw - 186, ly + 235, size=14.0, color=C_WHITE, alpha=alpha)
    draw_text(ctx, "Join  ⌘+J", lx + lw - 124, ly + 235, "DejaVu Sans Mono Bold 13.5", C_WHITE, alpha, align="center", valign="middle")

    providers = [
        ("Google Meet", "Auto-detected from conferenceData", C_EMERALD),
        ("Microsoft Teams", "Native Graph & .ICS joinUrl extraction", C_INDIGO_LT),
        ("Zoom & Webex", "Regex link scanner in notes & location", C_SKY),
    ]
    for pi, (pname, pdesc, pcol) in enumerate(providers):
        py = ly + 298 + pi * 86
        fill_rounded_rect(ctx, lx + 42, py, lw - 84, 72, 12, C_BG_OBS, alpha * 0.9)
        stroke_rounded_rect(ctx, lx + 42, py, lw - 84, 72, 12, pcol, alpha * 0.55)
        fill_rounded_rect(ctx, lx + 62, py + 20, 12, 32, 4, pcol, alpha)
        draw_text(ctx, pname, lx + 88, py + 26, "Inter Bold 16.5", C_TEXT_PRI, alpha, valign="middle")
        draw_text(ctx, pdesc, lx + 88, py + 49, "Inter Regular 13.5", C_TEXT_SEC, alpha, valign="middle")
        draw_text(ctx, "READY", lx + lw - 72, py + 36, "DejaVu Sans Mono Bold 11", pcol, alpha, align="right", valign="middle")

    rsvp_p = clamp((t - 18.2) / 0.4)
    fill_rounded_rect(ctx, lx + 42, ly + 575, lw - 84, 68, 12, C_BG_OBS, alpha * 0.95)
    stroke_rounded_rect(ctx, lx + 42, ly + 575, lw - 84, 68, 12, C_BORDER, alpha * 0.7)
    draw_text(ctx, "Inline & Inspector Attendee RSVP:", lx + 66, ly + 609, "Inter SemiBold 15", C_TEXT_PRI, alpha, valign="middle")
    fill_rounded_rect(ctx, lx + lw - 310, ly + 591, 92, 36, 8, C_EMERALD if rsvp_p > 0.5 else C_INDIGO, alpha)
    draw_text(ctx, "✓ Yes" if rsvp_p > 0.5 else "Yes", lx + lw - 264, ly + 609, "Inter Bold 13.5", C_WHITE, alpha, align="center", valign="middle")
    fill_rounded_rect(ctx, lx + lw - 208, ly + 591, 74, 36, 8, C_BG_ZINC800, alpha)
    draw_text(ctx, "Maybe", lx + lw - 171, ly + 609, "Inter Medium 13", C_TEXT_SEC, alpha, align="center", valign="middle")
    fill_rounded_rect(ctx, lx + lw - 124, ly + 591, 64, 36, 8, C_BG_ZINC800, alpha)
    draw_text(ctx, "No", lx + lw - 92, ly + 609, "Inter Medium 13", C_TEXT_SEC, alpha, align="center", valign="middle")

    j_press = math.sin(clamp((t - 17.6) / 0.45) * math.pi) if 17.6 <= t <= 18.05 else 0.0
    draw_keycap(ctx, "⌘ Cmd", lx + lw / 2 - 96, ly + 678, w=108, h=52, pressed=j_press, accent=C_INDIGO, alpha=alpha)
    draw_keycap(ctx, "J", lx + lw / 2 + 28, ly + 678, w=64, h=52, pressed=j_press, accent=C_INDIGO, alpha=alpha)

    # Right Card: Cross-Account Busy Blocking
    rp = spring_ease(norm_window(t, 16.85, 17.7))
    rx, ry, rw, rh = 995, 165 + (1.0 - rp) * 40, 825, 790
    draw_glass_card(
        ctx, rx, ry, rw, rh, 22,
        bg_color=C_BG_CARD, bg_alpha=0.92 * alpha,
        border_color=C_EMERALD, border_alpha=0.65 * alpha,
        glow_color=C_EMERALD, glow_alpha=0.20 * alpha,
    )

    draw_text(ctx, "02  •  CROSS-ACCOUNT PRIVACY SHIELD", rx + 42, ry + 42, "DejaVu Sans Mono Bold 12", C_EMERALD_LT, alpha)
    draw_text(ctx, "Automatic [Busy] Time Mirroring", rx + 42, ry + 74, "Inter Bold 27", C_WHITE, alpha)
    draw_text(
        ctx,
        "Mirror personal Google Calendar appointments onto your Microsoft 365 work calendar as redacted [Busy] blocks with automatic time-change propagation.",
        rx + 42,
        ry + 122,
        "Inter Regular 15",
        C_TEXT_SEC,
        alpha,
        max_width=rw - 84,
    )

    src_y = ry + 212
    fill_rounded_rect(ctx, rx + 52, src_y, rw - 104, 140, 14, (14 / 255, 42 / 255, 34 / 255), alpha * 0.9)
    stroke_rounded_rect(ctx, rx + 52, src_y, rw - 104, 140, 14, C_EMERALD, alpha * 0.8, 1.6)
    draw_text(ctx, "PERSONAL GOOGLE CALENDAR  •  alex.personal@gmail.com", rx + 78, src_y + 28, "DejaVu Sans Mono Bold 11", C_EMERALD_LT, alpha)
    draw_text(ctx, "Dr. Nguyen — Dental Checkup & Lab", rx + 78, src_y + 64, "Inter Bold 21", C_WHITE, alpha)
    draw_text(ctx, "Wed, Oct 7  •  4:00 PM – 5:00 PM  •  450 Sutter St", rx + 78, src_y + 98, "DejaVu Sans Mono Regular 12.5", C_TEXT_SEC, alpha)
    fill_rounded_rect(ctx, rx + rw - 235, src_y + 22, 155, 26, 6, C_EMERALD, alpha * 0.25)
    draw_text(ctx, "PRIVATE DETAILS", rx + rw - 157, src_y + 35, "DejaVu Sans Mono Bold 10", C_EMERALD_LT, alpha, align="center", valign="middle")

    arc_p = ease_in_out_cubic(norm_window(t, 17.2, 18.4))
    mid_x = rx + rw / 2
    y1_c = src_y + 148
    y2_c = src_y + 268
    ctx.move_to(mid_x, y1_c)
    ctx.line_to(mid_x, lerp(y1_c, y2_c, arc_p))
    ctx.set_source_rgba(C_SKY[0], C_SKY[1], C_SKY[2], alpha * 0.85)
    ctx.set_line_width(3.0)
    ctx.stroke()

    pulse_pos = ((t * 1.4) % 1.0) * arc_p
    py_dot = lerp(y1_c, y2_c, pulse_pos)
    ctx.arc(mid_x, py_dot, 6.5, 0, 2 * math.pi)
    ctx.set_source_rgba(C_SKY_LT[0], C_SKY_LT[1], C_SKY_LT[2], alpha)
    ctx.fill()

    # Generous 490px width for the redaction conduit pill with vector bolt icon
    cy_mid = (y1_c + y2_c) / 2
    fill_rounded_rect(ctx, mid_x - 245, cy_mid - 19, 490, 38, 19, C_BG_OBS, alpha * 0.96)
    stroke_rounded_rect(ctx, mid_x - 245, cy_mid - 19, 490, 38, 19, C_SKY, alpha * 0.8)
    draw_icon_bolt(ctx, mid_x - 216, cy_mid, size=13.0, color=C_AMBER, alpha=alpha)
    draw_text(
        ctx,
        "Redacting Title & Location  →  Syncing [Busy]",
        mid_x + 10,
        cy_mid,
        "DejaVu Sans Mono Bold 11.5",
        C_SKY_LT,
        alpha,
        align="center",
        valign="middle",
    )

    dst_y = src_y + 276
    dst_a = alpha * clamp((t - 17.35) / 0.45)
    fill_rounded_rect(ctx, rx + 52, dst_y, rw - 104, 150, 14, (14 / 255, 29 / 255, 48 / 255), dst_a * 0.92)
    ctx.save()
    rounded_rect(ctx, rx + 52, dst_y, rw - 104, 150, 14)
    ctx.clip()
    ctx.set_source_rgba(1.0, 1.0, 1.0, 0.05 * dst_a)
    ctx.set_line_width(6.0)
    for sx in range(int(rx - 150), int(rx + rw + 150), 22):
        ctx.move_to(sx, dst_y + 150)
        ctx.line_to(sx + 150, dst_y)
    ctx.stroke()
    ctx.restore()
    stroke_rounded_rect(ctx, rx + 52, dst_y, rw - 104, 150, 14, C_SKY, dst_a * 0.85, 1.8)

    draw_text(ctx, "WORK MICROSOFT 365  •  alex.morgan@contoso.com", rx + 78, dst_y + 28, "DejaVu Sans Mono Bold 11", C_SKY_LT, dst_a)
    draw_text(ctx, "[Busy] Blocked Time", rx + 78, dst_y + 66, "Inter Bold 22", C_WHITE, dst_a)
    draw_text(ctx, "Wed, Oct 7  •  4:00 PM – 5:00 PM  •  Zero Private Metadata", rx + 78, dst_y + 104, "DejaVu Sans Mono Regular 12.5", C_TEXT_SEC, dst_a)
    fill_rounded_rect(ctx, rx + rw - 235, dst_y + 22, 155, 26, 6, C_SKY, dst_a * 0.28)
    draw_text(ctx, "AUTO-PROPAGATED", rx + rw - 157, dst_y + 35, "DejaVu Sans Mono Bold 10", C_SKY_LT, dst_a, align="center", valign="middle")


# ---------------------------------------------------------------------------
# Scene 5 (21.50s – 25.48s): Real Product Views Showcase (Week, Month, Schedule, Light)
# ---------------------------------------------------------------------------
def render_scene_5(
    ctx: cairo.Context,
    t: float,
    screenshots: Dict[str, Optional[cairo.ImageSurface]],
) -> None:
    alpha = scene_fade(t, 21.50, 25.48, fade_in=0.35, fade_out=0.35)
    if alpha <= 0.005:
        return

    draw_text(
        ctx,
        "ADAPTIVE VIEWS & THEMES  •  SINGLE-KEY NAVIGATION",
        WIDTH / 2,
        48,
        "DejaVu Sans Mono Bold 12.5",
        C_INDIGO_LT,
        alpha,
        align="center",
        valign="middle",
        letter_spacing=2,
    )
    draw_text(
        ctx,
        "Day (D)  •  3-Day (3)  •  Work Week (5)  •  Week (W)  •  Month (M)  •  Schedule (A)",
        WIDTH / 2,
        86,
        "Inter Display Bold 30",
        C_TEXT_PRI,
        alpha,
        align="center",
        valign="middle",
    )

    cards = [
        ("week", "Week Time-Grid View (W)", "Dual-Timezone & Overlap Packing", C_INDIGO, 21.52),
        ("month", "Month Matrix View (M)", "High-Density Multi-Week Overview", C_SKY, 21.78),
        ("agenda", "Schedule Dossier View (A)", "Chronological Agenda & Quick RSVP", C_EMERALD, 22.04),
        ("light", "Adaptive Daylight Theme", "Crisp High-Contrast Light & Dark Modes", C_AMBER, 22.30),
    ]

    cw, ch = 820, 415
    positions = [
        (110, 130),
        (990, 130),
        (110, 585),
        (990, 585),
    ]

    for idx, (key, title, sub, col, t_start) in enumerate(cards):
        cp = spring_ease(norm_window(t, t_start, t_start + 0.65))
        if cp <= 0.01:
            continue
        ca = alpha * clamp((t - t_start) / 0.3)
        bx, by = positions[idx]
        by_anim = by + (1.0 - cp) * 35

        draw_glass_card(
            ctx, bx, by_anim, cw, ch, 16,
            bg_color=C_BG_CARD, bg_alpha=0.95 * ca,
            border_color=col, border_alpha=0.7 * ca,
            glow_color=col, glow_alpha=0.18 * ca,
        )

        draw_text(ctx, title, bx + 22, by_anim + 24, "Inter Bold 15.5", C_WHITE, ca, valign="middle")
        draw_text(ctx, sub, bx + cw - 22, by_anim + 24, "DejaVu Sans Mono Medium 11.5", col, ca, align="right", valign="middle")

        surf = screenshots.get(key)
        if surf is not None:
            img_x = bx + 14
            img_y = by_anim + 46
            img_w = cw - 28
            img_h = ch - 58
            sw = surf.get_width()
            sh = surf.get_height()
            scale = min(img_w / sw, img_h / sh)
            draw_w = sw * scale
            draw_h = sh * scale
            ox = img_x + (img_w - draw_w) / 2
            oy = img_y + (img_h - draw_h) / 2

            ctx.save()
            rounded_rect(ctx, ox, oy, draw_w, draw_h, 10)
            ctx.clip()
            ctx.translate(ox, oy)
            ctx.scale(scale, scale)
            ctx.set_source_surface(surf, 0, 0)
            ctx.paint_with_alpha(ca)
            ctx.restore()
            stroke_rounded_rect(ctx, ox, oy, draw_w, draw_h, 10, C_BORDER, ca * 0.7, 1.0)


# ---------------------------------------------------------------------------
# Scene 6 (25.50s – 28.78s): Zero-Cloud Privacy & Direct Loopback OAuth2 + PKCE
# ---------------------------------------------------------------------------
def render_scene_6(ctx: cairo.Context, t: float) -> None:
    alpha = scene_fade(t, 25.50, 28.78, fade_in=0.35, fade_out=0.35)
    if alpha <= 0.005:
        return

    draw_text(
        ctx,
        "ZERO-CLOUD ARCHITECTURE  •  GOOGLE API SERVICES LIMITED USE COMPLIANT",
        WIDTH / 2,
        54,
        "DejaVu Sans Mono Bold 12.5",
        C_EMERALD_LT,
        alpha,
        align="center",
        valign="middle",
        letter_spacing=2,
    )
    draw_text(
        ctx,
        "Your Calendar Data Never Touches a Third-Party Server",
        WIDTH / 2,
        96,
        "Inter Display Bold 36",
        C_TEXT_PRI,
        alpha,
        align="center",
        valign="middle",
    )

    # Top Blocked Cloud Relay Banner (generous 1080px width)
    bw, bh = 1080, 76
    bx, by = WIDTH / 2 - bw / 2, 152
    draw_glass_card(
        ctx, bx, by, bw, bh, 16,
        bg_color=(36 / 255, 14 / 255, 18 / 255),
        bg_alpha=0.88 * alpha,
        border_color=C_ROSE,
        border_alpha=0.75 * alpha,
    )
    draw_text(
        ctx,
        "✕   ZERO CODESTACX CLOUD RELAY SERVERS   •   ZERO AI/ML DATA TRAINING   •   ZERO AD TRACKING",
        WIDTH / 2,
        by + bh / 2,
        "DejaVu Sans Mono Bold 13",
        (1.0, 0.58, 0.65),
        alpha,
        align="center",
        valign="middle",
    )

    # Left Vault Node: Your Computer (RapidCal Desktop Client)
    lx, ly, lw, lh = 86, 276, 670, 650
    draw_glass_card(
        ctx, lx, ly, lw, lh, 22,
        bg_color=C_BG_CARD, bg_alpha=0.95 * alpha,
        border_color=C_EMERALD, border_alpha=0.8 * alpha,
        glow_color=C_EMERALD, glow_alpha=0.25 * alpha,
    )
    draw_text(ctx, "YOUR LOCAL DEVICE (MACOS / WINDOWS / LINUX)", lx + 36, ly + 40, "DejaVu Sans Mono Bold 11.5", C_EMERALD_LT, alpha)
    draw_text(ctx, "RapidCal Rust Core Vault", lx + 36, ly + 76, "Inter Bold 28", C_WHITE, alpha)

    vault_items = [
        ("Loopback OAuth2 + PKCE (S256)", "Direct 127.0.0.1 listener — tokens never leave your device", C_INDIGO_LT),
        ("OS Keychain + AES-256-GCM", "Sealed in macOS Keychain, Windows Vault, or Secret Service", C_EMERALD_LT),
        ("SQLite WAL + FTS5 Local Engine", "256MB mmap, <1ms offline edits, exponential-backoff outbox", C_SKY_LT),
        ("Local Rust RRULE Expander", "RFC 5545 recurrence & Windows-to-IANA timezone translation", C_AMBER),
    ]
    for vi, (vtitle, vdesc, vcol) in enumerate(vault_items):
        vy = ly + 126 + vi * 122
        fill_rounded_rect(ctx, lx + 32, vy, lw - 64, 102, 12, C_BG_OBS, alpha * 0.92)
        stroke_rounded_rect(ctx, lx + 32, vy, lw - 64, 102, 12, vcol, alpha * 0.65)
        draw_text(ctx, vtitle, lx + 54, vy + 30, "Inter Bold 17", C_WHITE, alpha, valign="middle")
        draw_text(ctx, vdesc, lx + 54, vy + 66, "Inter Regular 13.5", C_TEXT_SEC, alpha, valign="middle")

    # Central TLS 1.3 Hub Badge (cleanly connecting Left Vault -> Hub -> Right Providers)
    cx_lock = 960
    cy_lock = 601
    hub_w, hub_h = 264, 50
    hub_l = cx_lock - hub_w / 2
    hub_r = cx_lock + hub_w / 2

    # Trunk conduit from Left Vault (x=756) to Hub left edge (x=828)
    trunk_x0 = lx + lw + 6
    trunk_x1 = hub_l - 4
    ctx.move_to(trunk_x0, cy_lock)
    ctx.line_to(trunk_x1, cy_lock)
    ctx.set_source_rgba(C_EMERALD[0], C_EMERALD[1], C_EMERALD[2], alpha * 0.7)
    ctx.set_line_width(3.0)
    ctx.stroke()
    u_trunk = (t * 1.4) % 1.0
    ctx.arc(lerp(trunk_x0, trunk_x1, u_trunk), cy_lock, 5.5, 0, 2 * math.pi)
    ctx.set_source_rgba(C_EMERALD_LT[0], C_EMERALD_LT[1], C_EMERALD_LT[2], alpha)
    ctx.fill()

    # Right Provider Endpoints & unobstructed fan-out Bezier curves from Hub right edge
    rx, rw = 1164, 670
    endpoints = [
        ("Google Calendar API v3", "Incremental nextSyncToken Delta Sync  •  OAuth2 PKCE", C_INDIGO, 276),
        ("Microsoft Graph API", "Incremental @odata.deltaLink Sync  •  Outlook & 365", C_SKY, 504),
        ("Read-Only .ICS / WebCal Feeds", "Enterprise Outlook Bypass  •  No Admin Consent Needed", C_EMERALD, 732),
    ]

    for ename, edesc, ecol, ey in endpoints:
        eh = 194
        draw_glass_card(
            ctx, rx, ey, rw, eh, 18,
            bg_color=C_BG_CARD, bg_alpha=0.94 * alpha,
            border_color=ecol, border_alpha=0.75 * alpha,
            glow_color=ecol, glow_alpha=0.20 * alpha,
        )
        draw_text(ctx, "DIRECT HTTPS TLS 1.3 ENDPOINT", rx + 36, ey + 40, "DejaVu Sans Mono Bold 10.5", ecol, alpha)
        draw_text(ctx, ename, rx + 36, ey + 82, "Inter Bold 24", C_WHITE, alpha)
        draw_text(ctx, edesc, rx + 36, ey + 132, "DejaVu Sans Mono Medium 12.5", C_TEXT_SEC, alpha)

        x_start = hub_r + 4
        x_end = rx - 8
        y_start = cy_lock
        y_end = ey + eh / 2

        ctx.move_to(x_start, y_start)
        ctx.curve_to(
            (x_start + x_end) / 2, y_start,
            (x_start + x_end) / 2, y_end,
            x_end, y_end,
        )
        ctx.set_source_rgba(ecol[0], ecol[1], ecol[2], alpha * 0.65)
        ctx.set_line_width(2.6)
        ctx.stroke()

        u = (t * 1.15 + ey * 0.003) % 1.0
        bx_pt = (1 - u) ** 3 * x_start + 3 * (1 - u) ** 2 * u * ((x_start + x_end) / 2) + 3 * (1 - u) * u ** 2 * ((x_start + x_end) / 2) + u ** 3 * x_end
        by_pt = (1 - u) ** 3 * y_start + 3 * (1 - u) ** 2 * u * y_start + 3 * (1 - u) * u ** 2 * y_end + u ** 3 * y_end
        ctx.arc(bx_pt, by_pt, 6.0, 0, 2 * math.pi)
        ctx.set_source_rgba(ecol[0], ecol[1], ecol[2], alpha)
        ctx.fill()

    fill_rounded_rect(ctx, hub_l, cy_lock - hub_h / 2, hub_w, hub_h, hub_h / 2, C_BG_OBS, alpha * 0.98)
    stroke_rounded_rect(ctx, hub_l, cy_lock - hub_h / 2, hub_w, hub_h, hub_h / 2, C_EMERALD, alpha * 0.9, 1.6)
    draw_icon_lock(ctx, hub_l + 24, cy_lock, size=14.0, color=C_EMERALD_LT, alpha=alpha)
    draw_text(
        ctx,
        "Direct Device ↔ API",
        cx_lock + 10,
        cy_lock,
        "DejaVu Sans Mono Bold 12",
        C_EMERALD_LT,
        alpha,
        align="center",
        valign="middle",
    )


# ---------------------------------------------------------------------------
# Scene 7 (28.80s – 32.0s): Finale & Call To Action
# ---------------------------------------------------------------------------
def render_scene_7(ctx: cairo.Context, t: float) -> None:
    alpha = scene_fade(t, 28.80, DURATION_SEC, fade_in=0.35, fade_out=0.35)
    if alpha <= 0.005:
        return

    enter_p = spring_ease(norm_window(t, 28.80, 29.60))
    pulse = 0.5 + 0.5 * math.sin(t * 4.5)

    draw_rapidcal_logo(
        ctx,
        WIDTH / 2,
        245,
        size=148 * clamp(enter_p, 0.2, 1.1),
        alpha=alpha,
        needle_progress=1.0,
        pulse=pulse,
    )

    draw_gradient_text(
        ctx,
        "Own Your Schedule at <1ms.",
        WIDTH / 2,
        415 + (1.0 - enter_p) * 24,
        "Inter Display ExtraBold 68",
        C_WHITE,
        C_INDIGO_PALE,
        C_SKY_LT,
        alpha=alpha,
    )

    draw_text(
        ctx,
        "Lightweight Rust (Tauri v2) + SolidJS Desktop Calendar  •  100% Local-First Privacy",
        WIDTH / 2,
        495 + (1.0 - enter_p) * 16,
        "Inter Medium 22",
        C_TEXT_SEC,
        alpha,
        align="center",
        valign="middle",
    )

    platforms = [
        ("macOS Universal", ".dmg (Apple Silicon & Intel)", C_INDIGO),
        ("Windows 10 / 11", ".msi & NSIS -setup.exe", C_SKY),
        ("Linux x86_64", ".AppImage, .deb & .rpm", C_EMERALD),
    ]
    pw, ph, pgap = 390, 96, 28
    px0 = WIDTH / 2 - (3 * pw + 2 * pgap) / 2
    for idx, (pname, pext, pcol) in enumerate(platforms):
        pp = spring_ease(norm_window(t, 29.00 + idx * 0.12, 29.65 + idx * 0.12))
        pa = alpha * clamp((t - (29.00 + idx * 0.12)) / 0.25)
        if pa <= 0.005:
            continue
        px = px0 + idx * (pw + pgap)
        py = 565 + (1.0 - pp) * 32
        draw_glass_card(
            ctx, px, py, pw, ph, 16,
            bg_color=C_BG_CARD, bg_alpha=0.92 * pa,
            border_color=pcol, border_alpha=0.7 * pa,
            glow_color=pcol, glow_alpha=0.16 * pa,
        )
        draw_text(ctx, pname, px + pw / 2, py + 34, "Inter Bold 19", C_WHITE, pa, align="center", valign="middle")
        draw_text(ctx, pext, px + pw / 2, py + 66, "DejaVu Sans Mono Medium 12.5", pcol, pa, align="center", valign="middle")

    cta_p = spring_ease(norm_window(t, 29.30, 29.95))
    cta_a = alpha * clamp((t - 29.30) / 0.28)
    if cta_a > 0.005:
        cta_w, cta_h = 880, 92
        cta_x, cta_y = WIDTH / 2 - cta_w / 2, 715 + (1.0 - cta_p) * 32
        draw_glass_card(
            ctx, cta_x, cta_y, cta_w, cta_h, 46,
            bg_color=(24 / 255, 24 / 255, 58 / 255),
            bg_alpha=0.96 * cta_a,
            border_color=C_INDIGO_LT,
            border_alpha=0.95 * cta_a,
            glow_color=C_INDIGO,
            glow_alpha=0.35 * cta_a,
        )
        draw_text(
            ctx,
            "rapidcal.codestacx.com",
            WIDTH / 2,
            cta_y + 34,
            "Inter Display Bold 28",
            C_WHITE,
            cta_a,
            align="center",
            valign="middle",
        )
        draw_text(
            ctx,
            "github.com/Smit2553/RapidCal   •   Open Source by CodeStacx",
            WIDTH / 2,
            cta_y + 68,
            "DejaVu Sans Mono Medium 14",
            C_INDIGO_PALE,
            cta_a,
            align="center",
            valign="middle",
        )


# ---------------------------------------------------------------------------
# Master Frame Compositor
# ---------------------------------------------------------------------------
def render_frame(
    ctx: cairo.Context,
    t: float,
    base_bg: cairo.ImageSurface,
    screenshots: Dict[str, Optional[cairo.ImageSurface]],
) -> None:
    ctx.set_source_surface(base_bg, 0, 0)
    ctx.paint()

    if t < 4.50:
        render_scene_1(ctx, t)
    elif t < 16.50:
        render_scenes_2_and_3(ctx, t)
    elif t < 21.50:
        render_scene_4(ctx, t)
    elif t < 25.50:
        render_scene_5(ctx, t, screenshots)
    elif t < 28.80:
        render_scene_6(ctx, t)
    else:
        render_scene_7(ctx, t)

    draw_top_cinema_hud(ctx, t)



# ---------------------------------------------------------------------------
# Ambient Soundtrack & UI Sound Effects Synthesizer (44.1kHz Stereo WAV)
# ---------------------------------------------------------------------------
def generate_soundtrack_wav(wav_path: Path) -> None:
    sr = 44100
    n_samples = int(DURATION_SEC * sr)
    t = np.linspace(0.0, DURATION_SEC, n_samples, endpoint=False, dtype=np.float64)

    left = np.zeros(n_samples, dtype=np.float64)
    right = np.zeros(n_samples, dtype=np.float64)

    chords = [
        (0.0, 8.0, [110.0, 220.0, 261.63, 329.63, 392.00, 493.88]),
        (8.0, 16.0, [87.31, 174.61, 220.00, 261.63, 329.63, 392.00]),
        (16.0, 24.0, [130.81, 261.63, 329.63, 392.00, 493.88, 587.33]),
        (24.0, 32.0, [98.00, 196.00, 246.94, 293.66, 392.00, 440.00]),
    ]

    for c_start, c_end, freqs in chords:
        mask = (t >= max(0.0, c_start - 0.8)) & (t < min(DURATION_SEC, c_end + 0.8))
        ts = t[mask]
        env = np.ones_like(ts)
        fade_in_mask = ts < c_start + 0.8
        env[fade_in_mask] = np.clip((ts[fade_in_mask] - (c_start - 0.8)) / 1.6, 0.0, 1.0)
        fade_out_mask = ts > c_end - 0.8
        env[fade_out_mask] = np.clip(((c_end + 0.8) - ts[fade_out_mask]) / 1.6, 0.0, 1.0)

        pad_l = np.zeros_like(ts)
        pad_r = np.zeros_like(ts)
        for fi, f in enumerate(freqs):
            detune = 1.0 + (fi - 2.5) * 0.0012
            lfo = 0.85 + 0.15 * np.sin(2 * np.pi * (0.22 + fi * 0.05) * ts)
            amp = 0.032 / (1.0 + fi * 0.22)
            pad_l += amp * lfo * np.sin(2 * np.pi * f * ts)
            pad_r += amp * lfo * np.sin(2 * np.pi * (f * detune) * ts + 0.35)

        left[mask] += pad_l * env
        right[mask] += pad_r * env

    pulse_env = 0.5 - 0.5 * np.cos(2 * np.pi * 2.0 * t)
    left += 0.018 * (pulse_env ** 4) * np.sin(2 * np.pi * 110.0 * t)
    right += 0.018 * (pulse_env ** 4) * np.sin(2 * np.pi * 110.0 * t)

    def add_chime(t0: float, freqs_list: List[float], dur: float = 1.4, gain: float = 0.065) -> None:
        idx0 = int(t0 * sr)
        idx1 = min(n_samples, idx0 + int(dur * sr))
        if idx0 >= n_samples or idx1 <= idx0:
            return
        dt = np.arange(idx1 - idx0, dtype=np.float64) / sr
        env = np.exp(-3.8 * dt) * (1.0 - np.exp(-80.0 * dt))
        sig_l = np.zeros_like(dt)
        sig_r = np.zeros_like(dt)
        for i, f in enumerate(freqs_list):
            sig_l += (gain / len(freqs_list)) * np.sin(2 * np.pi * f * dt)
            sig_r += (gain / len(freqs_list)) * np.sin(2 * np.pi * (f * 1.0015) * dt + 0.4 * i)
        left[idx0:idx1] += sig_l * env
        right[idx0:idx1] += sig_r * env

    add_chime(1.10, [523.25, 659.25, 783.99, 1046.50], dur=1.8, gain=0.09)
    add_chime(4.50, [440.00, 554.37, 659.25], dur=1.2, gain=0.06)
    add_chime(6.45, [587.33, 880.00], dur=0.8, gain=0.055)
    add_chime(10.65, [493.88, 740.00], dur=0.7, gain=0.055)
    add_chime(14.95, [523.25, 659.25, 1046.50], dur=1.4, gain=0.085)
    add_chime(17.65, [440.00, 659.25, 880.00], dur=1.2, gain=0.065)
    add_chime(21.55, [392.00, 587.33, 783.99], dur=1.1, gain=0.055)
    add_chime(25.55, [440.00, 523.25, 659.25], dur=1.2, gain=0.06)
    add_chime(28.80, [523.25, 659.25, 783.99, 987.77, 1046.50], dur=2.8, gain=0.095)

    rng = np.random.default_rng(42)
    for click_t in np.linspace(11.18, 14.35, 26):
        idx0 = int(click_t * sr)
        click_len = int(0.018 * sr)
        idx1 = min(n_samples, idx0 + click_len)
        if idx1 > idx0:
            dt = np.arange(idx1 - idx0, dtype=np.float64) / sr
            c_env = np.exp(-220.0 * dt)
            pitch = 1400.0 + rng.uniform(-180.0, 180.0)
            click_wave = 0.032 * c_env * np.sin(2 * np.pi * pitch * dt)
            left[idx0:idx1] += click_wave
            right[idx0:idx1] += click_wave * 0.9

    master_env = np.ones(n_samples, dtype=np.float64)
    fi_n = int(0.6 * sr)
    fo_n = int(1.5 * sr)
    master_env[:fi_n] = np.linspace(0.0, 1.0, fi_n)
    master_env[-fo_n:] = np.linspace(1.0, 0.0, fo_n)

    left = np.clip(left * master_env, -0.95, 0.95)
    right = np.clip(right * master_env, -0.95, 0.95)

    pcm = np.empty(n_samples * 2, dtype=np.int16)
    pcm[0::2] = (left * 32767).astype(np.int16)
    pcm[1::2] = (right * 32767).astype(np.int16)

    with wave.open(str(wav_path), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())


# ---------------------------------------------------------------------------
# Main Video Generation Pipeline
# ---------------------------------------------------------------------------
def main() -> None:
    t0 = time.time()
    DOCS_DIR.mkdir(parents=True, exist_ok=True)

    base_bg = create_base_background_surface()
    screenshots = {
        "week": load_png_as_surface(SCREENSHOTS_DIR / "tier1_05_week_view.png"),
        "month": load_png_as_surface(SCREENSHOTS_DIR / "tier1_06_month_view.png"),
        "agenda": load_png_as_surface(SCREENSHOTS_DIR / "tier1_07_agenda_view.png"),
        "light": load_png_as_surface(SCREENSHOTS_DIR / "tier3_05_theme_light.png"),
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        wav_path = Path(tmpdir) / "soundtrack.wav"
        print("[1/3] Synthesizing stereo ambient soundtrack & UI audio cues...")
        generate_soundtrack_wav(wav_path)

        print(f"[2/3] Rendering {TOTAL_FRAMES} frames ({WIDTH}x{HEIGHT} @ {FPS}fps) via PyCairo -> FFmpeg...")
        ffmpeg_cmd = [
            "ffmpeg",
            "-y",
            "-f", "rawvideo",
            "-vcodec", "rawvideo",
            "-pix_fmt", "bgra",
            "-s", f"{WIDTH}x{HEIGHT}",
            "-r", str(FPS),
            "-i", "-",
            "-i", str(wav_path),
            "-c:v", "libx264",
            "-preset", "slow",
            "-tune", "animation",
            "-crf", "24",
            "-pix_fmt", "yuv420p",
            "-profile:v", "high",
            "-level", "4.2",
            "-c:a", "aac",
            "-b:a", "128k",
            "-shortest",
            "-movflags", "+faststart",
            str(OUTPUT_MP4),
        ]

        surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, WIDTH, HEIGHT)
        ctx = cairo.Context(surface)

        proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        assert proc.stdin is not None

        poster_frame_idx = int(3.2 * FPS)

        for frame_idx in range(TOTAL_FRAMES):
            t = frame_idx / FPS
            render_frame(ctx, t, base_bg, screenshots)
            surface.flush()
            proc.stdin.write(surface.get_data())

            if frame_idx == poster_frame_idx:
                raw_poster_path = Path(tmpdir) / "poster_raw.png"
                surface.write_to_png(str(raw_poster_path))
                poster_img = Image.open(raw_poster_path).convert("RGB")
                poster_img.save(str(OUTPUT_POSTER_WEBP), format="WEBP", quality=85, method=6)
                poster_img.quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(
                    str(OUTPUT_POSTER), format="PNG", optimize=True
                )

            if (frame_idx + 1) % 300 == 0 or frame_idx == TOTAL_FRAMES - 1:
                elapsed = time.time() - t0
                print(f"  • Rendered frame {frame_idx + 1}/{TOTAL_FRAMES} ({t:.1f}s / {DURATION_SEC:.1f}s) in {elapsed:.1f}s")

        proc.stdin.close()
        stderr_out = proc.stderr.read().decode("utf-8", errors="replace") if proc.stderr else ""
        ret = proc.wait()
        if ret != 0:
            raise RuntimeError(f"FFmpeg exited with code {ret}:\n{stderr_out}")

    size_mb = OUTPUT_MP4.stat().st_size / (1024 * 1024)
    webp_kb = OUTPUT_POSTER_WEBP.stat().st_size / 1024
    png_kb = OUTPUT_POSTER.stat().st_size / 1024
    print(
        f"[3/3] Done! Saved {OUTPUT_MP4} ({size_mb:.2f} MB), "
        f"{OUTPUT_POSTER_WEBP} ({webp_kb:.1f} KB), and {OUTPUT_POSTER} ({png_kb:.1f} KB) in {time.time() - t0:.1f}s."
    )


if __name__ == "__main__":
    main()
