import {createAudioClip, type AudioClip, type AudioPeaks} from '@webmusic/audio';
import {createDecoderWorker, type DecoderWorker} from '@webmusic/audio/play';
import {createAnalysisWorker, type AnalysisWorkerClient, type AnalyzeCallOptions, type SpectrogramData} from '@webmusic/audio/analyze';
import type {DemoScope} from './demo-lifecycle';

export type DemoChannel = 'left' | 'right' | 'mid' | 'side';

interface Fixture {
  clip(): Promise<AudioClip>;
  peaks(channels?: readonly DemoChannel[]): Promise<AudioPeaks>;
  spectrum(channel?: DemoChannel, detailed?: boolean): Promise<SpectrogramData>;
  release(): void;
}
interface Entry {
  fixture: Fixture;
  references: number;
}
const entries = new Map<string, Entry>();

/** Page-owned decoded data and analysis. Last release cancels fetch/worker work. */
export function acquireAudioViewFixture(url: string): Fixture {
  const existing = entries.get(url);
  if (existing) {
    existing.references++;
    return lease(existing);
  }
  const abort = new AbortController();
  let worker: AnalysisWorkerClient | undefined;
  let decoder: DecoderWorker | undefined;
  let loaded: Promise<AudioClip> | undefined;
  let basePeaks: Promise<AudioPeaks> | undefined;
  const channels = new Map<DemoChannel, Promise<AudioClip>>();
  const peaks = new Map<string, Promise<AudioPeaks>>();
  const spectra = new Map<string, Promise<SpectrogramData>>();
  const ensureActive = (): void => {
    if (abort.signal.aborted) throw new DOMException('Demo disposed', 'AbortError');
  };
  const client = (): AnalysisWorkerClient => {
    ensureActive();
    return worker ??= createAnalysisWorker();
  };
  const analyze = async (value: AudioClip, options: AnalyzeCallOptions) => {
    const current = client();
    try {
      return await current.analyze(value, options);
    } catch (error) {
      // A crashed worker cannot service a retry; do not dispose a replacement.
      if (worker === current) { worker = undefined; current.dispose(); }
      throw error;
    }
  };
  const clip = (): Promise<AudioClip> => {
    ensureActive();
    return loaded ??= (async () => {
      decoder = createDecoderWorker();
      try {
        const value = await decoder.decodeFromUrl(url, 'wav', {signal: abort.signal});
        ensureActive();
        return value;
      } finally {
        decoder?.dispose();
        decoder = undefined;
      }
    })().catch((error) => { loaded = undefined; throw error; });
  };
  const originalPeaks = (): Promise<AudioPeaks> => {
    ensureActive();
    return basePeaks ??= clip().then((value) => analyze(value, {tasks: ['peaks']}))
      .then((result) => { ensureActive(); return result.peaks; })
      .catch((error) => { basePeaks = undefined; throw error; });
  };
  const channelClip = (key: DemoChannel): Promise<AudioClip> => {
    if (key === 'left') return clip(); // Spectrogram analysis uses the first channel.
    if (!channels.has(key)) {
      channels.set(key, clip().then((value) => {
        ensureActive();
        const right = value.channelData(Math.min(1, value.numberOfChannels - 1))!;
        if (key !== 'right') {
          const left = value.channelData(0)!;
          const sign = key === 'mid' ? 1 : -1;
          for (let i = 0; i < right.length; i++) right[i] = (left[i] + sign * right[i]) * 0.5;
        }
        return createAudioClip({sampleRate: value.sampleRate, channelData: [right]});
      }).catch((error) => { channels.delete(key); throw error; }));
    }
    return channels.get(key)!;
  };
  const channelPeaks = (key: DemoChannel): Promise<AudioPeaks> => {
    if (!peaks.has(key)) {
      const pending = key === 'left' || key === 'right'
        ? originalPeaks().then((value) => selectPeakChannels(value, [key === 'left' ? 0 : Math.min(1, value.channels - 1)]))
        : channelClip(key).then((value) => analyze(value, {tasks: ['peaks']})).then((result) => result.peaks);
      peaks.set(key, pending.catch((error) => { peaks.delete(key); throw error; }));
    }
    return peaks.get(key)!;
  };
  const fixture: Fixture = {
    clip,
    peaks(selected) {
      ensureActive();
      if (!selected) return originalPeaks();
      const key = selected.join(',');
      if (!peaks.has(key)) {
        peaks.set(key, Promise.all(selected.map(channelPeaks)).then(combinePeaks)
          .catch((error) => { peaks.delete(key); throw error; }));
      }
      return peaks.get(key)!;
    },
    spectrum(channel = 'left', detailed = false) {
      ensureActive();
      const key = `${channel}:${detailed}`;
      if (!spectra.has(key)) {
        spectra.set(key, channelClip(channel)
          .then((value) => analyze(value, {
            tasks: ['spectrogram'], fftSize: detailed ? 1024 : 2048, hopSize: detailed ? 256 : 2048,
          }))
          .then((result) => {
            ensureActive();
            if (!result.spectrogram) throw new Error('Analysis did not return a spectrogram');
            return result.spectrogram;
          }).catch((error) => { spectra.delete(key); throw error; }));
      }
      return spectra.get(key)!;
    },
    release() {
      abort.abort();
      worker?.dispose();
      decoder?.dispose();
      decoder = undefined;
      channels.clear();
      peaks.clear();
      spectra.clear();
      loaded = undefined;
      basePeaks = undefined;
    },
  };
  const entry = {fixture, references: 1};
  entries.set(url, entry);
  return lease(entry);

  function lease(entry: Entry): Fixture {
    let released = false;
    return {
      ...entry.fixture,
      release() {
        if (released) return;
        released = true;
        if (--entry.references !== 0) return;
        if (entries.get(url) === entry) entries.delete(url);
        entry.fixture.release();
      },
    };
  }
}

/** Reorder the existing pyramid without scanning or copying full PCM channels. */
function selectPeakChannels(peaks: AudioPeaks, selected: readonly number[]): AudioPeaks {
  return {...peaks, channels: selected.length, levels: peaks.levels.map((level) => {
    const count = level.data.length / (peaks.channels * 2);
    const data = new Int8Array(count * selected.length * 2);
    for (let p = 0; p < count; p++) for (let c = 0; c < selected.length; c++) {
      const source = (p * peaks.channels + selected[c]) * 2;
      const target = (p * selected.length + c) * 2;
      data[target] = level.data[source];
      data[target + 1] = level.data[source + 1];
    }
    return {samplesPerPeak: level.samplesPerPeak, data};
  })};
}

function combinePeaks(inputs: AudioPeaks[]): AudioPeaks {
  if (inputs.length === 1) return inputs[0];
  const first = inputs[0];
  return {...first, channels: inputs.length, levels: first.levels.map((level, index) => {
    const data = new Int8Array(level.data.length * inputs.length);
    for (let p = 0; p < level.data.length / 2; p++) for (let c = 0; c < inputs.length; c++) {
      data[(p * inputs.length + c) * 2] = inputs[c].levels[index].data[p * 2];
      data[(p * inputs.length + c) * 2 + 1] = inputs[c].levels[index].data[p * 2 + 1];
    }
    return {samplesPerPeak: level.samplesPerPeak, data};
  })};
}

/** Below-fold demos start on approach or keyboard/pointer interaction. */
export function whenDemoVisible(root: HTMLElement, scope: DemoScope, start: () => Promise<void>): void {
  let started = false;
  let observer: IntersectionObserver | undefined;
  const activate = (): void => {
    if (started || !scope.active) return;
    started = true;
    observer?.disconnect();
    scope.run(start());
  };
  scope.listen(root, 'focusin', activate);
  scope.listen(root, 'pointerdown', activate);
  if (typeof IntersectionObserver === 'undefined') activate();
  else {
    observer = new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) activate();
    }, {rootMargin: '200px'});
    observer.observe(root);
    scope.add(() => observer?.disconnect());
  }
}
