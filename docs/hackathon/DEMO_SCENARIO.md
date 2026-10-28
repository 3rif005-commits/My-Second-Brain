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

## 4. The script (target 2:55)

Narration is short on purpose: read it slowly. **Bold** = what to click or type.

**Why these scenes (chosen against the criteria):**
- Each Personal AI track word appears on screen: private, memory, skills, tools you choose,
  tasks across daily work.
- **Workspace and the hover card** are the *Design* score: a finished product you can see, not a
  terminal.
- **MCP and Tavily** are the "tools you choose". Both ask before anything leaves.
- **The AI-drafted skill** is the self-improving loop the track names (Hermes Agent's idea), done
  safely: nothing is saved until you click.
- **Left out:**
  - The interactive block (an AI-made simulation) is impressive, but its quality on Nano is
    unproven. It can go in the closing montage if a rehearsal comes out well.
  - Notion databases: no time.

### 0:00–0:12 · The problem
- **Screen:** the demo account's home, sidebar full of notes (courses, project, health, money).
- **Say:** "Everything I know lives in my Second Brain: what I read, watch, plan, and study. AI
  could help me use it, but then I hand it everything. Today I'll show it with my studies."

### 0:12–0:40 · Workspace: a lecture becomes a study guide, with sources (Nemotron Super)
- **Do:** open the **Lecture 8** workspace and drop `Lecture 8 - Attention and Transformers.pdf`
  as a source.
  - The study guide is already made: **cut** the wait, or run the *Study guide* job off camera.
- **Do:** in the AI panel, type **"Explain self-attention simply."**
- **Show:**
  1. the answer with source chips **[1] [2]**;
  2. **hover a chip:** the floating card shows *Lecture 8 PDF · page 3* and the quoted lines;
  3. **click it:** the PDF jumps to page 3.
- **Say:** "My lecture sits beside my note. Nemotron answers from it, and every claim shows where
  it came from. One click takes me to the exact page."

### 0:40–1:00 · Ask your whole brain (Nemotron Nano, chosen by Nemotron)
- **Type:** **"What should I review before Friday's midterm?"**
- **Show:**
  1. the 🔍 *search brain* chip;
  2. the answer, linking *Midterm plan* and *Lecture 6*;
  3. **hover a link:** the card shows where the note lives (*ML 301 › Lecture 6*), its first
     lines, and its privacy level;
  4. the badge **Fast · Nemotron 3 Nano**.
- **Say:** "It searches all my notes and links to them. A small Nemotron read my question and chose
  the fast model."

### 1:00–1:15 · A hard question goes to the big model
- **Type:** **"Derive the backprop update for a 2-layer network, then quiz me with 3 questions. Answer here in the chat."**
  (Without the last sentence it once wrote the derivation into a new note.)
- **Show:** the badge **Strong · Nemotron 3 Super**. Click it: *Decided by the brain · Why: deep
  reasoning*.
- **Say:** "Hard question, so it goes to Nemotron Super. Every answer tells me which model ran, and
  why."

### 1:15–1:40 · Private stays private (the key scene)
- **Type:** **"Plan my study week around my physio appointments. Answer in chat."**
- **Decided (28 Oct): no VM in the demo.** The app keeps its full structure: the local slot, the
  privacy gate and the Nebius VM front door all stay in the code (docs/hackathon/NEBIUS.md); only
  the demo runs without a local model.
- **Show:** the badge **Fast · Nemotron 3 Nano · 1 private held back**. Click it: *Held back
  (private): Health · knee physio plan*.
- **Say:** "My health note is private. Second Brain uses two kinds of model: a small Nemotron
  that can run on an ordinary computer, and bigger Nemotrons it calls over the API for heavy work.
  Private notes only ever go to the small one on my own machine. In this demo the small model runs
  in the cloud, so the app does the safe thing: it holds the note back. The cloud never saw it."

### 1:40–2:02 · Web research (Tavily)
- **Type:** **"Use web search to find 3 recent papers on CNNs for crop disease detection. List them
  with links, then save them as a note titled 'Capstone reading list'."**
  (The vaguer wording made Nano skip the search on the replay after Confirm. This one went to
  Super, searched 8 pages and saved three real 2025 papers.)
- **Show, in order:**
  1. the prompt *Search the web for "…"? Only these words are sent to Tavily.*;
  2. **Confirm**;
  3. 🌐 *5 web pages*;
  4. the answer with links (hover one: the card shows the website);
  5. ✨ *create note*.
- **Say:** "When my notes aren't enough, it searches the web with Tavily. I approve the exact words
  that leave. Then it saves a reading list as a note."

### 2:02–2:17 · Tools I choose (MCP)
- **Type:** **"Use the DeepWiki tool to ask how PyTorch's autograd computes gradients (repo
  pytorch/pytorch). Answer in 3 sentences."**
- **Show:** the 🔌 *deepwiki · ask question* chip with **Confirm** (the server is set to *Ask me
  first*), then the answer.
- **Say:** "It connects to any MCP tool I choose, and asks me first. My brain is an MCP server
  too, so other AI apps can search it."
  - The last sentence only if the app's own MCP server is checked working before recording.

### 2:17–2:30 · It learns a skill (and asks before keeping it)
- **Type:** **"Turn this way of studying into a reusable skill: explain a concept in plain words,
  then quiz me with 3 questions from easy to hard, then wait for my answers and mark them. Propose
  it as a skill called quiz-me."**
- **Show:** the skill card (name, description, steps) → **Save**. It now appears in
  **Settings → Skills** with the label *AI-drafted*.
- **Say:** "It can turn what worked into a reusable skill. Nothing is kept until I say so."

### 2:30–2:42 · I stay in control
Quick cuts, about 4 s each:
1. **Settings → Routing:** the rules (*private → my own model*, *big context → Strong*) and the
   Nemotron brain;
2. **Settings → About you:** what it remembers about me;
3. **Activity:** every AI call, which model, what it cost.
- **Say:** "Rules, memory, and a log of every call. All mine to change."

### 2:42–2:55 · Close
- **Screen:** the architecture diagram from the README.
- **Say:** "Today it was my studies. It works the same for all your knowledge. Second Brain: three
  Nemotrons on Nebius. One decides, one answers fast, one thinks hard. Your private notes only
  ever reach your own model."

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
