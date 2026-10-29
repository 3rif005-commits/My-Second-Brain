import React from 'react';
import {
  AbsoluteFill, Easing, Freeze, OffthreadVideo, Sequence, interpolate, spring,
  staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';
import {Cam, FPS, PAGE, SCENES, Scene, cameraAfterCuts, parts} from './scenes';

const BG = '#0d0d0c';
const INK = '#f2f1ee';
const MUTED = '#a3a29d';
const GREEN = '#76b900';
const FONT = '"Ubuntu Sans", Ubuntu, system-ui, sans-serif';

// Layout (1280 × 720)
const BOX = {x: 40, y: 58, w: 1200};
const BOX_H = Math.round((BOX.w * PAGE.h) / PAGE.w);
const FADE = 9; // frames of fade at each scene edge

export const DEMO_FRAMES = SCENES.reduce((n, s) => n + s.seconds * FPS, 0);

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ease = Easing.bezier(0.45, 0, 0.2, 1);

/** Where the camera is at kept-time t: each keyframe is reached over the 0.8 s before it. */
function cameraAt(cam: Cam[], t: number) {
  if (!cam.length) return {s: 1, x: PAGE.w / 2, y: PAGE.h / 2};
  let {s, x, y} = cam[0];
  for (const k of cam.slice(1)) {
    const p = ease(Math.min(Math.max((t - (k.t - 0.8)) / 0.8, 0), 1));
    s += (k.s - s) * p;
    x += (k.x - x) * p;
    y += (k.y - y) * p;
  }
  // keep the view inside the page
  const hw = PAGE.w / 2 / s, hh = PAGE.h / 2 / s;
  x = Math.min(Math.max(x, hw), PAGE.w - hw);
  y = Math.min(Math.max(y, hh), PAGE.h - hh);
  return {s, x, y};
}

const Recording: React.FC<{scene: Scene}> = ({scene}) => {
  const frame = useCurrentFrame();
  const ps = parts(scene);
  const kept = ps.reduce((n, p) => n + p.to - p.from, 0);
  const total = scene.seconds * FPS;
  const rate = Math.max(1, kept / scene.seconds); // never slow motion: hold the end instead
  const src = staticFile(`rec/${scene.rec}.mp4`);

  let acc = 0;
  const seqs = ps.map((p, i) => {
    const start = Math.round((acc * FPS) / rate);
    acc += p.to - p.from;
    const end = Math.round((acc * FPS) / rate);
    return (
      <Sequence key={i} from={start} durationInFrames={Math.max(end - start, 1)} layout="none">
        <OffthreadVideo src={src} muted playbackRate={rate}
          startFrom={Math.round(p.from * FPS)} endAt={Math.round(p.to * FPS) + 1}
          style={{position: 'absolute', left: 0, top: 0, width: PAGE.w, height: PAGE.h}} />
      </Sequence>
    );
  });
  const played = Math.round((kept * FPS) / rate);
  const last = ps[ps.length - 1];
  const hold = total - played;

  const {s, x, y} = cameraAt(cameraAfterCuts(scene), Math.min((frame * rate) / FPS, kept));
  const k = (BOX.w / PAGE.w) * s;
  const x0 = x - PAGE.w / 2 / s, y0 = y - PAGE.h / 2 / s;

  return (
    <div style={{position: 'absolute', left: BOX.x, top: BOX.y, width: BOX.w, height: BOX_H,
      overflow: 'hidden', borderRadius: 12, background: '#191919',
      boxShadow: '0 18px 50px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08)'}}>
      <div style={{position: 'absolute', width: PAGE.w, height: PAGE.h, overflow: 'hidden',
        transformOrigin: '0 0', transform: `scale(${k}) translate(${-x0}px, ${-y0}px)`}}>
        {seqs}
        {hold > 0 && last && (
          <Sequence from={played} durationInFrames={hold} layout="none">
            <Freeze frame={0}>
              <OffthreadVideo src={src} muted startFrom={Math.max(Math.round(last.to * FPS) - 2, 0)}
                style={{position: 'absolute', left: 0, top: 0, width: PAGE.w, height: PAGE.h}} />
            </Freeze>
          </Sequence>
        )}
      </div>
    </div>
  );
};

const TopBar: React.FC<{i: number; scene: Scene}> = ({i, scene}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const inn = spring({frame, fps, config: {damping: 200}});
  const n = SCENES.length - 1;
  return (
    <div style={{position: 'absolute', left: BOX.x, top: 14, right: BOX.x, height: 32,
      display: 'flex', alignItems: 'center', gap: 14, fontFamily: FONT}}>
      {i < n && (
        <div style={{color: GREEN, fontSize: 15, fontWeight: 700, letterSpacing: 1,
          opacity: inn}}>{String(i + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}</div>
      )}
      <div style={{color: INK, fontSize: 21, fontWeight: 600, opacity: inn,
        transform: `translateX(${(1 - inn) * -16}px)`}}>{scene.title}</div>
      <div style={{flex: 1}} />
      <div style={{color: MUTED, fontSize: 13, opacity: inn}}>
        live app · Nemotron on Nebius Token Factory
      </div>
    </div>
  );
};

const Caption: React.FC<{text: string}> = ({text}) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [6, 18], [0, 1], clamp);
  return (
    <div style={{position: 'absolute', left: BOX.x, right: BOX.x, top: BOX.y + BOX_H + 14,
      bottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: FONT, color: INK, fontSize: 19, lineHeight: 1.4, textAlign: 'center',
      opacity: o, transform: `translateY(${(1 - o) * 6}px)`, padding: '0 40px'}}>
      {text}
    </div>
  );
};

const Progress: React.FC<{start: number}> = ({start}) => {
  const frame = useCurrentFrame();
  return (
    <div style={{position: 'absolute', left: 0, top: 0, height: 3, background: GREEN,
      width: `${((start + frame) / DEMO_FRAMES) * 100}%`}} />
  );
};

// ── Close: how it works ──────────────────────────────────────────────────

const Box: React.FC<{at: number; x: number; y: number; w: number; h: number;
  title: string; sub: string; accent?: string}> = ({at, x, y, w, h, title, sub, accent = INK}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = spring({frame: frame - at, fps, config: {damping: 18, mass: 0.7}});
  return (
    <div style={{position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: 14,
      background: '#1a1a18', border: `1.5px solid ${accent}`, opacity: Math.min(p * 1.4, 1),
      transform: `translateY(${(1 - p) * 18}px) scale(${0.94 + 0.06 * p})`,
      display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 18px',
      fontFamily: FONT}}>
      <div style={{color: accent, fontSize: 20, fontWeight: 700}}>{title}</div>
      <div style={{color: MUTED, fontSize: 15, marginTop: 4, lineHeight: 1.35}}>{sub}</div>
    </div>
  );
};

const Arrow: React.FC<{at: number; d: string; color?: string; dashed?: boolean}> = ({at, d, color = MUTED, dashed}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + 14], [0, 1], {...clamp, easing: ease});
  return (
    <path d={d} fill="none" stroke={color} strokeWidth={2.2} pathLength={1}
      strokeDasharray={dashed ? '0.02 0.015' : '1'} strokeDashoffset={dashed ? 0 : 1 - p}
      opacity={dashed ? p : 1} markerEnd={p > 0.95 ? 'url(#head)' : undefined} />
  );
};

const Close: React.FC = () => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [250, 300], [0, 1], clamp);
  return (
    <AbsoluteFill>
      <div style={{position: 'absolute', left: BOX.x, top: BOX.y, width: BOX.w, height: BOX_H}}>
        <svg width={BOX.w} height={BOX_H} style={{position: 'absolute'}}>
          <defs>
            <marker id="head" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={MUTED} />
            </marker>
          </defs>
          <Arrow at={20} d="M 250 270 L 395 270" />
          <Arrow at={45} d="M 690 230 C 760 230, 760 120, 840 120" color={GREEN} />
          <Arrow at={70} d="M 690 310 C 760 310, 760 420, 840 420" />
          <Arrow at={110} d="M 1000 175 L 1000 205" />
        </svg>
        <Box at={0} x={30} y={215} w={220} h={110} title="Your question" sub="+ the notes it needs" />
        <Box at={22} x={400} y={180} w={290} h={180} accent={GREEN}
          title="Small Nemotron" sub="Reads the question and decides where it runs. Small enough for an ordinary computer." />
        <Box at={48} x={845} y={55} w={320} h={120} accent={GREEN}
          title="Nemotron Super · Nano" sub="On Nebius Token Factory, for the heavy work. Private notes held back." />
        <Box at={74} x={845} y={360} w={320} h={120} accent="#e0b04a"
          title="Private notes" sub="Stay with the small model on your own machine." />
        <Box at={112} x={845} y={210} w={320} h={110}
          title="Tavily · MCP tools" sub="Web search and tools you choose. Asks you first." />
      </div>
      <AbsoluteFill style={{background: BG, opacity: t, alignItems: 'center', justifyContent: 'center',
        fontFamily: FONT, color: INK}}>
        <div style={{fontSize: 64, fontWeight: 700, transform: `scale(${0.96 + 0.04 * t})`}}>Second Brain</div>
        <div style={{fontSize: 24, color: MUTED, marginTop: 12}}>
          your knowledge, your rules · <span style={{color: GREEN}}>Nemotron on Nebius</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── The whole video ──────────────────────────────────────────────────────

const SceneView: React.FC<{i: number; scene: Scene; start: number}> = ({i, scene, start}) => {
  const frame = useCurrentFrame();
  const total = scene.seconds * FPS;
  const o = interpolate(frame, [0, FADE, total - FADE, total], [0, 1, 1, i === SCENES.length - 1 ? 1 : 0], clamp);
  return (
    <AbsoluteFill style={{background: BG}}>
      <AbsoluteFill style={{opacity: o}}>
        {scene.rec ? <Recording scene={scene} /> : <Close />}
        <TopBar i={i} scene={scene} />
        <Caption text={scene.say} />
      </AbsoluteFill>
      <Progress start={start} />
    </AbsoluteFill>
  );
};

export const Demo: React.FC = () => {
  let start = 0;
  return (
    <AbsoluteFill style={{background: BG}}>
      {SCENES.map((scene, i) => {
        const from = start;
        start += scene.seconds * FPS;
        return (
          <Sequence key={i} from={from} durationInFrames={scene.seconds * FPS} name={scene.title}>
            <SceneView i={i} scene={scene} start={from} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
