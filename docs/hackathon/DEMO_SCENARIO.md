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

**The design:** two kinds of model.
- **A small Nemotron that can run on an ordinary computer** (Nemotron Nano 9B fits a laptop). It
  decides where each request goes and is the only model that may read private notes.
- **Bigger Nemotrons on Nebius Token Factory** (Nano 30B, Super 120B), called over the API for the
  heavy work.
- **In the hosted demo** there is no local machine, so the small model's job runs in the cloud on
  Token Factory, and private notes are held back instead of sent there.

**The one sentence for the video:** *"One place for everything I know, with an AI that knows it
too, and still keeps my private life private."*

**Why the video shows studying:** three minutes can't show every use. Studying is the clearest
example: a lot of material, real deadlines, and private life mixed in. The video says once that
this is one example, and the closing line goes back to the general idea.

## 3. The story

The example is a student. The narrator ("I") keeps everything in Second Brain: courses, a
project, health, money, a weekly review. This week they have a machine-learning midterm on Friday, a capstone project, and a
knee injury with physio appointments. All of it lives in Second Brain.

## 4. The script, v2 (target 2:45)

v1 (nine scenes on routing, privacy, Tavily, MCP, skills) was recorded on 29 Oct and reviewed
frame by frame; it is in git history. v2 follows one study session from an empty note to a filed
note, and keeps the AI visible at every step. Narration is short: read it slowly. **Bold** = what
to click or type.

**Recording rules (from the v1 review):**
- Browser zoom 125 %, AI panel wide: little camera zoom needed, text stays sharp.
- Every take starts on a clean screen, at the moment the action starts.
- One confirm per tool; no "denied" from an earlier attempt on screen.
- Captions are short lines timed to the action, not one paragraph per scene.
- Callouts (box + label) point at what matters instead of heavy zoom.

### 0:00–0:05 · Title
Card: "Second Brain: AI for everything you know · NVIDIA Nemotron on Nebius".

### 0:05–0:30 · A note is blocks
New note **Backprop: midterm review**. Type **/** and add: heading, to-do, toggle, callout,
**math formula** (the chain rule), table, code.
> "A note is made of blocks. Type slash and pick one: headings, to-dos, toggles, callouts,
> formulas, tables, code."

### 0:30–0:50 · The workspace, with a lecture video
**Open in workspace** → add source → paste the 3Blue1Brown video
(*Backpropagation, intuitively*, https://www.youtube.com/watch?v=Ilg3gGewQ5U).
> "Backprop is my weak spot. I open the note in the workspace and add a 3Blue1Brown lecture."

### 0:50–1:10 · Nemotron writes the study guide
Run **Study guide** on the video. Callout on the model badge / "why" box.
> "Nemotron on Nebius reads the transcript and writes a study guide, with timestamps."

### 1:10–1:40 · Study with the video
Click a timestamp in the guide → the video jumps there. On the capture rail: **Frame** → the
frame lands in the note; **Clip** … **End clip** → a clip lands in the note.
> "Each section links to its moment in the video. I grab a frame, and a clip, straight into my
> note."

### 1:40–2:05 · Nemotron builds something to play with
AI panel: **"Make an interactive block where I drag a weight and watch the loss and the gradient
change."** The block appears in the note; drag it.
> "Then I ask Nemotron to build something I can play with: an interactive block, written in
> HTML, inside my note."

### 2:05–2:20 · The web, with my OK (Tavily)
AI panel: **"Find one recent article that explains backprop well and add it to the note."** →
the query to approve → **Confirm** → the link is in the note. Callout: "Only these words are
sent to Tavily".
> "When the lecture isn't enough, it searches the web with Tavily. I approve the exact words
> that leave."

### 2:20–2:40 · File it in the database
Properties: **Module = Machine Learning (ML 301)**, **Type = Course** → open **Academic studies**:
the note is a card on the board, with the other lectures.
> "Finally I file it. Set its module and type, and it joins my course database with every other
> lecture."

### 2:40–2:45 · End card
Repo and demo links. "Second Brain: a small Nemotron decides, private notes stay private,
bigger Nemotrons on Nebius do the heavy work."

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

0. **Build the hover card** (asked for on 28 Oct).
   - **Where:** links and source chips in AI answers (chat and the workspace AI panel).
   - **What it shows on hover:**
     - a note link: the title, where it lives (its parent pages), the first lines, its privacy
       level;
     - a source chip: the source, the page or time, the quoted lines;
     - a web link: the site and the full address.
   - **Design:** it floats beside the link and stays while the pointer is on it. A click still
     opens the note.

1. **Every AI call in the demo account runs on Nemotron.**
   - Today chat does, but one-shot jobs (the PDF study guide, titles, workspace jobs) try Anthropic
     first, because the app puts Claude first for them.
   - Fix: a removable `NEBIUS_ONLY_USERS` setting. Accounts listed there use only Nebius. The real
     account keeps Claude.
   - Then check that Nemotron Super's study guide renders well (callouts, toggles, formulas).
2. **VM: decided no** (28 Oct). Say in the video and the README that private notes run on a local
   model in real use, and that the demo holds them back for lack of compute. Keep all of that code.
3. ~~Badge wording on the VM~~: not needed without the VM.
4. **The demo account's MCP server:** add DeepWiki in Settings → MCP servers, set to *Ask me
   first*. Check that Nemotron calls it.
5. **Run each prompt above once before recording.** Nano's answers vary; change a prompt's wording
   if one comes out weak.
6. **Clean up the test runs:** delete the rehearsal chats; keep the notes.
7. **Recording:** 1080p, dark or light mode (pick one), browser zoom 110%, no other tabs.
   - Upload to YouTube as public or unlisted (the rules say *publicly visible*).

## 6b. Rehearsal, 28 Oct (live site, demo account)

| Scene | Result |
|---|---|
| Workspace | Nano answered with [1][2]; the chip card showed *p. 2* and the passage; a click jumped the PDF to p. 2 |
| Ask your brain | Nano, with note links; the hover card showed the cited passage |
| Hard question | Brain → **Strong · Super** (1.2 s) once the brain had 6 s; at 2.5 s it timed out to Fast |
| Private | **Held back: Health · knee physio plan, Budget and scholarship**; the answer did not know the times |
| Web | Asked first with the exact words; after Confirm, Super searched (8 pages) and saved the note |
| MCP | Asked first ("set to ask before each use"); after Confirm, DeepWiki answered (3,615 chars) |
| Skill | Nano offered **quiz-me** as a card; nothing saved without a click |

Found and fixed while rehearsing: private notes were sent to the cloud embedder (Gemini) to build
the search index, and then could not show as "held back". Both fixed (7f7e048, 8a57644).
Answers take 10–40 s (Nemotron thinks first): cut the waits in the edit.

## 7. Not in the video, but in the Devpost text

- What changed since 26 Aug (the rules require it): the Nemotron switchboard, Token Factory, the
  private-model front door, Tavily web research, per-user skills, About-you memory, and the
  security work from studying NemoClaw / OpenShell / Hermes.
- Embeddings for note search use Gemini. Say so; don't claim "100% Nemotron".
- Honest wording: private notes go only to a local model the user runs; the hosted demo has none,
  so they are held back there. The VM front door is built and documented for anyone with compute.
