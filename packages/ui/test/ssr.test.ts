// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  envelopeStyle,
  lfoStyle,
  minimapStyle,
  mountCanvasStage,
  mountEnvelope,
  mountLfo,
  mountMinimap,
  mountParameterRack,
  mountSectionPanel,
  mountPlaylist,
  mountTimeline,
  mountTransport,
  mountStatus,
  parameterRackStyle,
  sectionPanelStyle,
  playlistStyle,
  timelineStyle,
  statusStyle,
  mountTrackList,
  trackListStyle,
} from "../src";
// Imported from its own module rather than the barrel, even though the barrel
// re-exports it: the import PATH is the point. This file is the tripwire that
// reds the moment a mount reaches for a browser global at module scope, and a
// barrel import would prove that about the barrel's own chunk rather than about
// `src/pitch.ts`.
import {
  fretPositionsFor,
  mountFretboard,
  mountKeyboard,
  mountStaff,
  pitchStyle,
  staffPlacement,
} from "../src/pitch";
// The same reasoning, for the same reason: `harmony.ts` opens a frame loop and
// reads a media query, and both of those are browser globals a server does not
// have. The loop must be reachable as a MODULE without ever touching one.
import {
  harmonyPresenterStyle,
  mountChipStrip,
  mountFlowLane,
  mountNameplate,
  mountWheel,
} from "../src/harmony";
// And once more for the shell, which owns the single reading per frame: it
// resolves a motion preference and joins the shared loop, so it has the same
// two chances to reach for a global a server does not have.
import {mountWorkbench, workbenchStyle} from "../src/workbench";
import {joinFrameLoop} from "../src/internal/frame";

describe("SSR-safe module surface", () => {
  it("imports without evaluating browser globals", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof mountEnvelope).toBe("function");
    expect(typeof mountCanvasStage).toBe("function");
    expect(typeof mountLfo).toBe("function");
    expect(typeof mountMinimap).toBe("function");
    expect(typeof mountStatus).toBe("function");
    expect(typeof mountTransport).toBe("function");
    expect(typeof mountParameterRack).toBe("function");
    expect(typeof mountSectionPanel).toBe("function");
    expect(typeof mountPlaylist).toBe("function");
    expect(typeof mountTimeline).toBe("function");
    expect(typeof mountTrackList).toBe("function");
    expect(typeof mountKeyboard).toBe("function");
    expect(typeof mountStaff).toBe("function");
    expect(typeof mountFretboard).toBe("function");
    expect(envelopeStyle).toContain(".wui-envelope");
    expect(lfoStyle).toContain(".wui-lfo");
    expect(minimapStyle).toContain(".wui-minimap");
    expect(parameterRackStyle).toContain(".wui-parameter-rack");
    expect(sectionPanelStyle).toContain(".wui-section-panel");
    expect(playlistStyle).toContain(".wui-playlist__item");
    expect(timelineStyle).toContain(".wui-timeline__playhead");
    expect(statusStyle).toContain(".wui-status");
    expect(trackListStyle).toContain(".wui-track-list__row");
    expect(trackListStyle).toContain('.wui-track-list__row[aria-current="true"]');
    expect(pitchStyle).toContain(".wui-pitch-keyboard__key");
    expect(pitchStyle).toContain(".wui-pitch-staff__note");
    expect(pitchStyle).toContain(".wui-pitch-fretboard__dot");
    expect(typeof mountFlowLane).toBe("function");
    expect(typeof mountNameplate).toBe("function");
    expect(typeof mountChipStrip).toBe("function");
    expect(typeof mountWheel).toBe("function");
    expect(harmonyPresenterStyle).toContain(".wui-harmony-flow__band");
    expect(harmonyPresenterStyle).toContain(".wui-harmony-nameplate__symbol");
    expect(harmonyPresenterStyle).toContain(".wui-harmony-chip__item");
    expect(harmonyPresenterStyle).toContain(".wui-harmony-wheel__sector");
    expect(typeof mountWorkbench).toBe("function");
    expect(workbenchStyle).toContain(".wui-workbench__stage");
    expect(workbenchStyle).toContain(".wui-workbench__dock-body");
  });

  it("joins no frame loop where there is no view to ask", () => {
    // The loop's degradation, at the one place it matters most: a server that
    // imports a live read-out gets no motion, not an exception. The subscriber
    // is never called and the unsubscribe is safe to run anyway.
    const draw = () => {
      throw new Error("a server has no frames");
    };
    const leave = joinFrameLoop(undefined, draw);
    expect(typeof leave).toBe("function");
    expect(() => leave()).not.toThrow();
  });

  it("answers the pure pitch questions with no document at all", () => {
    // `staffPlacement` and `fretPositionsFor` are arithmetic, so a server that
    // never renders a surface can still use them to decide what to send.
    expect(staffPlacement(28)).toEqual({y: 10, ledgers: [28]});
    expect(fretPositionsFor(60, [40, 45, 50, 55, 59, 64], {firstFret: 0, fretCount: 5})).toEqual([
      {stringIndex: 3, fret: 5},
      {stringIndex: 4, fret: 1},
    ]);
  });
});
