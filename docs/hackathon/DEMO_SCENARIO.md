# Demo scenario: Second Brain on Nemotron + Nebius

The plan for the video (under 3 minutes), the demo account the judges log into, and what must be
true before recording. Hackathon: Nebius x NVIDIA Global AI Hackathon, **Personal AI** track, plus
the **Best Use of Tavily** bonus. Deadline Fri 30 Oct 2026, 10:00 PT.

## 1. What the judges score (equal weight)

| Criterion | What they ask | What the video must prove |
|---|---|---|
| Technological implementation | How well is it built, and how well does it use Token Factory / AI Cloud and Nemotron? | Three Nemotrons with three jobs: Nano decides, Nano answers everyday questions, Super does the hard work. Every answer shows which one ran and why |
| Design | A complete product, not a proof of concept | One real person's day in one app: capture → ask → think → private → web → control |
| Potential impact | A real problem for a real audience, solved in what is shown | Everyone's knowledge is scattered across PDFs, links, videos and notes, and using AI on it means handing all of it to a cloud. Here the AI knows all of it, and private things stay private. The video shows this through one audience, students, so the case is specific |
| Quality of the idea | A creative, non-obvious use of Nebius + Nemotron | The small Nemotron is the **switchboard**: it decides where each request runs. Private notes go only to your own model. Big jobs go to the big model |

The Personal AI track asks for: private, data under your control, persistent memory, reusable
skills, tools you choose, tasks across your daily work. Each of these appears on screen below.

## 2. The app's idea, in one breath

Second Brain is **one home for all your digital knowledge**: what you read, watch, study, plan
and keep. It is a Notion-style notebook that **understands** what you put in it. Drop a PDF, a link
or a video and it becomes a study guide. Ask a question and it answers from your own notes, with
links to them. Every note has a privacy level (Open / Personal / Private), and a switchboard
decides, for every AI call, **which model may see what**. You can always see where an answer ran
and why.

**The one sentence for the video:** *"One place for everything I know, with an AI that knows it
too, and still keeps my private life private."*

**Why the video shows studying:** three minutes can't show every use. Studying is the clearest
example: a lot of material, real deadlines, and private life mixed in. The video says once that
this is one example, and the closing line goes back to the general idea.

## 3. The story

The example is a student. The narrator ("I") keeps everything in Second Brain: courses, a
project, health, money, a weekly review. This week they have a machine-learning midterm on Friday, a capstone project, and a
knee injury with physio appointments. All of it lives in Second Brain.

## 4. The script (target 2:50)

Narration is short on purpose: read it slowly. **Bold** = what to click or type.

### 0:00–0:15 · The problem
- **Screen:** the demo account's home, sidebar full of notes.
- **Say:** "Everything I know lives in my Second Brain: what I read, watch, plan, and study. AI
  could help me use it, but then I hand it everything. Today I'll show it with my studies."

### 0:15–0:40 · Capture: a PDF becomes a study guide (Nemotron 3 Super)
- **Do:** open **Ingest**, drop `Lecture 8 - Attention and Transformers.pdf`.
  - **Cut:** the wait.
- **Show:** the finished note: an overview callout, collapsible deep dives, a formula block.
- **Say:** "I drop in today's lecture. Nemotron Super on Nebius Token Factory turns it into a study
  guide inside my notes."

### 0:40–1:05 · Ask your brain (Nemotron Nano, chosen by Nemotron)
- **Do:** open **Chat** and type: **"What should I review before Friday's midterm?"**
- **Show:**
  - the 🔍 *search brain* chip;
  - the answer, citing *Midterm plan* and *Lecture 6* as links;
  - the route badge under it: **Fast · Nemotron 3 Nano**.
- **Say:** "It answers from my own notes and links to them. A small Nemotron read the question and
  sent it to the fast model."

### 1:05–1:25 · A hard question goes to the big model
- **Type:** **"Derive the backprop update for a 2-layer network, then quiz me with 3 questions."**
- **Show:**
  - the badge: **Strong · Nemotron 3 Super**;
  - click it. The popover reads: *Decided by the brain · Why: deep reasoning*.
- **Say:** "This one is hard, so Nemotron sends it to Nemotron Super. Every answer tells me which
  model ran, and why."

### 1:25–1:55 · Private stays private (the key scene)
- **Type:** **"Plan my study week around my physio appointments."**
- **With the Nebius VM on (recommended):**
  - **Show:** the badge **Local · Nemotron (your Nebius VM)**. The answer knows *Thursday 15:00
    physio*.
  - **Say:** "My health note is private. It never goes to a shared API. This answer ran on my own
    Nemotron, on my own Nebius machine."
- **Without the VM:**
  - **Show:** the badge **Fast · … · 1 private held back**. Click it to show *Held back (private):
    Health: knee physio plan*.
  - **Say:** "My health note is private, so it was held back. The cloud model never saw it."

### 1:55–2:25 · Web research (Tavily)
- **Type:** **"Search the web for recent work on CNNs for crop disease detection and save a short
  reading list for my capstone."**
- **Show, in order:**
  1. the amber prompt *Search the web for "…"? Only these words are sent to Tavily.*
  2. **Confirm**;
  3. the 🌐 *search web* chip (*5 web pages*);
  4. the answer with source links;
  5. the ✨ *create note* chip;
  6. open the new note.
- **Say:** "When my notes aren't enough, it searches the web with Tavily. I see the exact words
  that leave, nothing else. Then it saves what it found as a note."

### 2:25–2:40 · I stay in control
Quick cuts, about 5 s each:
1. **Settings → Routing:**
   - the rules: *private → my own model*, *big context → Strong*;
   - the brain: Nemotron.
2. **Settings → About you:** what it remembers about me.
3. **Settings → Skills:** reusable skills (built-in, mine, drafted by the AI).
4. **Activity:** every AI call, which model ran it, what it cost.
- **Say:** "Rules, memory, skills, and a log of every call. All mine to change."

### 2:40–2:55 · Close
- **Screen:** the architecture diagram from the README.
- **Say:** "Today it was my studies. It works the same for all your knowledge: work, research,
  reading, life. Second Brain: three Nemotrons on Nebius. One decides, one answers fast, one
  thinks hard. Your private notes only ever reach your own model."

## 5. The demo account

| | |
|---|---|
| Email | `mysecondbrain.demo@gmail.com` |
| Password | in the Devpost testing instructions only |
| Routing | the default (no saved policy), so the Nemotron setup applies |

Notes to create. The levels matter: they drive the privacy scene.

| # | Note | Level | Used in |
|---|---|---|---|
| 1 | ML 301: Lecture 5: Gradient descent | Personal | ask |
| 2 | ML 301: Lecture 6: Neural networks and backprop (marked *learning*) | Personal | ask, strong |
| 3 | ML 301: Lecture 7: Convolutional networks | Personal | web |
| 4 | Midterm plan: Friday 6 Nov (topics, weak spots: backprop, CNN shapes) | Personal | ask, private |
| 5 | Capstone: crop-disease detector (CNN on leaf photos) | Personal | web |
| 6 | Reading list (papers with links) | Open | web |
| 7 | Advisor meeting: 21 Oct | Personal | ask |
| 8 | Health: knee physio plan (Tue/Thu 15:00, 20 min exercises daily, no running until 20 Nov) | **Private** | private |
| 9 | Budget and scholarship | **Private** | (shows a 2nd private note held back) |
| 10 | Weekly review: 26 Oct | Personal | ask |
| 11 | NumPy cheat sheet | Open | — |

The file to drop live: `Lecture 8 - Attention and Transformers.pdf`, about 4 pages. We write it
ourselves, so there is nothing to license.

## 6. Must be true before recording

1. **Every AI call in the demo account runs on Nemotron.**
   - Today chat does, but one-shot jobs (the PDF study guide, titles, workspace jobs) try Anthropic
     first, because the app puts Claude first for them.
   - Fix: a removable `NEBIUS_ONLY_USERS` setting. Accounts listed there use only Nebius. The real
     account keeps Claude.
   - Then check that Nemotron Super's study guide renders well (callouts, toggles, formulas).
2. **Decide on the VM.**
   - With it, the private scene shows a private answer on your own Nemotron: the strongest moment,
     and it uses Nebius AI Cloud too.
   - Cost: a few dollars for setup + recording. Turn it off after; the app falls back by itself.
3. **The badge wording on the VM:** "stayed on this device" should read "on your own model" when
   the local slot is the VM.
4. **Run each prompt above once before recording.** Nano's answers vary; change a prompt's wording
   if one comes out weak.
5. **Clean up the test runs:** delete the rehearsal chats; keep the notes.
6. **Recording:** 1080p, dark or light mode (pick one), browser zoom 110%, no other tabs.
   - Upload to YouTube as public or unlisted (the rules say *publicly visible*).

## 7. Not in the video, but in the Devpost text

- What changed since 26 Aug (the rules require it): the Nemotron switchboard, Token Factory, the
  private-model front door, Tavily web research, per-user skills, About-you memory, and the
  security work from studying NemoClaw / OpenShell / Hermes.
- Embeddings for note search use Gemini. Say so; don't claim "100% Nemotron".
- Honest wording: "Private" means *your own model* (the VM), not "never leaves the laptop", when
  the VM is the private model.
