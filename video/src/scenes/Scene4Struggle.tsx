import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {Hero, HeroFrustrated} from '../components/Hero';

// Scene 4: eye-level view, 0–390 local frames (13 seconds)
// 0-60:  New morning — hero wakes, sits up straight (fresh energy)
// 60-180: Searches papers — picks up, puts down, gets frustrated
// 180-300: Holds head — frustrated pose, stillness
// 300-390: Eyes drift to screen — camera pushes in

export const Scene4Struggle: React.FC = () => {
  const frame = useCurrentFrame();

  // Morning — window brightens
  const windowBright = interpolate(frame, [0, 40], [0.1, 1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  // Paper in hand — bobs up and down as hero searches
  const searchPhase = frame >= 60 && frame < 180;
  const paperY = searchPhase
    ? interpolate((frame - 60) % 60, [0, 20, 40, 60], [0, -40, -20, 0])
    : 0;
  const paperX = searchPhase
    ? interpolate((frame - 60) % 60, [0, 30, 60], [0, 30, 0])
    : 0;

  // Frustrated — hero switches to head-in-hands pose
  const frustrated = frame >= 180;

  // Camera push into screen — last 90 frames
  const camScale = interpolate(frame, [300, 390], [1, 1.8], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
  const camTX    = interpolate(frame, [300, 390], [0, 320], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
  const camTY    = interpolate(frame, [300, 390], [0, -180], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  // Papers on floor — scattered
  const floorPapers = [
    {x:640, y:820, rot:-12}, {x:720, y:830, rot:8},
    {x:580, y:840, rot:5},   {x:800, y:810, rot:-6},
    {x:1100, y:825, rot:15}, {x:1150, y:840, rot:-9},
  ];

  return (
    <AbsoluteFill style={{backgroundColor:'#E8E2DA'}}>
      <svg width={1920} height={1080}
        style={{
          position:'absolute',
          transformOrigin:'70% 45%',
          transform:`scale(${camScale}) translate(${camTX}px, ${camTY}px)`,
        }}>

        {/* Floor */}
        <rect x={0} y={780} width={1920} height={300} fill="#D4CFC6" />
        {/* Wall */}
        <rect x={0} y={0} width={1920} height={780} fill="#EDE8DF" />

        {/* Window — morning brightening */}
        <rect x={1350} y={80} width={280} height={420} rx={6}
          fill="#E8A94D" opacity={windowBright} />
        <rect x={1350} y={80} width={280} height={420} rx={6}
          fill="none" stroke="#C49030" strokeWidth={6} />
        <line x1={1490} y1={80}  x2={1490} y2={500} stroke="#C49030" strokeWidth={5} />
        <line x1={1350} y1={290} x2={1630} y2={290} stroke="#C49030" strokeWidth={5} />

        {/* Desk */}
        <rect x={480} y={660} width={1000} height={28} rx={6} fill="#8B7355" />

        {/* Paper stacks on desk */}
        {[0,1,2,3,4,5].map(i => (
          <rect key={i}
            x={520 + i*80} y={638 - i*3} width={90} height={8} rx={2}
            fill={i%2===0 ? '#F4EFE8' : '#EDE8DF'}
            transform={`rotate(${Math.sin(i*0.9)*8}, ${560+i*80}, 642)`}
          />
        ))}

        {/* Paper being held — search motion */}
        {searchPhase && (
          <rect
            x={820 + paperX} y={580 + paperY} width={110} height={8} rx={2}
            fill="#F4EFE8"
            transform={`rotate(${-20 + paperX * 0.5}, ${875 + paperX}, ${584 + paperY})`}
          />
        )}

        {/* Papers on floor */}
        {floorPapers.map((p, i) => (
          <rect key={i} x={p.x} y={p.y} width={100} height={7} rx={2}
            fill="#F4EFE8" opacity={0.9}
            transform={`rotate(${p.rot}, ${p.x+50}, ${p.y})`} />
        ))}

        {/* Laptop screen */}
        <rect x={900} y={570} width={220} height={95} rx={6} fill="#2D2D2D" />
        <rect x={912} y={580} width={196} height={74} rx={3} fill="#5B6FE0" opacity={0.85} />
        {/* Screen glow — brighter when camera pushes in */}
        {frame >= 300 && (
          <rect x={912} y={580} width={196} height={74} rx={3}
            fill="#E8A94D"
            opacity={interpolate(frame, [300,390],[0, 0.4], {extrapolateRight:'clamp'})} />
        )}

        {/* Chair */}
        <rect x={820} y={720} width={200} height={14} rx={4} fill="#5A4A3A" />

        {/* Hero — upright or frustrated */}
        {!frustrated ? (
          <Hero x={920} y={700} scale={1.15} posture={0} />
        ) : (
          <HeroFrustrated x={920} y={700} scale={1.15} />
        )}

      </svg>
    </AbsoluteFill>
  );
};
