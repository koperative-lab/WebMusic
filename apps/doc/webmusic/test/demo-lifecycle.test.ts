// @vitest-environment jsdom

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import ts from 'typescript';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountDemos, type DemoScope} from '../src/components/demo-lifecycle';
import {mountProgrammaticDemo, programmaticCode, programmaticFeedback} from '../src/components/programmatic/programmatic-demo-lifecycle';

const registrations: Array<() => void> = [];
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return {promise, resolve};
}

function mount(selector: string, setup: (root: HTMLElement, scope: DemoScope) => void | Promise<void>): void {
  registrations.push(mountDemos(selector, setup));
}

/** Execute the actual Astro client body with only its package boundaries replaced. */
function runDemo(file: string, modules: Record<string, unknown>): void {
  const fileName = resolve(dirname(fileURLToPath(import.meta.url)), '../src/components', `${file}.astro`);
  const source = readFileSync(fileName, 'utf8').match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!source) throw new Error(`Missing script in ${file}`);
  const code = ts.transpileModule(source, {
    fileName,
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
  }).outputText;
  const require = (name: string): unknown => {
    if (name.endsWith('/demo-lifecycle')) return {mountDemos: mount};
    if (name.endsWith('/programmatic-demo-lifecycle')) return {
      mountProgrammaticDemo: (selector: string, setup: (root: HTMLElement, scope: DemoScope) => void | Promise<void>) => {
        const stop = mountProgrammaticDemo(selector, setup);
        registrations.push(stop);
        return stop;
      },
      programmaticCode,
      programmaticFeedback,
    };
    if (!(name in modules)) throw new Error(`Unexpected import: ${name}`);
    return modules[name];
  };
  new Function('require', 'exports', code)(require, {});
}

class Builder {
  setMetadata() { return this; }
  addTempo() { return this; }
  addMeter() { return this; }
  addPart() { return this; }
  addMeasure() { return this; }
  addNote() { return this; }
  newNoteId() { return 'note'; }
  build() { return {}; }
}
const scoreModule = {
  ScoreBuilder: Builder,
  Rational: class { static ZERO = 0; },
  Duration: {eighth: () => ({}), quarter: () => ({})},
  Pitch: {parse: (pitch: string) => pitch},
  MeasureId: (id: string) => id,
  PartId: (id: string) => id,
  VoiceId: (id: string) => id,
};

afterEach(async () => {
  for (const stop of registrations.splice(0)) stop();
  document.body.replaceChildren();
  await flush();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('demo resource scopes', () => {
  it('releases detached roots once, removes listeners and remounts cleanly', async () => {
    document.body.innerHTML = '<div data-demo><button></button></div>';
    const root = document.querySelector<HTMLElement>('[data-demo]')!;
    const clicked = vi.fn();
    const disposed = vi.fn();
    const setup = vi.fn((_root: HTMLElement, scope: DemoScope) => {
      scope.add(disposed);
      scope.listen(root.querySelector('button')!, 'click', clicked);
    });
    mount('[data-demo]', setup);
    root.querySelector('button')!.click();
    root.remove();
    await flush();
    root.querySelector('button')!.click();
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(disposed).toHaveBeenCalledTimes(1);
    document.body.append(root);
    await flush();
    root.querySelector('button')!.click();
    expect(clicked).toHaveBeenCalledTimes(2);
    expect(setup).toHaveBeenCalledTimes(2);
  });

  it('invalidates pending setup on navigation and immediately releases late resources', async () => {
    document.body.innerHTML = '<div data-demo></div>';
    const pending = deferred<void>();
    const disposed = vi.fn();
    let signal: AbortSignal | undefined;
    mount('[data-demo]', async (_root, scope) => {
      signal = scope.signal;
      await pending.promise;
      scope.add(disposed);
    });
    document.dispatchEvent(new Event('astro:before-swap'));
    expect(signal?.aborted).toBe(true);
    pending.resolve();
    await flush();
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it('cleans every owned resource even if another cleanup throws', () => {
    document.body.innerHTML = '<div data-demo></div>';
    const first = vi.fn();
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    mount('[data-demo]', (_root, scope) => {
      scope.add(first);
      scope.add(() => { throw new Error('cleanup'); });
    });
    window.dispatchEvent(new Event('pagehide'));
    expect(first).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledOnce();
  });
});

describe('actual programmatic demo lifetimes', () => {
  it('Rack owns its three created sounds and ignores a late play continuation', async () => {
    document.body.innerHTML = '<div data-programmatic-rack><button data-play></button><div data-fill></div><span data-time></span></div>';
    const pending = deferred<void>();
    const sounds: Array<{dispose: ReturnType<typeof vi.fn>}> = [];
    const members: Array<{id: string; sound: {dispose(): void}; soundOwnership?: string; player: unknown}> = [];
    const subscribe = vi.fn(() => vi.fn());
    class Player { on = subscribe; }
    const rack = {
      add: vi.fn((options) => { const member = {...options, player: undefined}; members.push(member); return {...member}; }),
      get: vi.fn((id: string) => ({...members.find((member) => member.id === id), player: new Player()})),
      on: vi.fn(() => vi.fn()),
      play: vi.fn(() => pending.promise),
      dispose: vi.fn(() => { for (const member of members) if (member.soundOwnership === 'owned') member.sound.dispose(); }),
    };
    runDemo('programmatic/ProgrammaticRackDemo', {
      '@webmusic/score': scoreModule,
      '@webmusic/score/play/headless': {
        createRack: () => rack,
        ScorePlayer: Player,
        Sound: {oscillator: () => { const sound = {dispose: vi.fn()}; sounds.push(sound); return sound; }},
      },
    });
    document.querySelector<HTMLButtonElement>('[data-play]')!.click();
    document.body.replaceChildren();
    await flush();
    pending.resolve();
    await flush();
    expect(rack.dispose).toHaveBeenCalledOnce();
    expect(sounds).toHaveLength(3);
    for (const sound of sounds) expect(sound.dispose).toHaveBeenCalledOnce();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('Rack follows fresh member snapshots after lazy player creation', async () => {
    document.body.innerHTML = '<div data-programmatic-rack><button data-play></button><div data-fill></div><span data-time>0.0s</span></div>';
    const pending = deferred<void>();
    const cursor = new Map<string, () => void>();
    const subscribe = vi.fn((event: string, listener: () => void) => {
      cursor.set(event, listener);
      return () => cursor.delete(event);
    });
    class Player {
      seconds = 2;
      durationSeconds = 8;
      on = subscribe;
    }
    const player = new Player();
    let built = false;
    const rack = {
      add: vi.fn((options) => ({...options, player: undefined})),
      get: vi.fn((id: string) => ({id, player: built ? player : undefined})),
      on: vi.fn(() => vi.fn()),
      play: vi.fn(async () => { await pending.promise; built = true; }),
      dispose: vi.fn(),
    };
    runDemo('programmatic/ProgrammaticRackDemo', {
      '@webmusic/score': scoreModule,
      '@webmusic/score/play/headless': {
        createRack: () => rack,
        ScorePlayer: Player,
        Sound: {oscillator: () => ({dispose: vi.fn()})},
      },
    });
    document.querySelector<HTMLButtonElement>('[data-play]')!.click();
    expect(subscribe).not.toHaveBeenCalled();
    pending.resolve();
    await flush();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(subscribe.mock.calls[0][0]).toBe('cursor');
    cursor.get('cursor')!();
    expect(rack.get).toHaveBeenCalledWith('melody');
    expect(document.querySelector('[data-time]')!.textContent).toBe('2.0s');
    expect(document.querySelector<HTMLElement>('[data-fill]')!.style.width).toBe('25%');
    player.seconds = 4;
    cursor.get('cursor')!();
    expect(document.querySelector('[data-time]')!.textContent).toBe('4.0s');
    expect(document.querySelector<HTMLElement>('[data-fill]')!.style.width).toBe('50%');
  });

  it('InteractivePlayer awaits readiness and never advances after unmount', async () => {
    document.body.innerHTML = '<div data-programmatic-interactiveplayer><button data-advance></button><div data-fill></div><span data-readout></span></div>';
    const pending = deferred<void>();
    const player = {
      addVoice: vi.fn(), addSource: vi.fn(), on: vi.fn(),
      preload: vi.fn(() => pending.promise), advance: vi.fn(), dispose: vi.fn(),
    };
    runDemo('programmatic/ProgrammaticInteractivePlayerDemo', {
      '@webmusic/score': scoreModule,
      '@webmusic/score/play/headless': {InteractivePlayer: class { constructor() { return player; } }, Sound: {oscillator: () => ({})}},
    });
    document.querySelector<HTMLButtonElement>('[data-advance]')!.click();
    expect(player.preload).toHaveBeenCalledOnce();
    expect(player.advance).not.toHaveBeenCalled();
    expect(player.addVoice.mock.calls[0][2]).toEqual({synthOwnership: 'owned'});
    document.body.replaceChildren();
    await flush();
    pending.resolve();
    await flush();
    expect(player.advance).not.toHaveBeenCalled();
    expect(player.dispose).toHaveBeenCalledOnce();
  });

  it('Metronome stops a pending start and connects its sound only once', async () => {
    document.body.innerHTML = '<div data-programmatic-metronome><button data-toggle></button><span data-dot></span><input data-bpm><span data-readout></span></div>';
    const pending = deferred<void>();
    const audio = {resume: vi.fn(() => pending.promise), close: vi.fn(async () => {}), destination: {}, currentTime: 0};
    vi.stubGlobal('AudioContext', class { constructor() { return audio; } });
    const sound = {connect: vi.fn(), preload: vi.fn(async () => {}), noteOn: vi.fn(), dispose: vi.fn()};
    const clock = {start: vi.fn(), stop: vi.fn(), setBpm: vi.fn()};
    runDemo('programmatic/ProgrammaticMetronomeDemo', {
      '@webmusic/score/play/headless': {Metronome: class { constructor() { return clock; } }, Sound: {oscillator: () => sound}},
    });
    const button = document.querySelector<HTMLButtonElement>('[data-toggle]')!;
    button.click();
    button.click();
    pending.resolve();
    await flush();
    expect(clock.start).not.toHaveBeenCalled();
    button.click();
    await flush();
    expect(clock.start).toHaveBeenCalledOnce();
    expect(sound.connect).toHaveBeenCalledOnce();
    document.body.replaceChildren();
    await flush();
    expect(sound.dispose).toHaveBeenCalledOnce();
    expect(audio.close).toHaveBeenCalledOnce();
  });

  it('Sandbox disconnects visibility observation and ignores a late client import', async () => {
    document.body.innerHTML = '<div data-api-sandbox><pre>fallback</pre></div>';
    const pending = deferred<{mountApiSandbox: ReturnType<typeof vi.fn>}>();
    const mountSandbox = vi.fn();
    const disconnect = vi.fn();
    let visible!: () => void;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: (entries: Array<{isIntersecting: boolean}>) => void) {
        visible = () => callback([{isIntersecting: true}]);
      }
      observe() {}
      disconnect = disconnect;
    });
    runDemo('ApiSandbox', {'./api-sandbox-client': pending.promise});
    visible();
    await flush();
    document.body.replaceChildren();
    await flush();
    pending.resolve({mountApiSandbox: mountSandbox});
    await flush();
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(mountSandbox).not.toHaveBeenCalled();
  });
});


describe('programmatic Parameters reset', () => {
  it('releases the previous instance, restores controls and ignores old async work', async () => {
    document.body.innerHTML = `<div data-reset-demo>
      <div data-hl-stage><button>Play</button><output>initial</output></div>
      <details class="wm-pg__params"><input value="120"></details>
      <pre data-hl-readout>initial code</pre><p data-hl-feedback hidden></p>
    </div>`;
    const root = document.querySelector<HTMLElement>('[data-reset-demo]')!;
    const pending = deferred<void>();
    const disposed = vi.fn();
    const lateResource = vi.fn();
    const clicked = vi.fn();
    let generations = 0;
    const setup = (_root: HTMLElement, scope: DemoScope): void => {
      const generation = ++generations;
      scope.add(() => disposed(generation));
      scope.listen(root.querySelector('button')!, 'click', async () => {
        clicked(generation);
        await pending.promise;
        scope.add(lateResource);
        if (scope.active) root.querySelector('output')!.textContent = `instance ${generation}`;
      });
    };
    registrations.push(mountProgrammaticDemo('[data-reset-demo]', setup));
    const oldButton = root.querySelector('button')!;
    oldButton.click();
    root.querySelector('input')!.value = '180';
    root.querySelector('output')!.textContent = 'changed';
    programmaticCode(root, 'changed code');
    programmaticFeedback(root, 'failed');
    expect(root.querySelector<HTMLElement>('[data-hl-feedback]')!.hidden).toBe(false);
    root.dispatchEvent(new CustomEvent('wm:headless-reset', {bubbles: true}));
    expect(disposed).toHaveBeenCalledExactlyOnceWith(1);
    expect(generations).toBe(2);
    expect(root.querySelector('input')!.value).toBe('120');
    expect(root.querySelector('output')!.textContent).toBe('initial');
    expect(root.querySelector('[data-hl-readout]')!.textContent).toBe('initial code');
    expect(root.querySelector<HTMLElement>('[data-hl-feedback]')!.hidden).toBe(true);
    oldButton.click();
    expect(clicked).toHaveBeenCalledTimes(1);
    pending.resolve();
    await flush();
    expect(lateResource).toHaveBeenCalledTimes(1);
    expect(root.querySelector('output')!.textContent).toBe('initial');
    root.querySelector('button')!.click();
    await flush();
    expect(root.querySelector('output')!.textContent).toBe('instance 2');
    root.remove();
    await flush();
    expect(disposed.mock.calls).toEqual([[1], [2]]);
    expect(lateResource).toHaveBeenCalledTimes(2);
  });

  it('replaces the real transport polling binding and releases it again on Reset', async () => {
    document.body.innerHTML = `<div data-programmatic-transportdriver>
      <div data-hl-stage><input data-scrub value="0"><div data-fill></div><span data-time></span></div>
      <details class="wm-pg__params"><input data-interval value="50"></details><pre data-hl-readout></pre>
    </div>`;
    const players: Array<{dispose: ReturnType<typeof vi.fn>}> = [];
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    class Player {
      seconds = 0; duration = 4; dispose = vi.fn();
      constructor() { players.push(this); }
      on() { return () => undefined; }
    }
    const bindValue = vi.fn((_player: unknown, _options: unknown) => { const stop = vi.fn(); stops.push(stop); return stop; });
    runDemo('programmatic/ProgrammaticTransportDriverDemo', {
      '@webmusic/score': scoreModule,
      '@webmusic/score/play/headless': {ScorePlayer: Player, Sound: {oscillator: () => ({})}},
      '@webmusic/score/play/drivers': {bindValue},
    });
    const root = document.querySelector<HTMLElement>('[data-programmatic-transportdriver]')!;
    const input = root.querySelector<HTMLInputElement>('[data-interval]')!;
    input.value = '125';
    input.dispatchEvent(new Event('change'));
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(bindValue.mock.calls[1]?.[1]).toMatchObject({interval: 125, mode: 'seek'});
    expect(root.querySelector('[data-hl-readout]')!.textContent).toContain('interval: 125');
    root.dispatchEvent(new CustomEvent('wm:headless-reset', {bubbles: true}));
    expect(stops[1]).toHaveBeenCalledTimes(1);
    expect(players[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(root.querySelector<HTMLInputElement>('[data-interval]')!.value).toBe('50');
    expect(bindValue.mock.calls[2]?.[1]).toMatchObject({interval: 50});
    root.remove();
    await flush();
    expect(players[1]!.dispose).toHaveBeenCalledTimes(1);
    expect(stops[2]).toHaveBeenCalledTimes(1);
  });
});


describe('ScorePlayer playground ownership and feedback', () => {
  it.each(['owned', 'borrowed'])('releases a %s synth exactly once and reports failed Play', async (ownership) => {
    document.body.innerHTML = `<div data-headless-demo><p data-hl-feedback hidden></p>
      <div data-stage><button data-sp-play></button><div data-sp-fill></div><span data-sp-time></span></div></div>`;
    const synth = {dispose: vi.fn()};
    const unsubscribed = vi.fn();
    const play = vi.fn(() => Promise.reject(new Error('Audio is unavailable')));
    const disposed = vi.fn();
    class Player {
      progress = 0; seconds = 0;
      constructor(_score: unknown, readonly options: {synthOwnership: string}) {}
      play = play;
      pause() {}
      isPlaying() { return false; }
      on() { return unsubscribed; }
      dispose() { disposed(); if (this.options.synthOwnership === 'owned') synth.dispose(); }
    }
    runDemo('headless/ScorePlayerPlayground', {
      '@webmusic/score': scoreModule,
      '@webmusic/score/play/headless': {ScorePlayer: Player, Sound: {oscillator: () => synth}},
    });
    const factory = (window as unknown as Record<string, (options: Record<string, unknown>, stage: HTMLElement) => {
      construction: string; dispose: () => void;
    }>).__wmScorePlayerDemo!;
    const stage = document.querySelector<HTMLElement>('[data-stage]')!;
    const instance = factory({synthOwnership: ownership, loop: true}, stage);
    expect(instance.construction).toContain('const synth = Sound.oscillator()');
    expect(instance.construction).toContain(`"synthOwnership": "${ownership}"`);
    expect(instance.construction).toContain('"loop": true');
    stage.querySelector<HTMLButtonElement>('button')!.click();
    await flush();
    const feedback = document.querySelector<HTMLElement>('[data-hl-feedback]')!;
    expect(feedback.hidden).toBe(false);
    expect(feedback.textContent).toBe('Audio is unavailable');
    expect(stage.querySelector('button')!.textContent).toBe('▶ Play');
    instance.dispose();
    instance.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(synth.dispose).toHaveBeenCalledTimes(1);
    expect(unsubscribed).toHaveBeenCalledTimes(2);
    stage.querySelector<HTMLButtonElement>('button')!.click();
    expect(play).toHaveBeenCalledTimes(1);
    delete (window as unknown as Record<string, unknown>).__wmScorePlayerDemo;
  });

  it('does not report a late failure from a player disposed by Reset', async () => {
    document.body.innerHTML = `<div data-headless-demo><p data-hl-feedback hidden></p>
      <div data-stage><button data-sp-play></button><div data-sp-fill></div><span data-sp-time></span></div></div>`;
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, no) => { reject = no; });
    const synth = {dispose: vi.fn()};
    class Player {
      progress = 0; seconds = 0;
      play() { return pending; }
      pause() {}
      isPlaying() { return false; }
      on() { return () => undefined; }
      dispose() {}
    }
    runDemo('headless/ScorePlayerPlayground', {
      '@webmusic/score': scoreModule,
      '@webmusic/score/play/headless': {ScorePlayer: Player, Sound: {oscillator: () => synth}},
    });
    const factory = (window as unknown as Record<string, (options: Record<string, unknown>, stage: HTMLElement) => {
      dispose: () => void;
    }>).__wmScorePlayerDemo!;
    const stage = document.querySelector<HTMLElement>('[data-stage]')!;
    const instance = factory({synthOwnership: 'borrowed'}, stage);
    stage.querySelector<HTMLButtonElement>('button')!.click();
    instance.dispose();
    const feedback = document.querySelector<HTMLElement>('[data-hl-feedback]')!;
    feedback.hidden = true;
    feedback.textContent = '';
    reject(new Error('Old request failed'));
    await flush();
    expect(feedback.hidden).toBe(true);
    expect(feedback.textContent).toBe('');
    expect(synth.dispose).toHaveBeenCalledTimes(1);
    delete (window as unknown as Record<string, unknown>).__wmScorePlayerDemo;
  });
});
