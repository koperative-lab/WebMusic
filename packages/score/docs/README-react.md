# @webscore/react

> **Historical package notes. Classification recorded 2026-09-05.**
> The original body is retained as technical and migration evidence, including
> old package names, API shapes, installation commands and links. It is not a
> current installation guide, runnable reference or work queue. The notes do
> not share a single verified implementation date; do not treat this archive
> classification date as the date every original claim was true.
> Current references: [Current react API reference](../../../apps/doc/webmusic/src/content/docs/score/api/react.mdx).
> See the [archive index](README.md) for scope, the
> [contribution guide](../../../CONTRIBUTING.md) for setup and validation, and
> [Score architecture](../ARCHITECTURE.md) for current package boundaries.

<!-- docs:historical-body -->

---

The **React binding** package for WebScore. It wraps the score model
([`@webscore/core`](../core)), playback ([`@webscore/play`](../play)), views
([`@webscore/view`](../view)), and analysis ([`@webscore/analyze`](../analyze))
behind two levels of React API:

- **Ready-made presets** for direct JSX use — `<SimpleScorePlayer />`,
  `<SimpleStaff />`, `<SimplePianoRoll />`, `<SimpleWaterfall />`, and the
  all-in-one `<SimpleScoreWorkspace />`.
- **Provider + hooks + views** for custom application design —
  `ScoreProvider`, `useScore` / `usePlayer` / `useCursor` /
  `useScoreAnalysis`, and the `PlayerControls` / `StaffView` /
  `PianoRollView` / `WaterfallView` components.

It expects your app to provide a `Score` object (parse one with
`@webscore/io`'s `loadScore`); it does not import files or own an app shell.

```bash
npm install @webscore/react react   # the @webscore/* deps come along
```

> **Note:** not yet published to npm — clone the monorepo and use the workspace
> packages locally until then.

`react >= 18` is a peer dependency.

## Presets

```tsx
import {SimpleScoreWorkspace} from '@webscore/react';

export function Page({score}) {
  return (
    <SimpleScoreWorkspace
      score={score}
      analysis
      pianoRoll={{width: 720, height: 240}}
      staff={{width: 720, height: 220}}
      waterfall={{width: 720, height: 320}}
    />
  );
}
```

Pass `analysis={false}` / `staff={false}` / `waterfall={false}` to disable
parts, or use a single preset (`<SimpleScorePlayer score={score} />`) when you
only need one piece.

## Provider + hooks

```tsx
import {ScoreProvider, useCursor, usePlayer, useScore, PlayerControls, PianoRollView} from '@webscore/react';

function App({score}) {
  return (
    <ScoreProvider score={score} playerOptions={{tempo: 96}}>
      <PlayerControls />
      <PianoRollView width={720} height={240} />
      <CursorReadout />
    </ScoreProvider>
  );
}

function CursorReadout() {
  const score = useScore();
  const player = usePlayer();
  const cursor = useCursor();
  return <span>m.{cursor?.measure} b.{cursor?.beat}</span>;
}
```

`useScoreAnalysis({windowQuarters: 4})` exposes `@webscore/analyze` results as
React state, and `<AnalysisSummary />` renders them.

For large scores, `useScoreAnalysisAsync()` returns
`{result, pending, error}` and performs the work through the analysis Worker
client. A changed ready-made Worker instance replaces the client. Factory
function identity is intentionally ignored so inline factories remain stable;
when a factory's target or configuration changes, pass a different stable
`workerKey` to replace the client explicitly.

## Documentation

Full API docs live in the monorepo's documentation site
([`apps/doc/webmusic-score`](../../../apps/doc/webmusic-score), `npm run docs:dev:score`) — see the **React
integration** page.

## License

MIT
