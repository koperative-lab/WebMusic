import {installStyle} from './internal/style';
import {clamp01} from './internal/dom';
import {claimHost, createErrorSink, createUpdateLoop, runCleanups} from './internal/lifecycle';
import {componentSurfaceCss, controlBorderFallback} from './internal/surface';
import {controlHeight, controlRadius} from './internal/control';
import {formatNumber, readText, textValue, type UITextValue, type UIValueFormatters} from './text';
export interface RecorderState {
  recording: boolean;
  busy?: boolean;
  playing?: boolean;
  level?: number;
  recordedCount?: number;
  takeCount?: number;
  status?: string;
  canPlay?: boolean;
  canExport?: boolean;
}

export interface RecorderBinding {
  snapshot(): RecorderState;
  toggleRecording(): Promise<void> | void;
  togglePlayback?(): Promise<void> | void;
  export?(format: string): Promise<void> | void;
  subscribe?(notify: () => void): () => void;
}

export interface RecorderText {
  record?: string;
  stopRecording?: string;
  stop?: string;
  play?: string;
  playTake?: string;
  stopPlayback?: string;
  exports?: string;
  download?: UITextValue<{label: string}>;
  downloadText?: UITextValue<{label: string}>;
  recordingStatus?: UITextValue<{count: number; formattedCount: string}>;
  playingStatus?: string;
  capturedStatus?: UITextValue<{count: number; formattedCount: string}>;
  readyStatus?: string;
}

export interface RecorderOptions {
  /** Read application-provided text on each update. */
  getText?: () => RecorderText;
  formatters?: UIValueFormatters;
  exportFormats?: readonly {id: string; label: string}[];
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface RecorderHandle { element: HTMLElement; update(): void; destroy(): void; }
type RecorderHost = HTMLElement | ShadowRoot;
const mounted = new WeakMap<RecorderHost, RecorderHandle>();

export const recorderStyle = `
.wui-recorder{
${componentSurfaceCss('recorder', {
  padding: 'var(--wm-recorder-padding, .6rem)',
  border: '1px solid var(--wm-recorder-border, var(--wm-border, #d8d8d8))',
  radius: 'var(--wm-recorder-radius, var(--wm-control-radius, 0))',
  background: 'var(--wm-recorder-background, var(--wm-surface, #fff))',
})}
min-width:0;max-width:100%;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;color:var(--wm-recorder-text,var(--wm-foreground,#222));font:.8rem var(--wm-font-family,var(--wm-font,system-ui,sans-serif))}
.wui-recorder__button{box-sizing:border-box;min-width:0;max-width:100%;appearance:none;border:1px solid var(--wm-recorder-button-border,${controlBorderFallback});background:var(--wm-recorder-button,var(--wm-surface,#fff));color:inherit;font:inherit;min-height:${controlHeight('recorder')};padding:.35rem .75rem;overflow-wrap:anywhere;cursor:pointer;border-radius:${controlRadius('recorder')}}.wui-recorder__button:disabled{opacity:.4;cursor:default}.wui-recorder__record[aria-pressed=true]{background:var(--wm-recorder-accent,var(--wm-accent,#c0392b));color:var(--wm-recorder-accent-text,var(--wm-accent-foreground,#fff))}
.wui-recorder__button:focus-visible{outline:2px solid var(--wm-focus,currentColor);outline-offset:2px}
.wui-recorder__exports{display:flex;flex-wrap:wrap;gap:.4rem;min-width:0;max-width:100%}.wui-recorder__exports:empty{display:none}
.wui-recorder__meter{width:var(--wm-recorder-meter-width,90px);max-width:100%;height:${controlHeight('recorder')};background:var(--wm-recorder-track,var(--wm-surface-muted,#ddd));overflow:hidden;border-radius:${controlRadius('recorder')}}.wui-recorder__level{height:100%;background:var(--wm-recorder-accent,var(--wm-accent,#c0392b));transform-origin:left;transform:scaleX(var(--wui-recorder-level,0))}
.wui-recorder__status{flex-basis:100%;min-width:0;overflow-wrap:anywhere;font:var(--wm-recorder-status-font,.76rem var(--wm-font-mono,ui-monospace,monospace));color:var(--wm-recorder-muted,var(--wm-foreground-muted, var(--wm-foreground, #666)))}
`;

export function mountRecorder(host: RecorderHost, binding: RecorderBinding, options: RecorderOptions = {}): RecorderHandle {
  const document = host.ownerDocument;
  const style = installStyle(document, 'recorder', recorderStyle, options.stylesheet);
  const root = document.createElement('div'); root.className = 'wui-recorder wrap'; root.setAttribute('part','root');
  const record = document.createElement('button'); record.type='button'; record.className='wui-recorder__button wui-recorder__record rec'; record.setAttribute('part','record');
  const play = document.createElement('button'); play.type='button'; play.className='wui-recorder__button wui-recorder__play play'; play.setAttribute('part','play'); play.setAttribute('aria-label','Play take');
  const meter = document.createElement('div'); meter.className='wui-recorder__meter meter'; meter.setAttribute('part','meter');
  const level = document.createElement('div'); level.className='wui-recorder__level level'; level.setAttribute('part','level'); meter.append(level);
  const exports = document.createElement('span'); exports.className='wui-recorder__exports'; exports.setAttribute('part', 'exports'); exports.setAttribute('role', 'group'); exports.setAttribute('aria-label', 'Export take');
  const exportButtons: Array<{button: HTMLButtonElement; format: {id: string; label: string}}> = [];
  const status = document.createElement('div'); status.className='wui-recorder__status status'; status.setAttribute('part','status');
  root.append(record, ...(binding.togglePlayback ? [play] : []), meter, exports, status);
  let destroyed=false; let unsubscribe:(()=>void)|undefined;
  let texts: RecorderText | undefined;
  const report = createErrorSink(options.onError);
  const command=(work:()=>Promise<void>|void):void=>{if(destroyed)return;try{void Promise.resolve(work()).then(update,(error)=>{if(!destroyed)report(error)})}catch(error){if(!destroyed)report(error)}};
  record.addEventListener('click',()=>command(()=>binding.toggleRecording()));
  play.addEventListener('click',()=>{if(binding.togglePlayback)command(()=>binding.togglePlayback!())});
  for (const format of options.exportFormats ?? []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `wui-recorder__button ${format.id}`;
    button.addEventListener('click', () => { if (binding.export) command(() => binding.export!(format.id)); });
    exports.append(button);
    exportButtons.push({button, format});
  }
  const paintSnapshot = (): void => {
    if (destroyed) return;
    try {
      const state = binding.snapshot();
      if (destroyed || !claim.isCurrent()) return;
      texts = readText(options.getText, options.onError);
      if (destroyed || !claim.isCurrent()) return;
      const label = (key: "record" | "stopRecording" | "stop" | "play" | "playTake" | "stopPlayback" | "exports" | "playingStatus" | "readyStatus", fallback: string): string => textValue(texts?.[key], fallback, {}, options.onError);
      record.disabled = state.busy === true;
      record.classList.toggle('armed', state.recording);
      record.setAttribute('aria-busy', String(state.busy === true));
      record.setAttribute('aria-pressed', String(state.recording));
      record.setAttribute('aria-label', state.recording ? label('stopRecording', 'Stop recording') : label('record', 'Record'));
      record.textContent = state.recording ? `■ ${label('stop', 'Stop')}` : `● ${label('record', 'Record')}`;
      play.disabled = !(state.canPlay ?? state.takeCount != null);
      play.classList.toggle('on', state.playing === true);
      play.setAttribute('aria-pressed', String(state.playing === true));
      play.setAttribute('aria-label', state.playing ? label('stopPlayback', 'Stop take') : label('playTake', 'Play take'));
      play.textContent = state.playing ? `■ ${label('stop', 'Stop')}` : `▶ ${label('play', 'Play')}`;
      exports.setAttribute('aria-label', label('exports', 'Export take'));
      for (const {button, format} of exportButtons) {
        button.disabled = !(state.canExport ?? state.takeCount != null);
        button.textContent = textValue(texts?.downloadText, `⬇ ${format.label}`, {label: format.label}, options.onError);
        button.setAttribute('aria-label', textValue(texts?.download, `Download ${format.label}`, {label: format.label}, options.onError));
      }
      const amount = clamp01(state.level);
      level.style.setProperty('--wui-recorder-level', String(amount));
      meter.hidden = state.level == null;
      const count = state.recording ? state.recordedCount ?? 0 : state.takeCount ?? 0;
      const values = {count, formattedCount: formatNumber(options.formatters, count, undefined, options.onError)};
      status.textContent = state.status ?? (state.recording
        ? textValue(texts?.recordingStatus, `● recording… ${values.formattedCount}`, values, options.onError)
        : state.playing ? label('playingStatus', 'playing take…')
        : state.takeCount != null ? textValue(texts?.capturedStatus, `captured ${values.formattedCount}`, values, options.onError)
        : label('readyStatus', 'Ready'));
    } catch (error) { report(error); }
  };
  const updateLoop = createUpdateLoop({
    name: 'Recorder', pass: paintSnapshot,
    isCurrent: () => !destroyed && claim.isCurrent(), report,
  });
  const update = (): void => updateLoop.run();

  const handle:RecorderHandle={element:root,update,destroy(){if(destroyed)return;destroyed=true;updateLoop.cancel();const stop=unsubscribe;unsubscribe=undefined;runCleanups([stop,()=>claim.release(),()=>root.remove(),()=>style?.remove()],report)}};
  // Claim the host before destroying the previous recorder: its cleanup may
  // mount a replacement, and that replacement must win.
  const claim = claimHost(mounted, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;
  host.append(...(style ? [style] : []), root);
  if (!claim.isCurrent()) {
    // A re-entrant mount took the host while this one was appending; leave it
    // exactly as that mount left it.
    root.remove();
    style?.remove();
    return handle;
  }
  update();
  if (destroyed || !claim.isCurrent()) return handle;
  if (binding.subscribe) {
    try {
      const stop = binding.subscribe(update);
      if (destroyed || !claim.isCurrent()) runCleanups([stop], report);
      else unsubscribe = stop;
    } catch (error) {
      report(error);
    }
  }

  return handle;
}
