import React from 'react';
import {Composition} from 'remotion';
import {MainVideo} from './Video';
import {DEMO_FRAMES, Demo} from './demo/Demo';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SecondBrainIntro"
        component={MainVideo}
        durationInFrames={1200}
        fps={30}
        width={1920}
        height={1080}
      />
      {/* The hackathon demo: real recordings of the live app (video/out/rec). */}
      <Composition
        id="Demo"
        component={Demo}
        durationInFrames={DEMO_FRAMES}
        fps={30}
        width={1280}
        height={720}
      />
    </>
  );
};
