// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  AudioLiveViewElement,
  defineAudioLiveViewElement,
} from '../../src/view/element/index';

defineAudioLiveViewElement();

const flush = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 0));

/** Records every 2D call so a canvas-free jsdom can still assert drawing. */
interface RecordingContext {
  calls: string[];
  fillRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
}

const contexts: RecordingContext[] = [];

function installCanvas(): void {
  const proto = globalThis.HTMLCanvasElement.prototype as unknown as {
    getContext: (id: string) => unknown;
  };
  vi.spyOn(proto, 'getContext').mockImplementation(function getContext() {
    const calls: string[] = [];
    const record =
      (name: string) =>
      (...args: unknown[]) => {
        calls.push(`${name}:${args.join(',')}`);
      };
    const context: RecordingContext = {
      calls,
      fillRect: vi.fn(record('fillRect')),
      fillText: vi.fn(record('fillText')),
    };
    contexts.push(context);
    return {
      ...context,
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillStyle: '',
      font: '',
      textAlign: '',
      textBaseline: '',
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
  });
}

/** jsdom reports zero-sized boxes; give the elements a believable one. */
function sizeElements(width = 200, height = 40): void {
  vi.spyOn(globalThis.HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(globalThis.HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height);
  vi.spyOn(globalThis.Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  } as DOMRect);
}

beforeEach(() => {
  contexts.length = 0;
  installCanvas();
  sizeElements();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function mount<T extends HTMLElement>(tag: string, attrs: Record<string, string> = {}): T {
  const element = document.createElement(tag) as T;
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  document.body.append(element);
  return element;
}

it('frames the live view once while its element host stays transparent', async () => {
  const element = mount<AudioLiveViewElement>('audio-live-view');
  await flush();
  const root = element.querySelector<HTMLElement>('.wui-stage')!;

  expect(element.style.background).toBe('');
  expect(element.style.border).toBe('');
  expect(element.style.padding).toBe('');
  expect(root.style.background).toContain('--wm-audio-live-view-surface-background');
  expect(root.style.background).toContain('--wm-stage-surface-background');
  expect(root.style.border).toContain('1px solid var(--wm-border, #d8d8d8)');
  expect(root.style.padding).toContain('--wm-component-padding, .6rem');
});

describe('<audio-live-view>', () => {
  function fakeAnalyser(): AnalyserNode {
    return {
      fftSize: 8,
      frequencyBinCount: 4,
      getByteTimeDomainData: (frame: Uint8Array) => frame.fill(200),
      getByteFrequencyData: (frame: Uint8Array) => frame.fill(128),
    } as unknown as AnalyserNode;
  }

  it('says what is missing instead of leaving a blank strip', async () => {
    mount<AudioLiveViewElement>('audio-live-view');
    await flush();

    expect(document.querySelector('[role="status"]')?.textContent).toContain('No live source');
  });

  it('borrows an analyser from a source element', async () => {
    const source = document.createElement('div') as HTMLDivElement & {analyser?: AnalyserNode};
    source.id = 'tap';
    source.analyser = fakeAnalyser();
    document.body.append(source);

    const element = mount<AudioLiveViewElement>('audio-live-view', {source: '#tap'});
    await flush();
    expect(element.analyser).toBe(source.analyser);
    expect(element.live).toBe(true);
  });

  it('finds the recorder spelling of the tap as well', async () => {
    const recorder = document.createElement('div') as HTMLDivElement & {
      inputAnalyser?: AnalyserNode;
    };
    recorder.id = 'rec';
    recorder.inputAnalyser = fakeAnalyser();
    document.body.append(recorder);

    const element = mount<AudioLiveViewElement>('audio-live-view', {source: '#rec'});
    await flush();
    expect(element.analyser).toBe(recorder.inputAnalyser);
  });

  it('keeps both drawings under one type attribute', async () => {
    const element = mount<AudioLiveViewElement>('audio-live-view');
    expect(element.type).toBe('waveform');
    element.type = 'spectrogram';
    expect(element.getAttribute('type')).toBe('spectrogram');
    element.setAttribute('type', 'nonsense');
    expect(element.type).toBe('waveform');
  });

  it('never disposes the borrowed analyser', async () => {
    const source = document.createElement('div') as HTMLDivElement & {analyser?: AnalyserNode};
    source.id = 'shared';
    const analyser = fakeAnalyser();
    source.analyser = analyser;
    document.body.append(source);

    const element = mount<AudioLiveViewElement>('audio-live-view', {source: '#shared'});
    await flush();
    element.remove();

    // Borrowed, so several views can read one tap and none of them owns it.
    expect(source.analyser).toBe(analyser);
  });
});
