import {installStyle} from './internal/style';
import {clamp01} from './internal/dom';
import {claimHost, createErrorSink, runCleanups} from './internal/lifecycle';
import {componentSurfaceCss, controlBorderFallback} from './internal/surface';
import {controlHeight, controlRadius} from './internal/control';
import {bindLocalization, formatNumber, message, type UILocalization} from './localization';
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

export interface RecorderOptions {
  localization?: UILocalization;
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
  const play = document.createElement('button'); play.type='button'; play.className='wui-recorder__button wui-recorder__play play'; play.setAttribute('part','play'); play.setAttribute('aria-label',message(options.localization, 'recorder.playTake', 'Play take'));
  const meter = document.createElement('div'); meter.className='wui-recorder__meter meter'; meter.setAttribute('part','meter');
  const level = document.createElement('div'); level.className='wui-recorder__level level'; level.setAttribute('part','level'); meter.append(level);
  const exports = document.createElement('span'); exports.className='wui-recorder__exports'; exports.setAttribute('part', 'exports'); exports.setAttribute('role', 'group'); exports.setAttribute('aria-label', message(options.localization, 'recorder.exports', 'Export take'));
  const exportButtons: Array<{button: HTMLButtonElement; format: {id: string; label: string}}> = [];
  const status = document.createElement('div'); status.className='wui-recorder__status status'; status.setAttribute('part','status');
  root.append(record, ...(binding.togglePlayback ? [play] : []), meter, exports, status);
  let destroyed=false; let unsubscribe:(()=>void)|undefined;
  let unbindLocalization: (() => void) | undefined;
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
  const update = (): void => {
    if (destroyed) return;
    try {
      const state = binding.snapshot();
      if (destroyed || !claim.isCurrent()) return;
      const localize = (key: string, fallback: string): string => message(options.localization, `recorder.${key}`, fallback);
      record.disabled = state.busy === true;
      record.classList.toggle('armed', state.recording);
      record.setAttribute('aria-busy', String(state.busy === true));
      record.setAttribute('aria-pressed', String(state.recording));
      record.setAttribute('aria-label', state.recording ? localize('stopRecording', 'Stop recording') : localize('record', 'Record'));
      record.textContent = state.recording ? `■ ${localize('stop', 'Stop')}` : `● ${localize('record', 'Record')}`;
      play.disabled = !(state.canPlay ?? state.takeCount != null);
      play.classList.toggle('on', state.playing === true);
      play.setAttribute('aria-pressed', String(state.playing === true));
      play.setAttribute('aria-label', state.playing ? localize('stopPlayback', 'Stop take') : localize('playTake', 'Play take'));
      play.textContent = state.playing ? `■ ${localize('stop', 'Stop')}` : `▶ ${localize('play', 'Play')}`;
      exports.setAttribute('aria-label', localize('exports', 'Export take'));
      for (const {button, format} of exportButtons) {
        button.disabled = !(state.canExport ?? state.takeCount != null);
        button.textContent = message(options.localization, 'recorder.downloadText', '⬇ {label}', {label: format.label});
        button.setAttribute('aria-label', message(options.localization, 'recorder.download', 'Download {label}', {label: format.label}));
      }
      const amount = clamp01(state.level);
      level.style.setProperty('--wui-recorder-level', String(amount));
      meter.hidden = state.level == null;
      const count = state.recording ? state.recordedCount ?? 0 : state.takeCount ?? 0;
      const values = {count, formattedCount: formatNumber(options.localization, count)};
      status.textContent = state.status ?? (state.recording
        ? message(options.localization, 'recorder.recordingStatus', '● recording… {formattedCount}', values)
        : state.playing ? localize('playingStatus', 'playing take…')
        : state.takeCount != null ? message(options.localization, 'recorder.capturedStatus', 'captured {formattedCount}', values)
        : localize('readyStatus', 'Ready'));
    } catch (error) { report(error); }
  };
  const handle:RecorderHandle={element:root,update,destroy(){if(destroyed)return;destroyed=true;const stop=unsubscribe;unsubscribe=undefined;const releaseText=unbindLocalization;unbindLocalization=undefined;runCleanups([stop,releaseText,()=>claim.release(),()=>root.remove(),()=>style?.remove()],report)}};
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
  unbindLocalization = bindLocalization(options.localization, update, () => !destroyed && claim.isCurrent(), report);
  return handle;
}
