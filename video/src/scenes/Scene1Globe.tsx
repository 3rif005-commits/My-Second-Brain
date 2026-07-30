import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';

const NAVY   = '#1B2040';
const CREAM  = '#F4EFE8';
const INDIGO = '#5B6FE0';
const AMBER  = '#E8A94D';

// Network nodes: [x%, y%] of 1920x1080
const NODES = [
  [28, 22], [52, 18], [68, 25], [80, 32],
  [72, 55], [55, 65], [35, 60], [20, 45],
  [45, 40], [62, 42], [38, 30],
];

// Connections between node indices
const EDGES = [
  [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,0],
  [0,8],[1,8],[2,9],[3,9],[4,9],[5,8],[8,9],[8,10],[10,1],
];

function nodePos(n: number[]): [number, number] {
  return [n[0] / 100 * 1920, n[1] / 100 * 1080];
}

const Pulse: React.FC<{x1:number;y1:number;x2:number;y2:number;delay:number;frame:number}> = ({x1,y1,x2,y2,delay,frame}) => {
  const t = ((frame - delay) % 90) / 90;
  if (t < 0 || t > 1) return null;
  const px = x1 + (x2 - x1) * t;
  const py = y1 + (y2 - y1) * t;
  return <circle cx={px} cy={py} r={5} fill={AMBER} opacity={0.9} />;
};

export const Scene1Globe: React.FC = () => {
  const frame = useCurrentFrame();

  // Zoom: start wide, slowly push toward center-right node (node 8 ≈ 45%,40%)
  const scale = interpolate(frame, [0, 390], [1, 3.2], {extrapolateRight: 'clamp'});
  const tx    = interpolate(frame, [0, 390], [0, -1920 * 0.45 * (3.2 - 1)], {extrapolateRight: 'clamp'});
  const ty    = interpolate(frame, [0, 390], [0, -1080 * 0.38 * (3.2 - 1)], {extrapolateRight: 'clamp'});

  // Lines fade in over first 60 frames
  const lineOpacity = interpolate(frame, [0, 60], [0, 0.5], {extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{backgroundColor: NAVY}}>
      <svg
        width={1920} height={1080}
        style={{
          position: 'absolute',
          transformOrigin: '45% 40%',
          transform: `scale(${scale}) translate(${tx / scale}px, ${ty / scale}px)`,
        }}
      >
        {/* Earth circle */}
        <circle cx={960} cy={480} r={420} fill={NAVY} stroke={INDIGO} strokeWidth={2} opacity={0.6} />

        {/* Simplified continent outlines — flat geometric shapes */}
        <polygon points="660,340 780,310 820,380 760,430 680,400" fill={CREAM} opacity={0.18} />
        <polygon points="900,300 980,280 1020,340 960,390 900,370" fill={CREAM} opacity={0.18} />
        <polygon points="1040,360 1120,340 1150,420 1080,460 1030,430" fill={CREAM} opacity={0.18} />
        <polygon points="820,470 880,450 900,530 840,560 800,520" fill={CREAM} opacity={0.18} />

        {/* Network lines */}
        <g opacity={lineOpacity}>
          {EDGES.map(([a, b], i) => {
            const [x1, y1] = nodePos(NODES[a]);
            const [x2, y2] = nodePos(NODES[b]);
            return (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={CREAM} strokeWidth={1.5} />
            );
          })}
        </g>

        {/* Animated pulses along edges */}
        {EDGES.map(([a, b], i) => {
          const [x1, y1] = nodePos(NODES[a]);
          const [x2, y2] = nodePos(NODES[b]);
          return (
            <Pulse key={i} x1={x1} y1={y1} x2={x2} y2={y2}
              delay={i * 12} frame={frame} />
          );
        })}

        {/* Network nodes */}
        {NODES.map((n, i) => {
          const [x, y] = nodePos(n);
          return <circle key={i} cx={x} cy={y} r={6} fill={CREAM} opacity={0.8} />;
        })}

        {/* Highlight node 8 — where camera is heading */}
        <circle cx={nodePos(NODES[8])[0]} cy={nodePos(NODES[8])[1]}
          r={interpolate(frame, [200, 390], [6, 16], {extrapolateRight:'clamp'})}
          fill={AMBER} />
      </svg>
    </AbsoluteFill>
  );
};
