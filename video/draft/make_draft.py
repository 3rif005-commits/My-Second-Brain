"""Draft storyboard video for the hackathon demo (docs/hackathon/DEMO_SCENARIO.md).

Mock screens, step by step, with the narration as subtitles: for checking the
story and the timing before the real screen recording. Pillow + ffmpeg only.

    python3 video/draft/make_draft.py      → video/out/draft_scenario.mp4
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1280, 720
OUT = Path(__file__).resolve().parents[1] / "out"
TMP = OUT / "draft_frames"

FONT = "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"
BOLD = "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"
MONO = "/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf"


def f(size, bold=False, mono=False):
    return ImageFont.truetype(MONO if mono else BOLD if bold else FONT, size)


# Notion-like light palette
BG = "#EDECE9"
WIN = "#FFFFFF"
SIDE = "#F7F7F5"
INK = "#37352F"
GRAY = "#787774"
LINE = "#E3E2E0"
ACCENT = "#2383E2"
AMBER_BG = "#FBF3DB"
AMBER = "#9F6B00"
GREEN = "#0F7B6C"
NV = "#76B900"          # NVIDIA green, for Nemotron labels
CHIP = "#F1F1EF"

APP = (24, 70, 864, 590)  # the mock app window
SIDEBAR = ["ML 301", "  Lecture 5: Gradient descent", "  Lecture 6: Backprop",
           "  Lecture 7: CNNs", "  Lecture 8: Attention", "Midterm plan (Fri 6 Nov)",
           "Capstone: crop-disease CNN", "Reading list", "Advisor meeting 21 Oct",
           "Weekly review 26 Oct", "Health: knee physio  [lock]", "Budget  [lock]",
           "NumPy cheat sheet"]


# ── drawing helpers ─────────────────────────────────────────────────────────

def rr(d, box, fill, outline=None, r=10, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def text(d, xy, s, size=15, color=INK, bold=False, mono=False):
    d.text(xy, s, font=f(size, bold, mono), fill=color)
    return d.textlength(s, font=f(size, bold, mono))


def wrap(d, s, width, size=15, bold=False):
    words, lines, cur = s.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f(size, bold)) > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = t
    if cur:
        lines.append(cur)
    return lines


def para(d, xy, s, width, size=15, color=INK, gap=6, bold=False):
    x, y = xy
    for ln in wrap(d, s, width, size, bold):
        text(d, (x, y), ln, size, color, bold)
        y += size + gap
    return y


def chip(d, xy, s, fill=CHIP, color=GRAY, size=12, icon=None, icon_color=None):
    x, y = xy
    tw = d.textlength(s, font=f(size))
    pad = 8 + (14 if icon else 0)
    rr(d, (x, y, x + tw + pad + 8, y + size + 12), fill, r=6)
    if icon:
        d.ellipse((x + 7, y + 7, x + 7 + size - 2, y + 7 + size - 2), fill=icon_color or GRAY)
    text(d, (x + pad, y + 5), s, size, color)
    return x + tw + pad + 14


def shadow_card(img, box, r=12):
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((box[0] + 2, box[1] + 6, box[2] + 2, box[3] + 8),
                                         radius=r, fill=(0, 0, 0, 70))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(10)))
    d = ImageDraw.Draw(img)
    rr(d, box, WIN, LINE, r)
    return d


def window(img, title, sidebar=True, active=None):
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = APP
    rr(d, (x0 + 3, y0 + 5, x1 + 3, y1 + 6), "#D6D5D1", r=12)
    rr(d, APP, WIN, LINE, 12)
    # title bar
    d.rounded_rectangle((x0, y0, x1, y0 + 34), radius=12, fill="#F4F4F2")
    d.rectangle((x0, y0 + 20, x1, y0 + 34), fill="#F4F4F2")
    for i, c in enumerate(["#FF5F57", "#FEBC2E", "#28C840"]):
        d.ellipse((x0 + 14 + i * 18, y0 + 12, x0 + 24 + i * 18, y0 + 22), fill=c)
    text(d, (x0 + 80, y0 + 8), title, 13, GRAY)
    d.line((x0, y0 + 34, x1, y0 + 34), fill=LINE)
    if sidebar:
        d.rectangle((x0 + 1, y0 + 35, x0 + 200, y1 - 12), fill=SIDE)
        d.line((x0 + 200, y0 + 35, x0 + 200, y1 - 1), fill=LINE)
        text(d, (x0 + 16, y0 + 48), "Second Brain", 14, INK, bold=True)
        y = y0 + 80
        for s in SIDEBAR:
            sel = active and s.strip().startswith(active)
            if sel:
                rr(d, (x0 + 8, y - 3, x0 + 192, y + 19), "#E8E7E4", r=5)
            lock = "[lock]" in s
            s2 = s.replace("  [lock]", "")
            text(d, (x0 + 16, y), s2[:30], 12, INK if sel else GRAY)
            if lock:
                d.rectangle((x0 + 180, y + 6, x0 + 188, y + 13), fill=AMBER)
                d.arc((x0 + 181, y + 1, x0 + 187, y + 9), 180, 360, fill=AMBER, width=2)
            y += 26
    return d


def content_x():
    return APP[0] + 224


def user_msg(d, y, s):
    x1 = APP[2] - 24
    lines = wrap(d, s, 380, 14)
    w = max(d.textlength(ln, font=f(14)) for ln in lines) + 24
    h = len(lines) * 20 + 14
    rr(d, (x1 - w, y, x1, y + h), "#F1F1EF", r=10)
    yy = y + 7
    for ln in lines:
        text(d, (x1 - w + 12, yy), ln, 14)
        yy += 20
    return y + h + 14


def badge(d, xy, slot, model, extra=None, local=False):
    x, y = xy
    color = GREEN if local else GRAY
    d.ellipse((x, y + 5, x + 9, y + 14), fill=color)
    x += 15
    x += text(d, (x, y), slot, 12, INK, bold=True) + 6
    x += text(d, (x, y), "· " + model, 12, GRAY) + 6
    if extra:
        x += text(d, (x, y), "· " + extra, 12, AMBER) + 6
    d.ellipse((x + 2, y + 3, x + 14, y + 15), outline=GRAY)
    text(d, (x + 6, y + 1), "i", 10, GRAY)
    return y + 24


def hover_card(img, box, title, crumb, lines, pill=None, pill_color=ACCENT):
    d = shadow_card(img, box)
    x, y = box[0] + 14, box[1] + 12
    text(d, (x, y), title, 14, INK, bold=True)
    y += 24
    text(d, (x, y), crumb, 12, ACCENT)
    y += 22
    for ln in lines:
        y = para(d, (x, y), ln, box[2] - box[0] - 28, 12, GRAY, 4)
    if pill:
        chip(d, (x, box[3] - 32), pill, fill="#EEF4FB" if pill_color == ACCENT else AMBER_BG,
             color=pill_color)
    # the pointer
    return d


def cursor(d, xy):
    x, y = xy
    d.polygon([(x, y), (x, y + 20), (x + 5, y + 15), (x + 9, y + 23), (x + 12, y + 22),
               (x + 8, y + 14), (x + 15, y + 14)], fill="black", outline="white")


# ── scenes ──────────────────────────────────────────────────────────────────
# Each scene: title, time, narration, side notes, steps [(seconds, draw_fn)].

def chat_base(img, active=None, title="Chat"):
    return window(img, f"second-brain  ·  {title}", True, active)


def s_problem(step):
    def draw(img):
        d = chat_base(img, title="Home")
        x = content_x()
        text(d, (x, APP[1] + 70), "Good morning", 26, INK, bold=True)
        cards = [("Lectures", "8 notes · 3 learning"), ("Capstone", "plan, papers, data"),
                 ("Life", "health, budget, reviews"), ("Reading", "12 sources")]
        for i, (a, b) in enumerate(cards):
            cx = x + (i % 2) * 300
            cy = APP[1] + 130 + (i // 2) * 110
            rr(d, (cx, cy, cx + 280, cy + 92), SIDE, LINE)
            text(d, (cx + 16, cy + 18), a, 16, INK, bold=True)
            text(d, (cx + 16, cy + 50), b, 13, GRAY)
        if step >= 1:
            ov = Image.new("RGBA", img.size, (255, 255, 255, 0))
            od = ImageDraw.Draw(ov)
            rr(od, (220, 420, 880, 540), (255, 255, 255, 235), LINE, 14)
            img.alpha_composite(ov)
            d = ImageDraw.Draw(img)
            text(d, (250, 440), "Second Brain", 30, INK, bold=True)
            text(d, (250, 486), "One home for all your digital knowledge.", 17, GRAY)
    return draw


def s_workspace(step):
    def draw(img):
        d = window(img, "second-brain  ·  Workspace  ·  Lecture 8: Attention", False)
        x0, y0, x1, y1 = APP
        # source pane (PDF)
        px0, px1 = x0 + 12, x0 + 300
        rr(d, (px0, y0 + 46, px1, y1 - 12), "#F4F4F2", LINE, 8)
        text(d, (px0 + 12, y0 + 54), "Lecture 8.pdf", 12, GRAY)
        page = 3 if step >= 4 else 1
        text(d, (px1 - 70, y0 + 54), f"p. {page} / 4", 12, GRAY)
        rr(d, (px0 + 16, y0 + 80, px1 - 16, y1 - 24), WIN, LINE, 4)
        yy = y0 + 96
        text(d, (px0 + 30, yy), "Self-attention" if page == 3 else "Attention & Transformers",
             14, INK, bold=True)
        yy += 30
        for i in range(12):
            hl = page == 3 and i in (2, 3)
            if hl:
                d.rectangle((px0 + 26, yy - 2, px1 - 26, yy + 9), fill="#FFE8A3")
            d.line((px0 + 30, yy + 4, px1 - 30 - (i * 13) % 60, yy + 4), fill="#C9C8C4", width=5)
            yy += 22
        # note pane
        nx0, nx1 = px1 + 12, x0 + 560
        text(d, (nx0 + 6, y0 + 54), "Lecture 8: Attention", 18, INK, bold=True)
        rr(d, (nx0, y0 + 88, nx1, y0 + 160), "#E7F3F8", None, 6)
        text(d, (nx0 + 12, y0 + 96), "OVERVIEW", 11, ACCENT, bold=True)
        para(d, (nx0 + 12, y0 + 116), "Attention lets each word look at every other word.",
             nx1 - nx0 - 24, 13)
        for i, h in enumerate(["›  Queries, keys, values", "›  Scaled dot-product",
                               "›  Multi-head attention", "›  Positional encoding"]):
            text(d, (nx0 + 6, y0 + 180 + i * 30), h, 14, INK)
        text(d, (nx0 + 6, y0 + 312), "softmax(QKᵀ / √d) · V", 15, INK, mono=True)
        # AI panel
        ax0 = x0 + 572
        d.line((ax0, y0 + 35, ax0, y1 - 1), fill=LINE)
        text(d, (ax0 + 14, y0 + 48), "AI", 13, INK, bold=True)
        if step >= 1:
            rr(d, (ax0 + 60, y0 + 80, x1 - 14, y0 + 112), "#F1F1EF", r=10)
            text(d, (ax0 + 72, y0 + 87), "Explain self-attention simply.", 13)
        if step >= 2:
            y = para(d, (ax0 + 14, y0 + 130), "Each word asks a question (query), and every "
                     "word offers an answer (key). The best matches decide what it reads", 262,
                     13)
            cx = chip(d, (ax0 + 14, y + 2), "1", icon=True, icon_color="#E03E3E", color=INK)
            y = para(d, (ax0 + 14, y + 34), "Several heads do this at once, each looking for "
                     "a different pattern", 262, 13)
            chip(d, (ax0 + 14, y + 2), "2", icon=True, icon_color="#2383E2", color=INK)
            badge(d, (ax0 + 14, y + 40), "Strong", "Nemotron 3 Super")
        if step == 3:
            hover_card(img, (ax0 - 250, y0 + 250, ax0 + 20, y0 + 400), "Lecture 8.pdf",
                       "page 3  ·  Self-attention",
                       ["“Each token builds a query and compares it with every key…”"],
                       "source [1]")
            cursor(ImageDraw.Draw(img), (ax0 + 24, y0 + 262))
    return draw


def s_ask(step):
    def draw(img):
        d = chat_base(img, "Midterm plan")
        x = content_x()
        y = user_msg(d, APP[1] + 60, "What should I review before Friday's midterm?")
        if step >= 1:
            chip(d, (x, y), "search brain — 6 notes matched", icon=True, icon_color=ACCENT)
            y += 40
        if step >= 2:
            y = para(d, (x, y), "Your plan lists three weak spots:", 560, 14)
            for ln, link in [("1. Backprop and the chain rule — ", "Lecture 6: Backprop"),
                             ("2. CNN output shapes — ", "Lecture 7: CNNs"),
                             ("3. Learning-rate schedules — ", "Lecture 5: Gradient descent")]:
                w = text(d, (x, y), ln, 14)
                text(d, (x + w, y), link, 14, ACCENT)
                d.line((x + w, y + 19, x + w + d.textlength(link, font=f(14)), y + 19), fill=ACCENT)
                y += 26
            y = para(d, (x, y + 4), "Start with backprop: it is marked 'learning'.", 560, 14)
        if step >= 3:
            badge(d, (x, y + 10), "Fast", "Nemotron 3 Nano")
        if step >= 4:
            hover_card(img, (x + 150, APP[1] + 250, x + 520, APP[1] + 420),
                       "Lecture 6: Backprop", "ML 301  ›  Lecture 6",
                       ["Backpropagation applies the chain rule layer by layer, from the "
                        "loss back to each weight."], "Personal  ·  learning")
            cursor(ImageDraw.Draw(img), (x + 300, APP[1] + 182))
    return draw


def s_hard(step):
    def draw(img):
        d = chat_base(img)
        x = content_x()
        y = user_msg(d, APP[1] + 60, "Derive the backprop update for a 2-layer network, "
                                     "then quiz me with 3 questions.")
        if step >= 1:
            for ln in ["z₁ = W₁x + b₁,   a₁ = σ(z₁),   ŷ = W₂a₁ + b₂",
                       "∂L/∂W₂ = (ŷ − y) a₁ᵀ",
                       "∂L/∂W₁ = [W₂ᵀ(ŷ − y) ⊙ σ′(z₁)] xᵀ"]:
                text(d, (x, y), ln, 15, INK, mono=True)
                y += 28
            y = para(d, (x, y + 6), "Quiz: 1) Why does σ′ appear?  2) What shape is ∂L/∂W₁?  "
                     "3) What changes with ReLU?", 560, 14)
        if step >= 2:
            y = badge(d, (x, y + 8), "Strong", "Nemotron 3 Super")
            box = (x, y + 4, x + 330, y + 120)
            dd = shadow_card(img, box)
            rows = [("Ran on", "Strong · Nebius Token Factory"),
                    ("Decided by", "the brain (Nemotron Nano, 610 ms)"),
                    ("Why", "derivation + quiz: deep reasoning"), ("Notes sent", "2")]
            for i, (a, b) in enumerate(rows):
                text(dd, (x + 14, y + 16 + i * 24), a, 12, GRAY)
                text(dd, (x + 100, y + 16 + i * 24), b, 12, INK)
    return draw


def s_private(step):
    def draw(img):
        d = chat_base(img, active="Health")
        x = content_x()
        y = user_msg(d, APP[1] + 60, "Plan my study week around my physio appointments.")
        if step >= 1:
            y = para(d, (x, y), "Physio is Tue and Thu at 15:00, and you do 20 minutes of "
                     "exercises daily. So:", 560, 14)
            for ln in ["Mon  backprop (2 h)", "Tue  CNN shapes before physio",
                       "Wed  past exam", "Thu  light review after 15:00 physio",
                       "Fri  midterm"]:
                text(d, (x + 10, y), "•  " + ln, 14)
                y += 24
            y = badge(d, (x, y + 8), "Local", "Nemotron (your Nebius VM)", local=True)
            text(d, (x, y + 2), "Private note read only by your own model.", 12, GREEN)
        if step >= 2:
            box = (x + 40, APP[1] + 330, x + 600, APP[1] + 500)
            dd = shadow_card(img, box)
            text(dd, (box[0] + 14, box[1] + 12), "Without the VM", 13, INK, bold=True)
            badge(dd, (box[0] + 14, box[1] + 40), "Fast", "Nemotron 3 Nano",
                  extra="1 private held back")
            rr(dd, (box[0] + 14, box[1] + 72, box[2] - 14, box[1] + 130), AMBER_BG, r=8)
            text(dd, (box[0] + 26, box[1] + 80), "Held back (private)", 12, AMBER, bold=True)
            text(dd, (box[0] + 26, box[1] + 102), "•  Health: knee physio plan", 12, AMBER)
    return draw


def s_web(step):
    def draw(img):
        d = chat_base(img, active="Capstone")
        x = content_x()
        y = user_msg(d, APP[1] + 60, "Search the web for recent work on CNNs for crop disease "
                                     "detection and save a short reading list for my capstone.")
        if step >= 1:
            chip(d, (x, y), "search web — needs your OK", fill=AMBER_BG, color=AMBER,
                 icon=True, icon_color=AMBER)
            y += 36
            t = 'Search the web for "CNN crop disease detection 2026"? Only these words are sent to Tavily.'
            yy = para(d, (x + 20, y), t, 470, 12, AMBER)
            if step == 1:
                rr(d, (x + 20, yy + 4, x + 100, yy + 30), "#F3D99A", r=12)
                text(d, (x + 34, yy + 8), "Confirm", 12, "#5A3E00", bold=True)
                cursor(d, (x + 70, yy + 18))
            y = yy + 40
        if step >= 2:
            d.rectangle((x, APP[1] + 120, APP[2] - 14, APP[1] + 230), fill=WIN)
            y = APP[1] + 124
            chip(d, (x, y), "search web — 5 web pages", icon=True, icon_color=ACCENT)
            y += 40
            for t, site in [("PlantVillage CNN benchmark", "arxiv.org"),
                            ("Lightweight CNNs for field photos", "nature.com"),
                            ("Leaf disease survey 2025", "sciencedirect.com")]:
                w = text(d, (x, y), "•  " + t, 14)
                text(d, (x + w + 8, y), site, 13, ACCENT)
                y += 26
        if step >= 3:
            hover_card(img, (x + 250, y - 40, x + 590, y + 70), "nature.com",
                       "https://www.nature.com/articles/…", ["Web page · opens in a new tab"])
            cursor(ImageDraw.Draw(img), (x + 272, APP[1] + 198))
        if step >= 4:
            chip(d, (x, y + 10), "create note — Capstone reading list", icon=True,
                 icon_color=GREEN)
            badge(d, (x, y + 48), "Fast", "Nemotron 3 Nano")
    return draw


def s_mcp(step):
    def draw(img):
        d = chat_base(img)
        x = content_x()
        y = user_msg(d, APP[1] + 60, "Ask DeepWiki how PyTorch computes gradients.")
        if step >= 1:
            chip(d, (x, y), "deepwiki · ask question — needs your OK", fill=AMBER_BG,
                 color=AMBER, icon=True, icon_color=AMBER)
            y += 36
            text(d, (x + 20, y), "This server is set to ask before each use — confirm to run it.",
                 12, AMBER)
            y += 26
            if step == 1:
                rr(d, (x + 20, y, x + 100, y + 26), "#F3D99A", r=12)
                text(d, (x + 34, y + 4), "Confirm", 12, "#5A3E00", bold=True)
                cursor(d, (x + 70, y + 14))
            y += 40
        if step >= 2:
            chip(d, (x, y), "deepwiki · ask question — answered", icon=True, icon_color=ACCENT)
            y += 40
            y = para(d, (x, y), "PyTorch records every operation in a graph as it runs "
                     "(autograd). backward() walks that graph in reverse and applies the chain "
                     "rule — the same idea as your Lecture 6 note.", 560, 14)
            badge(d, (x, y + 8), "Fast", "Nemotron 3 Nano")
    return draw


def s_skill(step):
    def draw(img):
        if step < 2:
            d = chat_base(img)
            x = content_x()
            y = user_msg(d, APP[1] + 60, "Save the way you quizzed me as a skill.")
            if step >= 1:
                box = (x, y, x + 520, y + 210)
                dd = shadow_card(img, box)
                text(dd, (x + 16, y + 14), "New skill:  quiz-me", 15, INK, bold=True)
                text(dd, (x + 16, y + 40), "Ask 3 questions after an explanation, "
                     "hardest last.", 13, GRAY)
                for i, ln in enumerate(["1. Explain the idea in plain words",
                                        "2. Ask 3 questions, increasing difficulty",
                                        "3. Wait for answers, then mark them"]):
                    text(dd, (x + 16, y + 74 + i * 24), ln, 13)
                rr(dd, (x + 16, y + 160, x + 86, y + 190), ACCENT, r=8)
                text(dd, (x + 32, y + 165), "Save", 13, "white", bold=True)
                text(dd, (x + 104, y + 165), "Dismiss", 13, GRAY)
                cursor(dd, (x + 60, y + 178))
        else:
            d = window(img, "second-brain  ·  Settings  ·  Skills", False)
            x = APP[0] + 40
            text(d, (x, APP[1] + 60), "Skills", 24, INK, bold=True)
            rows = [("quiz-me", "AI-drafted", "#FBF3DB", AMBER),
                    ("study-guide", "built-in", CHIP, GRAY),
                    ("flashcards", "built-in", CHIP, GRAY),
                    ("cite-everything", "built-in", CHIP, GRAY),
                    ("exam-week-planner", "yours", "#EEF4FB", ACCENT)]
            for i, (n, tag, bg, col) in enumerate(rows):
                yy = APP[1] + 110 + i * 52
                d.line((x, yy + 44, APP[2] - 40, yy + 44), fill=LINE)
                text(d, (x, yy + 10), n, 15, INK, bold=i == 0)
                chip(d, (x + 260, yy + 8), tag, fill=bg, color=col)
    return draw


def s_control(step):
    def draw(img):
        if step == 0:
            d = window(img, "second-brain  ·  Settings  ·  Routing", False)
            x = APP[0] + 40
            text(d, (x, APP[1] + 60), "Routing", 24, INK, bold=True)
            text(d, (x, APP[1] + 104), "Rules (checked first)", 14, GRAY, bold=True)
            for i, (a, b) in enumerate([("Private notes needed", "→  Local (your Nebius VM)"),
                                        ("Context over 30,000 tokens", "→  Strong"),
                                        ("Sensitive words", "→  Local")]):
                yy = APP[1] + 134 + i * 40
                rr(d, (x, yy, APP[2] - 40, yy + 32), SIDE, LINE, 6)
                text(d, (x + 12, yy + 7), a, 13)
                text(d, (x + 330, yy + 7), b, 13, ACCENT)
            text(d, (x, APP[1] + 270), "Brain (decides the rest)", 14, GRAY, bold=True)
            text(d, (x, APP[1] + 298), "Nemotron  ·  sees the message only, never note text",
                 13, NV)
            text(d, (x, APP[1] + 336), "Targets", 14, GRAY, bold=True)
            for i, (s, m) in enumerate([("Fast", "Nemotron 3 Nano · Token Factory"),
                                        ("Strong", "Nemotron 3 Super · Token Factory"),
                                        ("Local", "Nemotron · your Nebius VM")]):
                text(d, (x, APP[1] + 364 + i * 28), f"{s:<8}{m}", 13, INK, mono=True)
        elif step == 1:
            d = window(img, "second-brain  ·  Settings  ·  About you", False)
            x = APP[0] + 40
            text(d, (x, APP[1] + 60), "About you", 24, INK, bold=True)
            text(d, (x, APP[1] + 100), "What the AI remembers. Edit or delete any line.", 13,
                 GRAY)
            for i, ln in enumerate(["Studies ML 301; midterm Friday 6 Nov",
                                    "Prefers bullet points with one example",
                                    "Capstone: crop-disease detection with CNNs"]):
                yy = APP[1] + 140 + i * 44
                rr(d, (x, yy, APP[2] - 40, yy + 34), SIDE, LINE, 6)
                text(d, (x + 12, yy + 8), ln, 13)
        else:
            d = window(img, "second-brain  ·  Activity", False)
            x = APP[0] + 40
            text(d, (x, APP[1] + 60), "Activity", 24, INK, bold=True)
            hdr = ["Time", "Job", "Model", "Cost"]
            cols = [x, x + 90, x + 280, x + 640]
            for c, h in zip(cols, hdr):
                text(d, (c, APP[1] + 110), h, 12, GRAY, bold=True)
            rows = [("10:42", "chat", "Nemotron 3 Nano", "$0.0004"),
                    ("10:42", "routing brain", "Nemotron 3 Nano", "$0.0001"),
                    ("10:40", "chat", "Nemotron 3 Super", "$0.0031"),
                    ("10:38", "chat (private)", "Nemotron · your VM", "$0"),
                    ("10:35", "study guide", "Nemotron 3 Super", "$0.0120"),
                    ("10:31", "web search", "Tavily", "1 credit")]
            for i, r in enumerate(rows):
                yy = APP[1] + 140 + i * 34
                d.line((x, yy + 28, APP[2] - 40, yy + 28), fill=LINE)
                for c, v in zip(cols, r):
                    text(d, (c, yy + 4), v, 13, NV if "Nemotron" in v else INK)
    return draw


def s_close(step):
    def draw(img):
        d = ImageDraw.Draw(img)
        rr(d, APP, WIN, LINE, 12)

        def node(box, title, sub, color=INK, fill=SIDE):
            rr(d, box, fill, LINE, 10)
            text(d, (box[0] + 12, box[1] + 10), title, 14, color, bold=True)
            para(d, (box[0] + 12, box[1] + 34), sub, box[2] - box[0] - 24, 11, GRAY, 3)

        def arrow(a, b):
            d.line((a, b), fill=GRAY, width=2)
            d.polygon([(b[0], b[1]), (b[0] - 7, b[1] - 5), (b[0] - 7, b[1] + 5)], fill=GRAY)

        x0, y0 = APP[0] + 24, APP[1] + 30
        text(d, (x0, y0), "How it works", 20, INK, bold=True)
        node((x0, y0 + 150, x0 + 150, y0 + 230), "You", "notes, PDFs, videos, questions")
        node((x0 + 190, y0 + 80, x0 + 380, y0 + 190), "Rules + brain",
             "fixed rules first; then Nemotron Nano picks a model", NV, "#F3F9E8")
        node((x0 + 190, y0 + 230, x0 + 380, y0 + 330), "Privacy gate",
             "cuts notes to what the chosen model may see", AMBER, AMBER_BG)
        node((x0 + 450, y0 + 40, x0 + 800, y0 + 110), "Fast · Nemotron 3 Nano",
             "Nebius Token Factory", NV)
        node((x0 + 450, y0 + 130, x0 + 800, y0 + 200), "Strong · Nemotron 3 Super",
             "Nebius Token Factory", NV)
        node((x0 + 450, y0 + 220, x0 + 800, y0 + 290), "Local · small Nemotron",
             "on your own computer — the only model private notes reach", GREEN)
        node((x0 + 450, y0 + 320, x0 + 800, y0 + 390), "Tools you choose",
             "Tavily web search · MCP servers — asked first", ACCENT)
        arrow((x0 + 150, y0 + 190), (x0 + 188, y0 + 140))
        arrow((x0 + 150, y0 + 190), (x0 + 188, y0 + 280))
        for yy in (75, 165, 255, 355):
            arrow((x0 + 380, y0 + 190), (x0 + 448, y0 + yy))
        if step >= 1:
            text(d, (x0, y0 + 440), "Your private notes only ever reach your own model.", 18,
                 INK, bold=True)
    return draw


SCENES = [
    ("0:00", "The problem", 12, s_problem, [5, 7],
     "Everything I know lives in my Second Brain: what I read, watch, plan, and study. AI could "
     "help me use it, but then I hand it everything. Today I'll show it with my studies.",
     ["Home: courses, project, health, money", "Title: one home for all your knowledge"]),
    ("0:12", "Workspace: lecture + sources", 28, s_workspace, [5, 4, 6, 7, 6],
     "My lecture sits beside my note. Nemotron answers from it, and every claim shows where it "
     "came from. One click takes me to the exact page.",
     ["Open the Lecture 8 workspace", "Ask: Explain self-attention simply",
      "Answer with [1] [2]", "HOVER [1]: card shows page 3 + quote", "Click: PDF jumps to p. 3"]),
    ("0:40", "Ask your whole brain", 20, s_ask, [3, 3, 5, 3, 6],
     "It searches all my notes and links to them. A small Nemotron read my question and chose "
     "the fast model.",
     ["Ask about Friday's midterm", "search brain chip", "Answer links three notes",
      "Badge: Fast · Nemotron 3 Nano", "HOVER a link: where the note lives"]),
    ("1:00", "Hard question → big model", 15, s_hard, [3, 6, 6],
     "Hard question, so it goes to Nemotron Super. Every answer tells me which model ran, and "
     "why.",
     ["Ask a derivation + quiz", "Badge: Strong · Nemotron 3 Super",
      "Click badge: decided by the brain"]),
    ("1:15", "Private stays private", 25, s_private, [4, 11, 10],
     "My health note is private. It never goes to a shared API. This ran on my own Nemotron, on "
     "my own Nebius machine.",
     ["Ask to plan around physio", "Badge: Local · your Nebius VM",
      "(If no VM: '1 private held back')"]),
    ("1:40", "Web research (Tavily)", 22, s_web, [3, 5, 4, 5, 5],
     "When my notes aren't enough, it searches the web with Tavily. I approve the exact words "
     "that leave. Then it saves a reading list as a note.",
     ["Ask for web research", "Approve the exact words", "5 web pages",
      "HOVER a link: the website", "create note"]),
    ("2:02", "Tools I choose (MCP)", 15, s_mcp, [3, 4, 8],
     "It connects to any MCP tool I choose, and asks me first. My brain is an MCP server too, so "
     "other AI apps can search it.",
     ["Ask DeepWiki", "Confirm (Ask me first)", "Answer"]),
    ("2:17", "It learns a skill", 13, s_skill, [3, 5, 5],
     "It can turn what worked into a reusable skill. Nothing is kept until I say so.",
     ["Ask to save as a skill", "Skill card: Save", "Settings → Skills: AI-drafted"]),
    ("2:30", "I stay in control", 12, s_control, [4, 4, 4],
     "Rules, memory, and a log of every call. All mine to change.",
     ["Settings → Routing", "Settings → About you", "Activity: every call"]),
    ("2:42", "Close", 13, s_close, [6, 7],
     "Today it was my studies. It works the same for all your knowledge. Second Brain: three "
     "Nemotrons on Nebius. One decides, one answers fast, one thinks hard. Your private notes "
     "only ever reach your own model.",
     ["Architecture", "Tagline"]),
]
TOTAL = sum(s[2] for s in SCENES)


def frame(scene_i, step):
    t0, title, dur, fn, steps, say, notes = SCENES[scene_i]
    img = Image.new("RGBA", (W, H), BG)
    d = ImageDraw.Draw(img)
    # header
    start = sum(s[2] for s in SCENES[:scene_i])
    done = start + sum(steps[:step])
    d.rectangle((0, 0, W, 6), fill="#D9D8D4")
    d.rectangle((0, 0, int(W * done / TOTAL), 6), fill=NV)
    rr(d, (24, 20, 96, 48), INK, r=8)
    text(d, (36, 24), t0, 15, "white", bold=True)
    text(d, (110, 22), title, 20, INK, bold=True)
    rr(d, (W - 190, 20, W - 24, 48), "#FFF3C4", r=8)
    text(d, (W - 178, 25), "DRAFT · storyboard", 13, AMBER, bold=True)
    fn(step)(img)
    d = ImageDraw.Draw(img)
    # right column: on screen
    rx = 900
    text(d, (rx, 76), "ON SCREEN", 12, GRAY, bold=True)
    y = 102
    for i, n in enumerate(notes):
        cur = i == step
        col = INK if i <= step else "#B4B3AF"
        if cur:
            rr(d, (rx - 8, y - 5, W - 24, y + 25), "#F3F9E8", r=6)
        d.ellipse((rx, y + 6, rx + 9, y + 15), fill=NV if i <= step else "#CFCECA")
        y = para(d, (rx + 18, y), n, W - rx - 50, 14, col, 4, bold=cur) + 14
    # subtitle
    rr(d, (24, 604, W - 24, 700), (30, 30, 28), r=12)
    yy = 616
    for ln in wrap(d, "“" + say + "”", W - 100, 19):
        text(d, (48, yy), ln, 19, "white")
        yy += 27
    return img.convert("RGB")


def main():
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg is needed")
    if TMP.exists():
        shutil.rmtree(TMP)
    TMP.mkdir(parents=True)
    entries, prev, n = [], None, 0
    for si, sc in enumerate(SCENES):
        assert abs(sum(sc[4]) - sc[2]) < 1e-6, sc[1]
        for st, secs in enumerate(sc[4]):
            img = frame(si, st)
            if prev is not None:   # a short cross-fade into each step
                for k in (1, 2, 3, 4, 5):
                    p = TMP / f"{n:05d}.png"
                    Image.blend(prev, img, k / 6).save(p)
                    entries.append((p, 1 / 30))
                    n += 1
                secs -= 5 / 30
            p = TMP / f"{n:05d}.png"
            img.save(p)
            entries.append((p, secs))
            n += 1
            prev = img
    lst = TMP / "list.txt"
    with open(lst, "w") as fh:
        for p, secs in entries:
            fh.write(f"file '{p}'\nduration {secs:.4f}\n")
        fh.write(f"file '{entries[-1][0]}'\n")
    out = OUT / "draft_scenario.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                    "-i", str(lst), "-vf", "fps=30,format=yuv420p", "-c:v", "libx264",
                    "-preset", "veryfast", "-crf", "22", str(out)], check=True)
    shutil.rmtree(TMP)
    print(out, f"{TOTAL} s")


if __name__ == "__main__":
    main()
