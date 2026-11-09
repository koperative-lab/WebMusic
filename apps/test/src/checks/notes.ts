import {defineAllElements} from '@webmusic/score/play/element';
import type {MountContext} from '../model';
import {reportErrors, setMarkup, wireMonitoredInput} from './shared';

/** C: a standalone note surface feeding a recorder. */
export function mountNoteRecorder(context: MountContext): () => void {
  defineAllElements();
  setMarkup(context.canvas, `
    <score-note-input id="mt-keys" layout="piano" start="48" end="71" keyboard routing="manual" aria-label="Piano keys"></score-note-input>
    <score-recorder id="mt-take" bpm="120" quantize="0" aria-label="Take recorder"></score-recorder>`);
  wireMonitoredInput(context.canvas.querySelector('#mt-keys')!, context.canvas.querySelector('#mt-take')!);
  const stopErrors = reportErrors(context);
  return () => stopErrors();
}
