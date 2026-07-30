import React from 'react';

// Professional corporate Memphis human figure — simplified, no cartoon features
// posture: 0 = upright, 1 = fully slumped
export const Hero: React.FC<{
  x: number; y: number; scale?: number; posture?: number; facingLeft?: boolean;
}> = ({x, y, scale = 1, posture = 0, facingLeft = false}) => {
  const slump = posture * 18; // degrees of forward lean
  const shoulderDrop = posture * 20;

  return (
    <g transform={`translate(${x}, ${y}) scale(${facingLeft ? -scale : scale}, ${scale})`}>
      {/* Body — dark indigo shirt, professional */}
      <rect x={-28} y={-60 + shoulderDrop * 0.3} width={56} height={70}
        rx={10} fill="#2D3A6B"
        transform={`rotate(${slump}, 0, -60)`} />

      {/* Neck */}
      <rect x={-8} y={-80} width={16} height={24} rx={4} fill="#C8A882" />

      {/* Head — circle, warm skin tone */}
      <circle cx={0} cy={-100} r={32} fill="#C8A882" />

      {/* Hair — flat dark shape on top */}
      <ellipse cx={0} cy={-122} rx={26} ry={14} fill="#2D2D2D" />

      {/* Left arm */}
      <rect x={-46} y={-55 + shoulderDrop * 0.5} width={18} height={50}
        rx={7} fill="#2D3A6B"
        transform={`rotate(${slump * 0.5}, -28, -55)`} />

      {/* Right arm */}
      <rect x={28} y={-55 + shoulderDrop * 0.5} width={18} height={50}
        rx={7} fill="#2D3A6B"
        transform={`rotate(${-slump * 0.3}, 46, -55)`} />
    </g>
  );
};

// Hero in "head in hands" pose
export const HeroFrustrated: React.FC<{x: number; y: number; scale?: number}> = ({x, y, scale = 1}) => {
  return (
    <g transform={`translate(${x}, ${y}) scale(${scale})`}>
      {/* Body — slumped back */}
      <rect x={-28} y={-50} width={56} height={70} rx={10} fill="#2D3A6B"
        transform="rotate(8, 0, -50)" />
      {/* Neck */}
      <rect x={-8} y={-72} width={16} height={24} rx={4} fill="#C8A882" />
      {/* Head — tilted down */}
      <circle cx={0} cy={-95} r={32} fill="#C8A882" transform="rotate(15, 0, -72)" />
      <ellipse cx={0} cy={-116} rx={26} ry={14} fill="#2D2D2D" transform="rotate(15, 0, -72)" />
      {/* Arms — up at temples */}
      <rect x={-58} y={-90} width={52} height={16} rx={7} fill="#2D3A6B" transform="rotate(-25, -32, -82)" />
      <rect x={6}   y={-90} width={52} height={16} rx={7} fill="#2D3A6B" transform="rotate(25, 32, -82)" />
    </g>
  );
};

// Hero sleeping — head on desk
export const HeroAsleep: React.FC<{x: number; y: number; scale?: number}> = ({x, y, scale = 1}) => {
  return (
    <g transform={`translate(${x}, ${y}) scale(${scale})`}>
      {/* Body */}
      <rect x={-28} y={-40} width={56} height={70} rx={10} fill="#2D3A6B"
        transform="rotate(35, 0, 0)" />
      {/* Head resting on desk (x+offset, flat) */}
      <circle cx={30} cy={-58} r={28} fill="#C8A882" />
      <ellipse cx={30} cy={-80} rx={22} ry={12} fill="#2D2D2D" />
      {/* Arms stretched on desk */}
      <rect x={-20} y={-65} width={60} height={14} rx={6} fill="#2D3A6B" />
    </g>
  );
};
