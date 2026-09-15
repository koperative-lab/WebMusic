import React from 'react';
import type {Score} from '../core';
import type {PlayerOptions} from '../play/headless';
import {ScoreProvider} from './context';
import {AnalysisSummary, type AnalysisSummaryProps} from './analysis';
import {
  PianoRollView,
  PlayerControls,
  StaffView,
  WaterfallView,
  type StaffViewProps,
  type ViewProps,
} from './views';

export interface SimpleScorePlayerProps {
  score: Score;
  playerOptions?: PlayerOptions;
  className?: string;
  controlsClassName?: string;
}

export function SimpleScorePlayer({
  score,
  playerOptions,
  className,
  controlsClassName,
}: SimpleScorePlayerProps) {
  return (
    <ScoreProvider score={score} playerOptions={playerOptions}>
      <div className={className}>
        <PlayerControls className={controlsClassName} />
      </div>
    </ScoreProvider>
  );
}

export interface SimplePianoRollProps extends ViewProps {
  score: Score;
  playerOptions?: PlayerOptions;
}

export function SimplePianoRoll({score, playerOptions, ...viewProps}: SimplePianoRollProps) {
  return (
    <ScoreProvider score={score} playerOptions={playerOptions}>
      <PianoRollView {...viewProps} />
    </ScoreProvider>
  );
}

export interface SimpleStaffProps extends StaffViewProps {
  score: Score;
  playerOptions?: PlayerOptions;
}

export function SimpleStaff({score, playerOptions, ...viewProps}: SimpleStaffProps) {
  return (
    <ScoreProvider score={score} playerOptions={playerOptions}>
      <StaffView {...viewProps} />
    </ScoreProvider>
  );
}

export interface SimpleWaterfallProps extends ViewProps {
  score: Score;
  playerOptions?: PlayerOptions;
}

export function SimpleWaterfall({score, playerOptions, ...viewProps}: SimpleWaterfallProps) {
  return (
    <ScoreProvider score={score} playerOptions={playerOptions}>
      <WaterfallView {...viewProps} />
    </ScoreProvider>
  );
}

export interface SimpleScoreWorkspaceProps {
  score: Score;
  playerOptions?: PlayerOptions;
  className?: string;
  controlsClassName?: string;
  pianoRoll?: ViewProps | false;
  staff?: StaffViewProps | false;
  waterfall?: ViewProps | false;
  analysis?: Omit<AnalysisSummaryProps, 'score'> | boolean;
}

export function SimpleScoreWorkspace({
  score,
  playerOptions,
  className,
  controlsClassName,
  pianoRoll = {},
  staff = {},
  waterfall = false,
  analysis = false,
}: SimpleScoreWorkspaceProps) {
  const analysisProps = analysis === true ? {} : analysis === false ? undefined : analysis;

  return (
    <ScoreProvider score={score} playerOptions={playerOptions}>
      <section className={className}>
        <PlayerControls className={controlsClassName} />
        {analysisProps ? <AnalysisSummary {...analysisProps} /> : null}
        {pianoRoll !== false ? <PianoRollView {...pianoRoll} /> : null}
        {staff !== false ? <StaffView {...staff} /> : null}
        {waterfall !== false ? <WaterfallView {...waterfall} /> : null}
      </section>
    </ScoreProvider>
  );
}
