import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '@webmusic/score';
import type {ScorePlayerElement} from '@webmusic/score/play/element';
import type {DemoScope} from './demo-lifecycle';
import {mountQuickStartStatus} from './quick-start-player-client';

/** Two bars containing natural and accidental pitches in the C3–B4 window. */
export function createWaterfallKeyboardScore() {
  const builder = new ScoreBuilder();
  const part = PartId('piano');
  const voice = VoiceId('melody');
  const timeSignature = {numerator: 4, denominator: 4};
  builder.setMetadata({title: 'Aligned waterfall and keyboard'})
    .addTempo({atQuarters: Rational.ZERO, bpm: 96})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature})
    .addPart({id: part, name: 'Piano', midiProgram: 0});
  for (let index = 0; index < 2; index += 1) builder.addMeasure({
    id: MeasureId(`m${index + 1}`), number: index + 1,
    onsetQuarters: new Rational(index * 4), durationQuarters: new Rational(4), timeSignature,
  });
  [48, 49, 52, 54, 55, 58, 59, 60, 61, 64, 66, 67, 70, 71, 60, 48].forEach((midi, index) => {
    builder.addNote(part, {
      id: builder.newNoteId(), pitch: Pitch.fromMidi(midi),
      onsetQuarters: new Rational(index, 2), duration: Duration.eighth(), voice,
    });
  });
  return builder.build();
}

/** Both independent views use one pitch scale and one borrowed player. */
export function mountWaterfallKeyboardDemo(root: HTMLElement, scope: DemoScope): void {
  const player = root.querySelector<ScorePlayerElement>('score-player')!;
  const view = root.querySelector<HTMLElement>('score-view')!;
  const keyboard = root.querySelector<HTMLElement>('pitch-view')!;
  const track = root.querySelector<HTMLElement>('[data-aligned-track]')!;
  const width = root.querySelector<HTMLSelectElement>('[data-aligned-width]')!;
  const timeScale = root.querySelector<HTMLSelectElement>('[data-aligned-time-scale]')!;
  const height = root.querySelector<HTMLSelectElement>('[data-aligned-key-height]')!;
  const status = root.querySelector<HTMLElement>('[data-aligned-status]')!;
  const updateWidth = (): void => {
    const [white, black] = width.value.split('/').map(Number);
    if (!(white > 0) || !(black > 0)) return;
    view.setAttribute('white-note-width', String(white));
    view.setAttribute('black-note-width', String(black));
    keyboard.setAttribute('white-key-width', String(white));
    keyboard.setAttribute('black-key-width', String(black));
    // C3–B4 contains fourteen natural notes. The shared track scrolls once.
    track.style.width = `${14 * white}px`;
  };
  const updateHeight = (): void => {
    const white = Number(height.value);
    keyboard.setAttribute('white-key-height', String(white));
    keyboard.setAttribute('black-key-height', String(Math.round(white * .625)));
  };
  scope.listen(width, 'change', updateWidth);
  scope.listen(height, 'change', updateHeight);
  scope.listen(timeScale, 'change', () => view.setAttribute('pixels-per-second', timeScale.value));
  updateWidth();
  updateHeight();
  scope.add(() => { player.score = undefined; });
  scope.add(mountQuickStartStatus(player, status));
  player.score = createWaterfallKeyboardScore();
}
