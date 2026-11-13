import {mountMixingNotesDemo} from './mixing-notes';
import {mountParametersGesturesDemo} from './parameters-gestures';
import {mountTransportTimeDemo} from './transport-time';
import {normalizeDemoHandle, type UiPresenterDemoHandle} from './types';
import {mountViewsAnalysisDemo} from './views-analysis';

const demoMounts = [
  mountTransportTimeDemo,
  mountParametersGesturesDemo,
  mountMixingNotesDemo,
  mountViewsAnalysisDemo,
] as const;

/** Mount the real published presenter represented by one UI Kit documentation page. */
export function mountUiPresenterDemo(
  presenter: string,
  host: HTMLElement,
): UiPresenterDemoHandle {
  for (const mountDemo of demoMounts) {
    const result = mountDemo(presenter, host);
    if (result) return normalizeDemoHandle(result);
  }
  throw new Error(`No live UI presenter demo is registered for ${presenter}`);
}
