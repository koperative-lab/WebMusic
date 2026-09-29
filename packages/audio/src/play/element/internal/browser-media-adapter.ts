import type {
  MediaPlaybackAdapter,
  MediaPlaybackAdapterFactory,
} from "../../headless/engines/media-engine";

/** Browser-only bridge used by the styled element for streaming playback. */
export const browserMediaAdapterFactory: MediaPlaybackAdapterFactory = (
  context,
  sourceUrl,
) => {
  const media = document.createElement("audio");
  media.crossOrigin = "anonymous";
  media.preload = "auto";
  media.src = sourceUrl;
  let node: MediaElementAudioSourceNode | null = null;
  let endedListener: (() => void) | null = null;

  const adapter: MediaPlaybackAdapter = {
    get duration() {
      return media.duration;
    },
    get paused() {
      return media.paused;
    },
    get ended() {
      return media.ended;
    },
    get currentTime() {
      return media.currentTime;
    },
    set currentTime(value: number) {
      media.currentTime = value;
    },
    get playbackRate() {
      return media.playbackRate;
    },
    set playbackRate(value: number) {
      media.playbackRate = value;
    },
    get preservesPitch() {
      return media.preservesPitch;
    },
    set preservesPitch(value: boolean | undefined) {
      media.preservesPitch = value ?? true;
    },
    get loop() {
      return media.loop;
    },
    set loop(value: boolean) {
      media.loop = value;
    },
    get onended() {
      return endedListener;
    },
    set onended(listener: (() => void) | null) {
      endedListener = listener;
      media.onended = listener ? () => listener() : null;
    },
    play() {
      return media.play();
    },
    pause() {
      media.pause();
    },
    connect(destination: AudioNode) {
      const online = context as BaseAudioContext & {
        createMediaElementSource?: (
          source: HTMLMediaElement,
        ) => MediaElementAudioSourceNode;
      };
      if (typeof online.createMediaElementSource !== "function") {
        throw new Error("Streaming playback requires an online AudioContext");
      }
      node = online.createMediaElementSource(media);
      node.connect(destination);
    },
    disconnect() {
      node?.disconnect();
      node = null;
    },
    dispose() {
      endedListener = null;
      media.onended = null;
      media.pause();
      media.removeAttribute("src");
      media.load();
    },
  };
  return adapter;
};
