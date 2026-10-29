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

export const SCENES: Scene[] = [
  {
    title: 'The problem', seconds: 9, rec: 's01_board',
    say: 'Everything I know lives in my Second Brain: what I read, watch, plan, and study. AI could help me use it, but then I hand it everything. Today I’ll show it with my studies.',
    camera: [FULL(0), {t: 6, s: 1.08, x: 640, y: 290}],
  },
  {
    title: 'A lecture with its sources', seconds: 20, rec: 's02_workspace',
    say: 'My lecture sits beside my note. Nemotron answers from it, and every claim shows where it came from. One click takes me to the exact page.',
    camera: [FULL(0), FULL(3), PANEL(4), {t: 10, s: 1.3, x: 880, y: 290}, {t: 14.5, s: 1.3, x: 880, y: 290}, PANEL(15.4, 380)],
  },
  {
    title: 'Ask your whole brain', seconds: 19, rec: 's03_brain',
    say: 'It searches all my notes and links to them. Hover a link and I see the note it came from. A small Nemotron read my question and picked the model.',
    camera: [FULL(0), FULL(2.6), PANEL(3.6), PANEL(13.6), PANEL(14.3, 400), PANEL(16.3, 400), PANEL(17, 420, 1.9)],
  },
  {
    title: 'Hard question → the big model', seconds: 14, rec: 's04_hard',
    say: 'Hard question, so it goes to Nemotron Super. Every answer tells me which model ran, and why.',
    camera: [FULL(0), FULL(1.4), PANEL(2.4), PANEL(14.2), PANEL(15.2, 420, 1.9)],
  },
  {
    title: 'Private stays private', seconds: 22, rec: 's05_private',
    say: 'My health note is private. Second Brain uses two kinds of model: a small Nemotron that can run on an ordinary computer, and bigger Nemotrons over the API. Private notes only go to the small one on my own machine. In this demo it runs in the cloud, so the note is held back.',
    camera: [FULL(0), FULL(4.6), {t: 5.6, s: 1.6, x: 560, y: 320}, {t: 8.4, s: 1.6, x: 560, y: 320}, FULL(9.2), PANEL(10.4), PANEL(14.8), PANEL(15.8, 420, 2)],
  },
  {
    title: 'Web research with Tavily', seconds: 22, rec: 's06_tavily',
    say: 'When my notes aren’t enough, it searches the web with Tavily. I approve the exact words that leave. Then it saves a reading list as a note.',
    camera: [FULL(0), FULL(1.8), PANEL(2.8, 260), PANEL(25.8, 260), FULL(26.8)],
  },
  {
    title: 'Tools I choose (MCP)', seconds: 17, rec: 's07_mcp',
    say: 'It connects to any MCP tool I choose, and asks me first.',
    camera: [FULL(0), FULL(1.8), PANEL(2.8, 260)],
    cut: [[17, 27]], // the DeepWiki call spinning
  },
  {
    title: 'It learns a skill', seconds: 13, rec: 's08_skill',
    say: 'It can turn what worked into a reusable skill. Nothing is kept until I say so.',
    camera: [FULL(0), FULL(1.8), PANEL(2.8, 220), PANEL(9.6, 220), FULL(10.4), FULL(14.4), {t: 15.4, s: 1.4, x: 520, y: 400}],
  },
  {
    title: 'I stay in control', seconds: 12, rec: 's09_control',
    say: 'Rules, memory, and a log of every call. All mine to change.',
    camera: [FULL(0), FULL(13), {t: 14, s: 1.35, x: 620, y: 380}],
  },
  {
    title: 'Second Brain', seconds: 13,
    say: 'Today it was my studies. It works the same for all your knowledge. Second Brain: a small Nemotron that decides and keeps private notes private, and bigger Nemotrons on Nebius for the heavy work.',
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
