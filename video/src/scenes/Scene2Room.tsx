import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {Hero} from '../components/Hero';

const CREAM  = '#F4EFE8';
const INDIGO = '#5B6FE0';
const AMBER  = '#E8A94D';
const NAVY   = '#1B2040';

// Scene 2 runs from frame 130 in Video.tsx — locally frame 0 is that point
// Hero walks in 0–40, sits 40–80, camera pulls back 80–260

export const Scene2Room: React.FC = () => {
  const frame = useCurrentFrame(); // local frame (Sequence resets to 0)

  // Hero walk-in: enters from x=-100 to desk position x=820
  const heroX = interpolate(frame, [0, 45], [-120, 820], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // After sitting, hero is stationary
  const heroFinalX = 820;
  const heroVisible = frame < 45 ? heroX : heroFinalX;

  // Camera pull-back — zoom from 1 to 0.72, shift up
  const camScale = interpolate(frame, [80, 240], [1, 0.72], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
  const camTY    = interpolate(frame, [80, 240], [0, -120], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  // Window light — morning amber
  const windowOpacity = 1;

  return (
    <AbsoluteFill style={{backgroundColor: '#E8E2DA'}}>
      <svg width={1920} height={1080}
        style={{
          position: 'absolute',
          transformOrigin: '50% 60%',
          transform: `scale(${camScale}) translateY(${camTY}px)`,
        }}>

        {/* Floor */}
        <rect x={0} y={720} width={1920} height={360} fill="#D4CFC6" />

        {/* Back wall */}
        <rect x={0} y={0} width={1920} height={720} fill="#EDE8DF" />

        {/* Window — right side, morning amber light */}
        <rect x={1350} y={120} width={320} height={480} rx={8} fill={AMBER} opacity={0.85} />
        {/* Window frame */}
        <rect x={1350} y={120} width={320} height={480} rx={8} fill="none" stroke="#C49030" strokeWidth={8} />
        {/* Window cross */}
        <line x1={1510} y1={120} x2={1510} y2={600} stroke="#C49030" strokeWidth={6} />
        <line x1={1350} y1={360} x2={1670} y2={360} stroke="#C49030" strokeWidth={6} />

        {/* Desk */}
        <rect x={560} y={640} width={760} height={28} rx={6} fill="#8B7355" />
        {/* Desk legs */}
        <rect x={580} y={668} width={20} height={80} rx={4} fill="#7A6548" />
        <rect x={1280} y={668} width={20} height={80} rx={4} fill="#7A6548" />

        {/* Laptop on desk */}
        {frame >= 40 && (
          <g>
            <rect x={780} y={590} width={180} height={12} rx={3} fill="#3D3D3D" />
            <rect x={800} y={530} width={140} height={62} rx={4} fill="#2D2D2D" />
            {/* Screen glow */}
            <rect x={806} y={536} width={128} height={50} rx={2} fill={INDIGO} opacity={0.8} />
          </g>
        )}

        {/* Paper stack on desk — appears after hero arrives */}
        {frame >= 40 && (
          <g>
            <rect x={640} y={620} width={100} height={6} rx={2} fill="#F4EFE8" />
            <rect x={642} y={614} width={100} height={6} rx={2} fill="#EDE8DF" />
            <rect x={638} y={608} width={100} height={6} rx={2} fill="#F4EFE8" />
          </g>
        )}

        {/* Chair */}
        <rect x={760} y={700} width={160} height={12} rx={4} fill="#5A4A3A" />
        <rect x={820} y={712} width={40} height={60} rx={4} fill="#5A4A3A" />
        <rect x={760} y={760} width={40} height={12} rx={4} fill="#5A4A3A" />
        <rect x={880} y={760} width={40} height={12} rx={4} fill="#5A4A3A" />

        {/* Hero — walking in then seated */}
        <Hero
          x={heroVisible}
          y={670}
          scale={1.1}
          posture={0}
        />

      </svg>
    </AbsoluteFill>
  );
};
