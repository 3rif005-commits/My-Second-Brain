// The demo's scenes: which recording, how long, what is said, where the camera looks.
// Times in `camera` and `cut` are seconds of the *kept* recording (waits already
// removed by video/draft/remotion_segments.py). Camera x/y are page pixels
// (the page is PAGE_W × PAGE_H), s is the zoom.
import segments from './segments.json';

export const FPS = 30;
// The browser page inside the 1366×768 screen recording, inset past the glow
// GNOME paints at the window edge. render_demo.sh crops the recordings to it
// (out/rec30, served as public/rec).
export const PAGE = {x: 78, y: 183, w: 1276, h: 572};

export type Cam = {t: number; s: number; x: number; y: number};
export type Scene = {
  title: string;
  seconds: number;
  say: string;
  rec?: keyof typeof segments;
  camera?: Cam[];
  cut?: [number, number][]; // stretches of the kept recording to drop
};

const FULL = (t: number): Cam => ({t, s: 1, x: PAGE.w / 2, y: PAGE.h / 2});
const PANEL = (t: number, y = 280, s = 1.75): Cam => ({t, s, x: 1100, y});

// Script v2 (docs/hackathon/DEMO_SCENARIO.md): one study session, from blocks
// to the database. v1 (routing, privacy, MCP, skills) is in git history.
export const SCENES: Scene[] = [
  {
    title: 'Second Brain', seconds: 4,
    say: 'Second Brain: AI for everything you know, built on NVIDIA Nemotron on Nebius.',
  },
  {
    title: 'A note is blocks', seconds: 22, rec: 'v2_s01_blocks',
    say: 'A note is made of blocks. Type slash and pick one: headings, to-dos, callouts, toggles, formulas, tables, code.',
  },
  {
    title: 'The workspace, with a lecture', seconds: 14, rec: 'v2_s02_workspace',
    say: 'Backprop is my weak spot. I open the note in the workspace and add a 3Blue1Brown lecture.',
  },
  {
    title: 'Nemotron writes the study guide', seconds: 12, rec: 'v2_s03_guide',
    say: 'Nemotron on Nebius reads the transcript and writes a study guide into my note.',
    camera: [{t: 0, s: 1.45, x: 1020, y: 200}],
  },
  {
    title: 'Study with the video', seconds: 28, rec: 'v2_s04_capture',
    say: 'The transcript follows the video. I jump to a moment, then grab a frame and a clip straight into my note.',
  },
  {
    title: 'Nemotron builds something to play with', seconds: 16, rec: 'v2_s05_build',
    say: 'Nemotron Super writes a small app from my request, and it runs inside the note: drag the weight, watch the loss.',
  },
  {
    title: 'The web, with my OK (Tavily)', seconds: 20, rec: 's06_tavily',
    say: 'When the lecture is not enough, it searches the web with Tavily. I approve the exact words that leave.',
    camera: [FULL(0), FULL(1.8), PANEL(2.8, 260), PANEL(25.8, 260), FULL(26.8)],
  },
  {
    title: 'Filed in my database', seconds: 14, rec: 'v2_s06_database',
    say: 'Every lecture lives in my course database: a row with its module and type, and a full note when I open it.',
  },
  {
    title: 'Second Brain ', seconds: 12,
    say: 'Second Brain: a small Nemotron decides and keeps private notes private, and bigger Nemotrons on Nebius do the heavy work.',
  },
];

export type Part = {from: number; to: number}; // seconds in the source recording

/** The scene's source parts, with its `cut` stretches (kept-time) removed. */
export function parts(scene: Scene): Part[] {
  if (!scene.rec) return [];
  let out: Part[] = segments[scene.rec].map(([from, to]) => ({from, to}));
  for (const [a, b] of scene.cut ?? []) {
    const next: Part[] = [];
    let kept = 0;
    for (const p of out) {
      const len = p.to - p.from;
      const s = Math.max(a - kept, 0), e = Math.min(b - kept, len); // cut within this part
      if (e <= 0 || s >= len) next.push(p);
      else {
        if (s > 0) next.push({from: p.from, to: p.from + s});
        if (e < len) next.push({from: p.from + e, to: p.to});
      }
      kept += len;
    }
    out = next;
  }
  return out;
}

/** Shift camera times after a cut so they still point at the same moment. */
export function cameraAfterCuts(scene: Scene): Cam[] {
  const cam = scene.camera ?? [];
  return cam.map((c) => {
    let t = c.t;
    for (const [a, b] of scene.cut ?? []) if (c.t >= b) t -= b - a;
    return {...c, t};
  });
}
