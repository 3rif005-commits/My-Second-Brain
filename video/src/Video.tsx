import React from 'react';
import {AbsoluteFill, Sequence, interpolate, useCurrentFrame} from 'remotion';
import {Scene1Globe} from './scenes/Scene1Globe';
import {Scene2Room} from './scenes/Scene2Room';
import {Scene3Timelapse} from './scenes/Scene3Timelapse';
import {Scene4Struggle} from './scenes/Scene4Struggle';
import {SceneTransition} from './scenes/SceneTransition';

// Total: 1200 frames = 40 seconds at 30fps
// Scene 1:  0  – 150  (0:00–0:05) globe
// Scene 2:  130– 390  (0:04–0:13) room + hero  (20-frame crossfade with scene 1)
// Scene 3:  360– 750  (0:12–0:25) time-lapse   (30-frame crossfade with scene 2)
// Scene 4:  720–1110  (0:24–0:37) struggle      (30-frame crossfade with scene 3)
// Transition:1080–1200 (0:36–0:40) push to screen

export const MainVideo: React.FC = () => {
  const frame = useCurrentFrame();

  const scene2Opacity = interpolate(frame, [130, 150], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const scene3Opacity = interpolate(frame, [360, 390], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const scene4Opacity = interpolate(frame, [720, 750], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const transOpacity  = interpolate(frame, [1080, 1110], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill>
      {/* Scene 1 — globe */}
      <Sequence from={0} durationInFrames={390}>
        <Scene1Globe />
      </Sequence>

      {/* Scene 2 — room, crossfades in */}
      {frame >= 130 && (
        <AbsoluteFill style={{opacity: scene2Opacity}}>
          <Sequence from={130} durationInFrames={750}>
            <Scene2Room />
          </Sequence>
        </AbsoluteFill>
      )}

      {/* Scene 3 — time-lapse, crossfades in */}
      {frame >= 360 && (
        <AbsoluteFill style={{opacity: scene3Opacity}}>
          <Sequence from={360} durationInFrames={750}>
            <Scene3Timelapse />
          </Sequence>
        </AbsoluteFill>
      )}

      {/* Scene 4 — struggle, crossfades in */}
      {frame >= 720 && (
        <AbsoluteFill style={{opacity: scene4Opacity}}>
          <Sequence from={720} durationInFrames={480}>
            <Scene4Struggle />
          </Sequence>
        </AbsoluteFill>
      )}

      {/* Transition — push to screen */}
      {frame >= 1080 && (
        <AbsoluteFill style={{opacity: transOpacity}}>
          <Sequence from={1080} durationInFrames={120}>
            <SceneTransition />
          </Sequence>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
