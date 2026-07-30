import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {Hero, HeroAsleep} from '../components/Hero';

// Scene 3: top-corner view, time-lapse 0–390 local frames (13 seconds)
// Morning(0-80) → Midday(80-160) → Afternoon(160-240) → Evening(240-310) → Night(310-360) → Asleep(360-390)

function lerpColor(a: string, b: string, t: number): string {
  const ah = a.replace('#',''); const bh = b.replace('#','');
  const ar = parseInt(ah.slice(0,2),16), ag = parseInt(ah.slice(2,4),16), ab = parseInt(ah.slice(4,6),16);
  const br = parseInt(bh.slice(0,2),16), bg = parseInt(bh.slice(2,4),16), bb = parseInt(bh.slice(4,6),16);
  const r = Math.round(ar + (br-ar)*t), g = Math.round(ag + (bg-ag)*t), B = Math.round(ab + (bb-ab)*t);
  return `rgb(${r},${g},${B})`;
}

const windowColors = [
  {at:0,   color:'#E8A94D'}, // morning amber
  {at:80,  color:'#FFFFFF'}, // midday white
  {at:160, color:'#E87A30'}, // afternoon orange
  {at:240, color:'#6B5FAF'}, // evening violet
  {at:310, color:'#1B1B2E'}, // night black
];

function getWindowColor(frame: number): string {
  for (let i = 0; i < windowColors.length - 1; i++) {
    const a = windowColors[i], b = windowColors[i+1];
    if (frame >= a.at && frame <= b.at) {
      const t = (frame - a.at) / (b.at - a.at);
      return lerpColor(a.color, b.color, t);
    }
  }
  return windowColors[windowColors.length-1].color;
}

// Paper stack grows with time
function paperCount(frame: number): number {
  return Math.min(12, Math.floor(frame / 30));
}

export const Scene3Timelapse: React.FC = () => {
  const frame = useCurrentFrame();
  const winColor = getWindowColor(frame);
  const papers = paperCount(frame);
  const asleep = frame >= 340;

  // Wall color shifts slightly with time of day
  const wallOpacity = interpolate(frame, [240, 340], [1, 0.7], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  // Lamp glow — appears at evening
  const lampGlow = interpolate(frame, [240, 280], [0, 1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  // Hero posture degrades
  const posture = interpolate(frame, [0, 320], [0, 0.9], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  // Ambient room darkness
  const roomDark = interpolate(frame, [240, 340], [0, 0.45], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  return (
    <AbsoluteFill style={{backgroundColor:'#D4CFC6'}}>
      <svg width={1920} height={1080} style={{position:'absolute'}}>

        {/* Top-corner view — room seen from above-right */}
        {/* Floor */}
        <rect x={0} y={0} width={1920} height={1080} fill="#CFCAC1" />

        {/* Back walls (perspective from top) */}
        <rect x={0} y={0} width={1920} height={480} fill={`rgba(237,232,223,${wallOpacity})`} />

        {/* Window */}
        <rect x={1300} y={60} width={260} height={380} rx={6} fill={winColor} />
        <rect x={1300} y={60} width={260} height={380} rx={6} fill="none" stroke="#9A8060" strokeWidth={6} />
        <line x1={1430} y1={60} x2={1430} y2={440} stroke="#9A8060" strokeWidth={4} />
        <line x1={1300} y1={248} x2={1560} y2={248} stroke="#9A8060" strokeWidth={4} />

        {/* Desk surface — top-down */}
        <rect x={480} y={380} width={840} height={320} rx={8} fill="#A08060" />
        <rect x={490} y={390} width={820} height={300} rx={6} fill="#8B7355" />

        {/* Laptop */}
        <rect x={780} y={420} width={200} height={140} rx={6} fill="#2D2D2D" />
        <rect x={792} y={432} width={176} height={116} rx={4} fill="#5B6FE0" opacity={0.9} />

        {/* Paper stacks — grow over time */}
        {Array.from({length: papers}).map((_, i) => (
          <rect key={i}
            x={490 + (i % 3) * 80 + Math.sin(i) * 10}
            y={500 - i * 4 + (Math.floor(i/3)) * 60}
            width={110} height={8} rx={2}
            fill={i % 2 === 0 ? '#F4EFE8' : '#EDE8DF'}
            transform={`rotate(${Math.sin(i*1.3) * 6}, ${550 + (i%3)*80}, ${504 - i*4})`}
          />
        ))}

        {/* Desk lamp — appears at evening */}
        {lampGlow > 0.1 && (
          <g opacity={lampGlow}>
            <rect x={1100} y={340} width={10} height={80} rx={4} fill="#8B7355" />
            <ellipse cx={1105} cy={332} rx={40} ry={20} fill="#8B7355" />
            {/* Lamp glow circle */}
            <circle cx={1105} cy={450} r={180} fill="#E8A94D" opacity={0.12 * lampGlow} />
          </g>
        )}

        {/* Night darkness overlay */}
        <rect x={0} y={0} width={1920} height={1080} fill="black" opacity={roomDark} />

        {/* Hero — top-down, seen from behind */}
        {!asleep ? (
          <Hero x={880} y={560} scale={0.9} posture={posture} />
        ) : (
          <HeroAsleep x={880} y={520} scale={0.9} />
        )}

      </svg>
    </AbsoluteFill>
  );
};
