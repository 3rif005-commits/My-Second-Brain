import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';

// 120 frames = 4 seconds: screen fills entire frame then white flash
export const SceneTransition: React.FC = () => {
  const frame = useCurrentFrame();

  // Screen expands to fill canvas
  const scale = interpolate(frame, [0, 90], [1, 18], {extrapolateRight:'clamp'});

  // White flash at end
  const whiteOpacity = interpolate(frame, [90, 120], [0, 1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  return (
    <AbsoluteFill style={{backgroundColor:'#EDE8DF'}}>
      <svg width={1920} height={1080} style={{position:'absolute'}}>

        {/* The laptop screen — expands to fill canvas */}
        <rect
          x={912} y={580} width={196} height={74} rx={4}
          fill="#5B6FE0"
          style={{
            transformOrigin: '1010px 617px',
            transform: `scale(${scale})`,
          }}
        />

        {/* White flash overlay */}
        <rect x={0} y={0} width={1920} height={1080}
          fill="white" opacity={whiteOpacity} />

      </svg>
    </AbsoluteFill>
  );
};
