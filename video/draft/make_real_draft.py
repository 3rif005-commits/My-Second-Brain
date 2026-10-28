"""Draft video from the REAL app: screenshots of the live site (demo account),
and, where a screenshot could not be taken, a frame with what the live
rehearsal actually returned. Narration as subtitles, timed to the script
(docs/hackathon/DEMO_SCENARIO.md).

    python3 video/draft/make_real_draft.py <screenshots dir>
        → video/out/draft_real.mp4
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

import make_draft as m

W, H = m.W, m.H
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
OUT = m.OUT
TMP = OUT / "real_frames"

REAL = ("REAL APP · live site", "#E6F4EA", m.GREEN)
LIVE = ("REHEARSED LIVE · screenshot pending", "#FFF3C4", m.AMBER)
MOCK = ("DRAWN · replace with screen", "#EEE", m.GRAY)


def base(t0: str, title: str, tag, say: str, done: float, total: float):
    img = Image.new("RGBA", (W, H), m.BG)
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, 6), fill="#D9D8D4")
    d.rectangle((0, 0, int(W * done / total), 6), fill=m.NV)
    m.rr(d, (24, 18, 96, 46), m.INK, r=8)
    m.text(d, (36, 22), t0, 15, "white", bold=True)
    m.text(d, (110, 20), title, 20, m.INK, bold=True)
    label, bg, fg = tag
    tw = d.textlength(label, font=m.f(13, True))
    m.rr(d, (W - 48 - tw, 18, W - 24, 46), bg, r=8)
    m.text(d, (W - 36 - tw, 23), label, 13, fg, bold=True)
    m.rr(d, (24, 620, W - 24, 708), (30, 30, 28), r=12)
    yy = 630
    for ln in m.wrap(d, "“" + say + "”", W - 100, 18)[:3]:
        m.text(d, (48, yy), ln, 18, "white")
        yy += 25
    return img


def shot(img, name: str, focus: tuple[int, int, int, int] | None = None):
    """Paste a screenshot into the frame (y 56..612), optionally cropped."""
    src = Image.open(SHOTS / name).convert("RGB")
    if focus:
        src = src.crop(focus)
    box_w, box_h = W - 48, 612 - 58
    scale = min(box_w / src.width, box_h / src.height)
    src = src.resize((int(src.width * scale), int(src.height * scale)), Image.LANCZOS)
    x = (W - src.width) // 2
    y = 58 + (box_h - src.height) // 2
    d = ImageDraw.Draw(img)
    m.rr(d, (x - 3, y - 3, x + src.width + 3, y + src.height + 3), "#CFCEC9", r=6)
    img.paste(src, (x, y))


def card(img, rows: list[tuple[str, str]], prompt: str):
    """What the live rehearsal returned, as a readable panel."""
    d = ImageDraw.Draw(img)
    m.rr(d, (80, 66, W - 80, 604), m.WIN, m.LINE, 14)
    y = 84
    m.rr(d, (W - 600, y, W - 104, y + 20 + 22 * len(m.wrap(d, prompt, 460, 14))), "#F1F1EF", r=10)
    yy = y + 10
    for ln in m.wrap(d, prompt, 460, 14):
        m.text(d, (W - 588, yy), ln, 14)
        yy += 22
    y = yy + 40
    for k, v in rows:
        m.text(d, (110, y + 2), k, 16, m.GRAY, bold=True)
        y2 = m.para(d, (270, y), v, W - 400, 19, m.INK, 8)
        y = max(y + 36, y2 + 16)
        if y > 580:
            break


# (time, title, seconds, narration, [(seconds, tag, painter)])
def S(name, focus=None):
    return lambda img: shot(img, name, focus)


def C(prompt, rows):
    return lambda img: card(img, rows, prompt)


def drawn(fn, step):
    return lambda img: fn(step)(img)


SCENES = [
    ("0:00", "The problem", 12,
     "Everything I know lives in my Second Brain: what I read, watch, plan, and study. AI could "
     "help me use it, but then I hand it everything. Today I'll show it with my studies.",
     [(12, REAL, S("s01_board.jpg"))]),
    ("0:12", "Workspace: a lecture with its sources", 28,
     "My lecture sits beside my note. Nemotron answers from it, and every claim shows where it "
     "came from. One click takes me to the exact page.",
     [(9, REAL, S("s02a_answer.jpg")), (10, REAL, S("s02b_sourcecard.jpg")),
      (9, REAL, S("s02c_jump.jpg"))]),
    ("0:40", "Ask your whole brain", 20,
     "It searches all my notes and links to them. A small Nemotron read my question and chose "
     "the fast model.",
     [(12, REAL, S("s03a_answer.jpg")),
      (8, LIVE, C("What should I review before Friday's midterm?", [
          ("Hover a link", "A floating card opens: the note's title, \"Edited 9m ago\", the "
                           "passage around the cited block with the cited part marked, formulas "
                           "drawn. Click opens the note at that block."),
          ("Under answer", "Read from your notes: Weekly review · Midterm plan · Advisor "
                           "meeting · Lecture 6 (each with the same card)"),
          ("Ran on", "Fast · Nemotron 3 Nano · decided by the brain")]))]),
    ("1:00", "A hard question goes to the big model", 15,
     "Hard question, so it goes to Nemotron Super. Every answer tells me which model ran, and why.",
     [(15, LIVE, C("Derive the backprop update for a 2-layer network, then quiz me with 3 "
                   "questions. Answer here in the chat.", [
          ("Ran on", "Strong · nvidia/nemotron-3-super-120b-a12b · Nebius Token Factory"),
          ("Decided by", "the brain (Nemotron Nano, 1,160 ms)"),
          ("Why", "Need detailed derivation"),
          ("Answer", "The forward pass, ∂L/∂W₂ = (ŷ − y)·a₁ᵀ, ∂L/∂W₁ with the transpose, and "
                     "three questions from easy to hard.")]))]),
    ("1:15", "Private stays private", 25,
     "My health note is private. Second Brain uses two kinds of model: a small Nemotron that can "
     "run on an ordinary computer, and bigger Nemotrons over the API. Private notes only go to "
     "the small one on my own machine. In this demo it runs in the cloud, so the note is held back.",
     [(25, LIVE, C("Plan my study week around my physio appointments. Answer in chat.", [
          ("Ran on", "Strong · Nemotron 3 Super · Nebius Token Factory"),
          ("Held back", "2 private: Health · knee physio plan, Budget and scholarship"),
          ("Answer", "\"…leave open windows for physio; you can fill in the exact times once you "
                     "know your appointment schedule.\" The cloud model never saw the note."),
          ("Index", "The private note is searchable by its words in our own database; it is "
                    "never sent to the cloud embedder (fixed today).")]))]),
    ("1:40", "Web research (Tavily)", 22,
     "When my notes aren't enough, it searches the web with Tavily. I approve the exact words "
     "that leave. Then it saves a reading list as a note.",
     [(8, LIVE, C("Use web search to find 3 recent papers on CNNs for crop disease detection. "
                  "List them with links, then save them as a note titled 'Capstone reading list'.", [
          ("Asks first", "Search the web for \"recent CNNs for crop disease detection\"? Only "
                         "these words are sent to Tavily.   [Confirm]")])),
      (14, LIVE, C("…after Confirm", [
          ("Ran on", "Strong · Nemotron 3 Super"),
          ("Tools", "search web — 8 web pages   →   create note — Capstone reading list"),
          ("Found", "González-Briones et al. 2025 (Int J Comput Intell Syst); Ashurov et al. "
                    "2025 (Front. Plant Sci.); and a third 2025 paper, each with its link")]))]),
    ("2:02", "Tools I choose (MCP)", 15,
     "It connects to any MCP tool I choose, and asks me first.",
     [(5, LIVE, C("Use the DeepWiki tool to ask how PyTorch's autograd computes gradients "
                  "(repo pytorch/pytorch). Answer in 3 sentences.", [
          ("Asks first", "deepwiki · ask wiki question — This server is set to ask before each "
                         "use — confirm to run it.   [Confirm]")])),
      (10, LIVE, C("…after Confirm", [
          ("Tool", "deepwiki · ask wiki question — answered (3,615 characters)"),
          ("Answer", "Operations on tensors with requires_grad are recorded into a graph; "
                     ".backward() walks it in reverse and applies the chain rule…")]))]),
    ("2:17", "It learns a skill", 13,
     "It can turn what worked into a reusable skill. Nothing is kept until I say so.",
     [(13, LIVE, C("Turn this way of studying into a reusable skill … Propose it as a skill "
                   "called quiz-me.", [
          ("Card", "New skill: quiz-me — Explain a concept in plain language, then quiz the "
                   "user with three questions of increasing difficulty and mark the answers."),
          ("Buttons", "[Save]  [Dismiss]   — nothing is saved until the click")]))]),
    ("2:30", "I stay in control", 12,
     "Rules, memory, and a log of every call. All mine to change.",
     [(4, MOCK, drawn(m.s_control, 0)), (4, MOCK, drawn(m.s_control, 1)),
      (4, MOCK, drawn(m.s_control, 2))]),
    ("2:42", "Close", 13,
     "Today it was my studies. It works the same for all your knowledge. Second Brain: a small "
     "Nemotron that decides and keeps private notes private, and bigger Nemotrons on Nebius for "
     "the heavy work.",
     [(13, MOCK, drawn(m.s_close, 1))]),
]
TOTAL = sum(s[2] for s in SCENES)


def main():
    if TMP.exists():
        shutil.rmtree(TMP)
    TMP.mkdir(parents=True)
    entries, prev, n, done = [], None, 0, 0.0
    for t0, title, secs, say, steps in SCENES:
        assert abs(sum(st[0] for st in steps) - secs) < 1e-6, title
        for dur, tag, paint in steps:
            img = base(t0, title, tag, say, done, TOTAL)
            paint(img)
            img = img.convert("RGB")
            if prev is not None:
                for k in (1, 2, 3, 4, 5):
                    p = TMP / f"{n:05d}.png"
                    Image.blend(prev, img, k / 6).save(p)
                    entries.append((p, 1 / 30))
                    n += 1
                dur -= 5 / 30
            p = TMP / f"{n:05d}.png"
            img.save(p)
            entries.append((p, dur))
            n += 1
            prev = img
            done += dur + (5 / 30 if n > 1 else 0)
    lst = TMP / "list.txt"
    with open(lst, "w") as fh:
        for p, secs in entries:
            fh.write(f"file '{p}'\nduration {secs:.4f}\n")
        fh.write(f"file '{entries[-1][0]}'\n")
    out = OUT / "draft_real.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                    "-i", str(lst), "-vf", "fps=30,format=yuv420p", "-c:v", "libx264",
                    "-preset", "veryfast", "-crf", "22", str(out)], check=True)
    shutil.rmtree(TMP)
    print(out, f"{TOTAL} s")


if __name__ == "__main__":
    main()
