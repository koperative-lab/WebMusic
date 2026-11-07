import {AudioOutputPort, type ModuleHandle, type TransportPort, type TransportPortSnapshot} from '@webmusic/kernel/module';

/**
 * A stand-in player element for analyser tests (DEC-068): it lends one audio
 * output port whose tap is `node`, and a transport port that mirrors the
 * element's `playing`/`currentTime` whenever the test dispatches the player's
 * `webaudio:statechange`, `webaudio:timeupdate`, `webaudio:seek` or
 * `webaudio:end` events.
 */
export function modulePlayerElement(node: AnalyserNode, playing: boolean, id = 'source') {
  const context = node.context as BaseAudioContext & {createAnalyser?: () => AnalyserNode};
  // Each tap receives the element's current analyser, so a test can replace it.
  context.createAnalyser = () => {
    const tap = element.analyser as AnalyserNode & {disconnect?: () => void; context: BaseAudioContext};
    if (typeof tap.disconnect !== 'function') tap.disconnect = () => undefined;
    (tap as {context: BaseAudioContext}).context = context;
    return tap;
  };
  const output = {context, connect: () => undefined, disconnect: () => undefined} as unknown as AudioNode;
  let port = new AudioOutputPort(output);
  const moduleListeners = new Set<() => void>();
  const listeners = new Set<(snapshot: TransportPortSnapshot) => void>();
  let revision = 0;
  let ended = false;
  let referenceTime = 0;
  const element = Object.assign(document.createElement('div'), {
    analyser: node, playing, currentTime: 0, duration: 2,
  }) as HTMLDivElement & {analyser: AnalyserNode; playing: boolean; currentTime: number; duration: number; module: ModuleHandle};
  const read = (): TransportPortSnapshot => ({
    revision, axis: 'clip-seconds', referenceTime, position: element.currentTime,
    durationSeconds: element.duration, playing: element.playing, rate: 1, loop: null,
    ended, pending: false, schedulingMode: 'immediate' as TransportPortSnapshot['schedulingMode'],
  });
  const transport: TransportPort = {
    id: 'transport', family: 'transport', direction: 'output', multiplicity: 'single',
    schemaVersion: 1, readiness: 'ready', axis: 'clip-seconds',
    snapshot: read,
    positionAt: () => element.currentTime,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  } as TransportPort;
  const commit = (): void => { revision++; const snapshot = read(); for (const listener of [...listeners]) listener(snapshot); };
  element.addEventListener('webaudio:statechange', (event) => {
    const next = (event as CustomEvent<{playing?: boolean}>).detail?.playing;
    if (typeof next === 'boolean') element.playing = next;
    ended = false;
    commit();
  });
  element.addEventListener('webaudio:seek', () => { ended = false; commit(); });
  // Small advances are continuous playback; a large jump is a direct seek.
  element.addEventListener('webaudio:timeupdate', (event) => {
    const seconds = (event as CustomEvent<{seconds?: number}>).detail?.seconds;
    if (typeof seconds !== 'number') return;
    const delta = seconds - element.currentTime;
    if (Math.abs(delta) <= 0.25) referenceTime += delta;
    element.currentTime = seconds;
    commit();
  });
  element.addEventListener('webaudio:end', () => { element.playing = false; ended = true; commit(); });
  // A replaced source publishes a new output port, which re-taps every consumer.
  element.addEventListener('webaudio:sourcechange', () => {
    port.dispose();
    port = new AudioOutputPort(output);
    for (const listener of [...moduleListeners]) listener();
  });
  element.module = {
    id, getPort: () => port, ports: () => [port, transport],
    subscribe(listener) { moduleListeners.add(listener); return () => { moduleListeners.delete(listener); }; },
  };
  element.id = id;
  document.body.append(element);
  return element;
}
