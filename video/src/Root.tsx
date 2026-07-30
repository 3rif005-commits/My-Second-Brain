import React from 'react';
import {Composition} from 'remotion';
import {MainVideo} from './Video';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="SecondBrainIntro"
      component={MainVideo}
      durationInFrames={1200}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
