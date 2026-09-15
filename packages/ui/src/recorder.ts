import {installStyle} from './internal/style';
import {clamp01} from './internal/dom';
import {claimHost} from './internal/lifecycle';
import {componentSurfaceCss, controlBorderFallback} from './internal/surface';
import {controlHeight, controlRadius} from './internal/control';
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
  const exportButtons: HTMLButtonElement[] = [];
  const status = document.createElement('div'); status.className='wui-recorder__status status'; status.setAttribute('part','status');
  root.append(record, ...(binding.togglePlayback ? [play] : []), meter, exports, status);
  let destroyed=false; let unsubscribe:(()=>void)|undefined;
  const command=(work:()=>Promise<void>|void):void=>{try{void Promise.resolve(work()).then(update,options.onError)}catch(error){options.onError?.(error)}};
  record.addEventListener('click',()=>command(()=>binding.toggleRecording()));
  play.addEventListener('click',()=>{if(binding.togglePlayback)command(()=>binding.togglePlayback!())});
  for(const format of options.exportFormats??[]){const button=document.createElement('button');button.type='button';button.className=`wui-recorder__button ${format.id}`;button.textContent=`⬇ ${format.label}`;button.setAttribute('aria-label',`Download ${format.label}`);button.addEventListener('click',()=>{if(binding.export)command(()=>binding.export!(format.id))});exports.append(button);exportButtons.push(button)}
  const update=():void=>{if(destroyed)return;try{const state=binding.snapshot();record.disabled=state.busy===true;record.classList.toggle('armed',state.recording);record.setAttribute('aria-busy',String(state.busy===true));record.setAttribute('aria-pressed',String(state.recording));record.setAttribute('aria-label',state.recording?'Stop recording':'Record');record.textContent=state.recording?'■ Stop':'● Record';play.disabled=!(state.canPlay??state.takeCount!=null);play.classList.toggle('on',state.playing===true);play.setAttribute('aria-pressed',String(state.playing===true));play.textContent=state.playing?'■ Stop':'▶ Play';for(const button of exportButtons)button.disabled=!(state.canExport??state.takeCount!=null);const amount=clamp01(state.level);level.style.setProperty('--wui-recorder-level',String(amount));meter.hidden=state.level==null;status.textContent=state.status??(state.recording?`● recording… ${state.recordedCount??0}`:state.playing?'playing take…':state.takeCount!=null?`captured ${state.takeCount}`:'Ready');}catch(error){options.onError?.(error)}};
  const handle:RecorderHandle={element:root,update,destroy(){if(destroyed)return;destroyed=true;unsubscribe?.();claim.release();root.remove();style?.remove()}};
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
  update();if(binding.subscribe)unsubscribe=binding.subscribe(update);return handle;
}
