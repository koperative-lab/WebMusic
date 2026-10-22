import {mountStatus, statusStyle, type StatusState} from './status';
import {installStyle} from './internal/style';
import {componentSurfaceCss, controlBorderFallback} from './internal/surface';
import {controlHeight, controlRadius} from './internal/control';
// ============================================================================
// Domain-neutral recorder presenter.
//
// It owns accessible controls, meter/status markup and DOM lifecycle only.
// The structural binding remains the sole owner of recorder state/resources.
// ============================================================================

export interface RecorderState {
  recording: boolean;
  busy?: boolean;
  playing?: boolean;
  level?: number;
  recordedCount?: number;
  takeCount?: number;
  status?: string;
  /** Passive feedback; busy defaults to loading. Ready/recording text remains visible. */
  statusKind?: 'loading' | 'waiting' | 'error';
  canPlay?: boolean;
  canExport?: boolean;
  disabled?: boolean;
}

/** Structural presenter port; it owns no recorder or captured media. */
export interface RecorderBinding {
  snapshot(): RecorderState;
  toggleRecording(): Promise<void> | void;
  togglePlayback?(): Promise<void> | void;
  export?(format: string): Promise<void> | void;
  subscribe?(notify: () => void): () => void;
}

export interface RecorderExportFormat {
  id: string;
  label: string;
}

export interface RecorderClassNames {
  root?: string;
  record?: string;
  play?: string;
  meter?: string;
  level?: string;
  exports?: string;
  export?: string;
  status?: string;
}

export interface RecorderParts {
  root?: string;
  record?: string;
  play?: string;
  meter?: string;
  level?: string;
  exports?: string;
  export?: string;
  status?: string;
}

export interface RecorderOptions {
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
  exportFormats?: readonly RecorderExportFormat[];
  label?: string;
  recordLabel?: string;
  stopRecordingLabel?: string;
  playLabel?: string;
  /** Optional playing-state label; omitted keeps playLabel (or "Play take") stable. */
  stopPlaybackLabel?: string;
  meterLabel?: string;
  exportsLabel?: string;
  statusLabel?: string;
  classNames?: RecorderClassNames;
  parts?: RecorderParts;
  onError?: (error: unknown) => void;
}

export interface RecorderHandle {
  element: HTMLElement;
  update(): void;
  destroy(): void;
}

type RecorderHost = HTMLElement | ShadowRoot;

interface NormalizedRecorderState {
  recording: boolean;
  busy: boolean;
  playing: boolean;
  level?: number;
  recordedCount?: number;
  takeCount?: number;
  status?: string;
  statusKind?: 'loading' | 'waiting' | 'error';
  canPlay: boolean;
  canExport: boolean;
  disabled: boolean;
}

interface RecorderMountClaim {
  handle?: RecorderHandle;
}

const mountedRecorders = new WeakMap<RecorderHost, RecorderMountClaim>();

export const recorderStyle = statusStyle + `
.wui-recorder,
.wui-recorder * { box-sizing: border-box; }
.wui-recorder{
${componentSurfaceCss('recorder', {
  padding: 'var(--wm-recorder-padding, .6rem)',
  border: '1px solid var(--wm-recorder-border, var(--wm-border, #d8d8d8))',
  radius: 'var(--wm-recorder-radius, var(--wm-control-radius, 0))',
  background: 'var(--wm-recorder-background, var(--wm-surface, #fff))',
})}
min-width:0;max-width:100%;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;color:var(--wm-recorder-text,var(--wm-foreground,#222));font:.8rem var(--wm-font-family,var(--wm-font,system-ui,sans-serif))}
.wui-recorder__button{box-sizing:border-box;min-width:0;max-width:100%;appearance:none;border:1px solid var(--wui-recorder-button-border,var(--wm-recorder-button-border,${controlBorderFallback}));background:var(--wm-recorder-button,var(--wm-surface,#fff));color:inherit;min-height:${controlHeight('recorder')};padding:.35rem .75rem;overflow-wrap:anywhere;cursor:pointer;border-radius:${controlRadius('recorder')}}.wui-recorder__button:disabled{opacity:.4;cursor:default}.wui-recorder__record[aria-pressed=true]{background:var(--wui-recorder-accent,var(--wm-recorder-accent,var(--wm-accent,#c0392b)));color:var(--wm-recorder-accent-text,var(--wm-accent-foreground,#fff))}
.wui-recorder__exports{display:flex;flex-wrap:wrap;gap:.4rem;min-width:0;max-width:100%}.wui-recorder__exports:empty{display:none}
.wui-recorder__meter{width:var(--wm-recorder-meter-width,90px);max-width:100%;height:${controlHeight('recorder')};background:var(--wui-recorder-track,var(--wm-recorder-track,var(--wm-surface-muted,#ddd)));overflow:hidden;border-radius:${controlRadius('recorder')}}.wui-recorder__level{height:100%;background:var(--wui-recorder-accent,var(--wm-recorder-accent,var(--wm-accent,#c0392b)));transform-origin:left;transform:scaleX(var(--wui-recorder-level,0))}
.wui-recorder__status{flex-basis:100%;min-width:0;overflow-wrap:anywhere;font:var(--wm-recorder-status-font,.76rem var(--wm-font-mono,ui-monospace,monospace));color:var(--wui-recorder-muted,var(--wm-recorder-muted,var(--wm-foreground-muted,var(--wm-foreground,#666))))}
.wui-recorder__status .wui-status { min-height:1.25rem; }
.wui-recorder__button { font:inherit; }
.wui-recorder__button:focus-visible {
  outline: 2px solid var(--wm-focus, var(--wm-focus-ring, currentColor));
  outline-offset: 2px;
}
@media (forced-colors: active) {
  .wui-recorder { border-color: CanvasText; background: Canvas; color: CanvasText; }
  .wui-recorder__button { border-color: ButtonText; background: ButtonFace; color: ButtonText; }
  .wui-recorder__level { background: Highlight; }
}
`;

function addClassNames(element: Element, names: string | undefined): void {
  for (const name of names?.trim().split(/\s+/) ?? []) {
    if (name) element.classList.add(name);
  }
}

function setParts(
  element: Element,
  canonical: string,
  additional: string | undefined,
): void {
  const tokens = [
    canonical,
    ...(additional?.trim().split(/\s+/) ?? []),
  ].filter(Boolean);
  element.setAttribute("part", [...new Set(tokens)].join(" "));
}

function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function clamp01(value: unknown): number {
  const finite = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(1, finite));
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : undefined;
}

function normalizeSnapshot(snapshot: RecorderState): NormalizedRecorderState {
  const recordedCount = count(snapshot?.recordedCount);
  const takeCount = count(snapshot?.takeCount);
  const hasLevel = snapshot?.level !== undefined && snapshot?.level !== null;
  const hasTake = takeCount !== undefined;
  return {
    recording: snapshot?.recording === true,
    busy: snapshot?.busy === true,
    playing: snapshot?.playing === true,
    ...(hasLevel ? { level: clamp01(snapshot.level) } : {}),
    ...(recordedCount === undefined ? {} : { recordedCount }),
    ...(takeCount === undefined ? {} : { takeCount }),
    ...(snapshot?.status === undefined || snapshot?.status === null
      ? {}
      : { status: text(snapshot.status) }),
    ...(snapshot?.statusKind ? {statusKind: snapshot.statusKind} : {}),
    canPlay:
      snapshot?.canPlay === undefined || snapshot?.canPlay === null
        ? hasTake
        : snapshot.canPlay === true,
    canExport:
      snapshot?.canExport === undefined || snapshot?.canExport === null
        ? hasTake
        : snapshot.canExport === true,
    disabled: snapshot?.disabled === true,
  };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/** Mount an accessible recorder surface into an element or open shadow root. */
export function mountRecorder(
  host: RecorderHost,
  binding: RecorderBinding,
  options: RecorderOptions = {},
): RecorderHandle {
  // Claim before reading user-controlled options or binding capabilities.
  // A getter/iterator may synchronously mount a replacement into this host;
  // this attempt must never overwrite that newer claim afterward.
  const claim: RecorderMountClaim = {};
  const previousClaim = mountedRecorders.get(host);
  mountedRecorders.set(host, claim);
  let previousCleanupFailed = false;
  let previousCleanupError: unknown;
  try {
    previousClaim?.handle?.destroy();
  } catch (error) {
    previousCleanupFailed = true;
    previousCleanupError = error;
  }

  const document = host.ownerDocument;
  let formats: RecorderExportFormat[];
  let hasPlayback: boolean;
  let hasExport: boolean;
  try {
    formats = Array.from(options.exportFormats ?? [], (format) => ({
      id: text(format?.id),
      label: text(format?.label),
    }));
    hasPlayback = typeof binding.togglePlayback === "function";
    hasExport = typeof binding.export === "function" && formats.length > 0;
  } catch (error) {
    if (mountedRecorders.get(host) === claim) mountedRecorders.delete(host);
    throw error;
  }

  const style = installStyle(document, 'recorder', recorderStyle, options.stylesheet);

  const root = document.createElement("div");
  root.className = "wui-recorder wrap";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", options.label ?? "Recorder");
  addClassNames(root, options.classNames?.root);
  setParts(root, "root", options.parts?.root);

  const record = document.createElement("button");
  record.type = "button";
  record.className = "wui-recorder__button wui-recorder__record rec";
  addClassNames(record, options.classNames?.record);
  setParts(record, "record", options.parts?.record);

  const play = document.createElement("button");
  play.type = "button";
  play.className = "wui-recorder__button wui-recorder__play play";
  addClassNames(play, options.classNames?.play);
  setParts(play, "play", options.parts?.play);

  const meter = document.createElement("div");
  meter.className = "wui-recorder__meter meter";
  meter.setAttribute("role", "progressbar");
  meter.setAttribute("aria-label", options.meterLabel ?? "Input level");
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", "1");
  addClassNames(meter, options.classNames?.meter);
  setParts(meter, "meter", options.parts?.meter);

  const level = document.createElement("div");
  level.className = "wui-recorder__level level";
  level.setAttribute("aria-hidden", "true");
  addClassNames(level, options.classNames?.level);
  setParts(level, "level", options.parts?.level);
  meter.append(level);

  const exports = document.createElement("span");
  exports.className = "wui-recorder__exports";
  exports.setAttribute("role", "group");
  exports.setAttribute("aria-label", options.exportsLabel ?? "Export take");
  addClassNames(exports, options.classNames?.exports);
  setParts(exports, "exports", options.parts?.exports);

  const exportButtons: Array<{
    format: RecorderExportFormat;
    button: HTMLButtonElement;
  }> = [];
  if (hasExport) {
    for (const format of formats) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wui-recorder__button wui-recorder__export";
      addClassNames(button, format.id);
      addClassNames(button, options.classNames?.export);
      setParts(button, "export", options.parts?.export);
      button.textContent = `⬇ ${format.label}`;
      button.setAttribute("aria-label", `Download ${format.label}`);
      exports.append(button);
      exportButtons.push({ format, button });
    }
  }

  const status = document.createElement("div");
  status.className = "wui-recorder__status status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  status.setAttribute("aria-label", options.statusLabel ?? "Recorder status");
  addClassNames(status, options.classNames?.status);
  setParts(status, "status", options.parts?.status);

  const statusText = document.createElement('span');
  status.append(statusText);
  let feedbackState: StatusState = {kind: 'ready'};
  const feedback = mountStatus(status, {snapshot: () => feedbackState}, {
    stylesheet: false, classNames: {root: 'wui-status--embedded'},
  });

  root.append(
    record,
    ...(hasPlayback ? [play] : []),
    meter,
    ...(hasExport ? [exports] : []),
    status,
  );

  let destroyed = false;
  let current: NormalizedRecorderState | undefined;
  let unsubscribe: (() => void) | undefined;
  let updating = false;
  let pendingUpdate = false;
  let commandRevision = 0;
  const cleanups: Array<() => void> = [];
  const isCurrent = (): boolean =>
    !destroyed && mountedRecorders.get(host) === claim;

  const reportError = (error: unknown): void => {
    try {
      const result = options.onError?.(error) as unknown;
      if (isThenable(result)) void Promise.resolve(result).catch(() => undefined);
    } catch {
      // The presenter error boundary must not become a second error source.
    }
  };

  const listen = (
    target: EventTarget,
    type: string,
    listener: EventListener,
  ): void => {
    target.addEventListener(type, listener);
    cleanups.push(() => target.removeEventListener(type, listener));
  };

  const defaultStatus = (state: NormalizedRecorderState): string => {
    if (state.recording) return `● recording… ${state.recordedCount ?? 0}`;
    if (state.playing) return "playing take…";
    if (state.takeCount !== undefined) return `captured ${state.takeCount}`;
    return "Ready";
  };

  const paint = (state: NormalizedRecorderState): void => {
    if (!isCurrent()) return;
    const blocked = state.disabled || state.busy;

    root.classList.toggle("is-recording", state.recording);
    root.classList.toggle("is-playing", state.playing);
    root.classList.toggle("is-busy", state.busy);
    root.classList.toggle("is-disabled", state.disabled);
    root.setAttribute("aria-busy", String(state.busy));
    root.setAttribute("aria-disabled", String(state.disabled));

    record.disabled = blocked;
    record.classList.toggle("armed", state.recording);
    record.setAttribute("aria-busy", String(state.busy));
    record.setAttribute("aria-pressed", String(state.recording));
    record.setAttribute(
      "aria-label",
      state.recording
        ? (options.stopRecordingLabel ?? "Stop recording")
        : (options.recordLabel ?? "Record"),
    );
    record.textContent = state.recording ? "■ Stop" : "● Record";

    play.disabled = blocked || (!state.playing && !state.canPlay);
    play.classList.toggle("on", state.playing);
    play.setAttribute("aria-pressed", String(state.playing));
    play.setAttribute(
      "aria-label",
      state.playing && options.stopPlaybackLabel !== undefined
        ? options.stopPlaybackLabel
        : (options.playLabel ?? "Play take"),
    );
    play.textContent = state.playing ? "■ Stop" : "▶ Play";

    for (const { button } of exportButtons) {
      button.disabled = blocked || !state.canExport;
    }

    const amount = state.level ?? 0;
    level.style.setProperty("--wui-recorder-level", String(amount));
    meter.hidden = state.level === undefined;
    meter.setAttribute("aria-valuenow", String(amount));
    meter.setAttribute("aria-valuetext", `${Math.round(amount * 100)}%`);
    const statusKind = state.statusKind ?? (state.busy ? 'loading' : 'ready');
    feedbackState = {kind: statusKind, message: statusKind === 'ready' ? '' : state.status};
    feedback.update();
    statusText.hidden = statusKind !== 'ready';
    statusText.textContent = statusKind === 'ready' ? (state.status ?? defaultStatus(state)) : '';
    if (statusKind === 'ready') {
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
    } else {
      status.removeAttribute('role');
      status.removeAttribute('aria-live');
    }
    current = state;
  };

  const performUpdate = (): void => {
    if (!isCurrent()) return;
    try {
      const state = normalizeSnapshot(binding.snapshot());
      if (isCurrent()) paint(state);
    } catch (error) {
      if (isCurrent()) reportError(error);
    }
  };

  const update = (): void => {
    if (!isCurrent()) return;
    if (updating) {
      pendingUpdate = true;
      return;
    }
    updating = true;
    let passes = 0;
    try {
      do {
        pendingUpdate = false;
        performUpdate();
        passes += 1;
      } while (pendingUpdate && isCurrent() && passes < 32);
      if (pendingUpdate && isCurrent()) {
        pendingUpdate = false;
        reportError(
          new Error("Recorder update did not stabilize after 32 passes"),
        );
      }
    } finally {
      pendingUpdate = false;
      updating = false;
    }
  };

  type CommandScope = "record" | "play" | "export";
  const commandEnabled = (
    state: NormalizedRecorderState,
    scope: CommandScope,
  ): boolean => {
    if (state.disabled || state.busy) return false;
    if (scope === "play") {
      return hasPlayback && (state.playing || state.canPlay);
    }
    if (scope === "export") return hasExport && state.canExport;
    return true;
  };

  const command = (
    scope: CommandScope,
    work: () => Promise<void> | void,
  ): void => {
    if (!isCurrent() || !current || !commandEnabled(current, scope)) return;
    const revision = ++commandRevision;
    const isLatest = (): boolean =>
      isCurrent() && revision === commandRevision;
    const settle = (): void => {
      // A stale command may still have changed authoritative binding state.
      if (isCurrent()) update();
    };
    const reject = (error: unknown): void => {
      if (!isCurrent()) return;
      const report = isLatest();
      update();
      if (report && isLatest()) reportError(error);
    };
    try {
      const result = work();
      void Promise.resolve(result).then(settle, reject);
    } catch (error) {
      reject(error);
    }
  };

  listen(record, "click", (() =>
    command("record", () => binding.toggleRecording())) as EventListener);
  if (hasPlayback) {
    listen(play, "click", (() =>
      command("play", () => binding.togglePlayback!())) as EventListener);
  }
  for (const { format, button } of exportButtons) {
    listen(button, "click", (() =>
      command("export", () => binding.export!(format.id))) as EventListener);
  }

  const rollback = (): void => {
    destroyed = true;
    pendingUpdate = false;
    commandRevision += 1;
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        // Preserve the mount failure after best-effort rollback.
      }
    }
    try {
      unsubscribe?.();
    } catch {
      // Preserve the mount failure after best-effort rollback.
    }
    unsubscribe = undefined;
    feedback.destroy();
    try {
      root.remove();
    } catch {
      // Preserve the mount failure after best-effort rollback.
    }
    try {
      style?.remove();
    } catch {
      // Preserve the mount failure after best-effort rollback.
    }
    current = undefined;
    if (mountedRecorders.get(host) === claim) mountedRecorders.delete(host);
  };

  const handle: RecorderHandle = {
    element: root,
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      pendingUpdate = false;
      commandRevision += 1;
      let cleanupFailed = false;
      let cleanupError: unknown;
      for (const cleanup of cleanups.splice(0)) {
        try {
          cleanup();
        } catch (error) {
          if (!cleanupFailed) cleanupError = error;
          cleanupFailed = true;
        }
      }
      try {
        unsubscribe?.();
      } catch (error) {
        if (!cleanupFailed) cleanupError = error;
        cleanupFailed = true;
      }
      unsubscribe = undefined;
      feedback.destroy();
      try {
        root.remove();
      } catch (error) {
        if (!cleanupFailed) cleanupError = error;
        cleanupFailed = true;
      }
      try {
        style?.remove();
      } catch (error) {
        if (!cleanupFailed) cleanupError = error;
        cleanupFailed = true;
      }
      current = undefined;
      if (mountedRecorders.get(host) === claim) mountedRecorders.delete(host);
      if (cleanupFailed) reportError(cleanupError);
    },
  };

  claim.handle = handle;
  try {
    if (previousCleanupFailed && isCurrent()) {
      reportError(previousCleanupError);
    }
    if (!isCurrent()) {
      rollback();
      return handle;
    }

    host.append(...(style ? [style] : []), root);
    if (!isCurrent()) {
      // A reentrant append may destroy this attempt before appending its nodes
      // late. Rollback deliberately retries node removal even when destroyed.
      rollback();
      return handle;
    }

    try {
      const nextUnsubscribe = binding.subscribe?.(update);
      if (
        nextUnsubscribe !== undefined &&
        typeof nextUnsubscribe !== "function"
      ) {
        throw new TypeError("Recorder subscribe() must return a function");
      }
      if (nextUnsubscribe) {
        if (isCurrent()) unsubscribe = nextUnsubscribe;
        else {
          try {
            nextUnsubscribe();
          } catch {
            // Superseded mounts do not publish stale cleanup failures.
          }
        }
      }
    } catch (error) {
      if (isCurrent()) reportError(error);
    }
    if (!isCurrent()) {
      rollback();
      return handle;
    }
    update();
    if (!isCurrent()) rollback();
  } catch (error) {
    rollback();
    throw error;
  }
  return handle;
}
