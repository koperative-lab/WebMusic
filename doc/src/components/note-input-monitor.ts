import {InteractivePlayer, Sound} from '@webmusic/score/play/headless';
import type {DemoScope} from './demo-lifecycle';

type Layout = 'piano' | 'grid' | 'chords';
type Surface = HTMLElement & {
  layout: Layout;
  onNote?: (midi: number, velocity: number, on: boolean) => void;
};

export function monitorNoteInput(input: Surface, scope: DemoScope): void {
  const player = new InteractivePlayer();
  player.addVoice(
    'piano',
    Sound.oscillator({type: 'triangle', gain: 0.2, releaseSeconds: 0.05}),
  );
  player.addVoice(
    'grid',
    Sound.oscillator({type: 'square', gain: 0.1, releaseSeconds: 0.04}),
  );
  player.addVoice(
    'chords',
    Sound.oscillator({type: 'sine', gain: 0.14, releaseSeconds: 0.08}),
  );

  // A layout change releases held notes after the new attribute is visible.
  // Remember their original voice so those releases reach the route that
  // actually started each note.
  const heldVoices = new Map<number, {voice: Layout; press: symbol}>();
  scope.add(() => {
    input.onNote = undefined;
    heldVoices.clear();
    player.dispose();
  });
  input.onNote = (midi, velocity, on) => {
    if (on) {
      const voice = input.layout;
      const press = Symbol();
      heldVoices.set(midi, {voice, press});
      scope.run(player.preload().then(() => {
        if (scope.active && heldVoices.get(midi)?.press === press) player.noteOn(voice, midi, velocity, 3600);
      }));
      return;
    }
    const voice = heldVoices.get(midi)?.voice ?? input.layout;
    heldVoices.delete(midi);
    player.noteOff(voice, midi);
  };
}
