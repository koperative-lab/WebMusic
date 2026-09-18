import {bindLocalization, message as uiMessage, type UILocalization} from './localization';
import {installStyle} from './internal/style';
import {claimHost, createErrorSink} from './internal/lifecycle';
import {addClassNames, setParts} from './internal/dom';
import {componentSurfaceCss} from './internal/surface';
export type StatusKind = 'ready' | 'loading' | 'empty' | 'error';

/** Domain-neutral state for a passive loading, empty, or failure message. */
export interface StatusState {
  kind: StatusKind;
  message?: string;
}

export interface StatusBinding {
  snapshot(): StatusState;
  subscribe?(notify: () => void): () => void;
}

export interface StatusClassNames {
  root?: string;
  message?: string;
}

export interface StatusParts {
  root?: string;
  message?: string;
}

export interface StatusOptions {
  /** Borrowed live text and formatting; language updates preserve controls. */
  localization?: UILocalization;
  classNames?: StatusClassNames;
  parts?: StatusParts;
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface StatusHandle {
  element: HTMLElement;
  message: HTMLSpanElement;
  update(): void;
  destroy(): void;
}

type StatusHost = HTMLElement | ShadowRoot;

const mounted = new WeakMap<StatusHost, StatusHandle>();

export const statusStyle = String.raw`
.wui-status {
${componentSurfaceCss('status', {
  padding: 'var(--wm-status-padding, .6rem)',
  border: 'var(--wm-status-border, 1px solid var(--wm-border, #d8d8d8))',
  radius: 'var(--wm-status-radius, var(--wm-control-radius, 0))',
  background: 'var(--wm-status-background, var(--wm-surface, #fff))',
})}
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 0;
  min-height: var(--wm-status-height, 3rem);
  color: var(--wm-status-foreground, var(--wm-foreground-muted, var(--wm-foreground, #777)));
  font: 500 .8125rem/1.3 var(--wm-font-family, system-ui, sans-serif);
  text-align: center;
}
.wui-status__message { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.wui-status[hidden] { display: none; }
.wui-status[data-kind="error"] {
  border-style: solid;
  color: var(--wm-status-error, var(--wm-danger, #b42318));
}
.wui-status.wui-status--embedded {
  min-height: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
`;

function defaultMessage(kind: StatusKind): string {
  if (kind === 'loading') return 'Loading…';
  if (kind === 'empty') return 'Nothing to show.';
  if (kind === 'error') return 'Something went wrong.';
  return '';
}

/** Mount a passive, accessible status surface into caller-owned DOM. */
export function mountStatus(
  host: StatusHost,
  binding: StatusBinding,
  options: StatusOptions = {},
): StatusHandle {
  const document = host.ownerDocument;
  const style = installStyle(document, 'status', statusStyle, options.stylesheet);

  const root = document.createElement('div');
  root.className = 'wui-status';
  addClassNames(root, options.classNames?.root);
  setParts(root, 'root', options.parts?.root);

  const message = document.createElement('span');
  message.className = 'wui-status__message';
  addClassNames(message, options.classNames?.message);
  setParts(message, 'message', options.parts?.message);
  root.append(message);

  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  let releaseLocalization = (): void => {};

  const report = createErrorSink(options.onError);

  const update = (): void => {
    if (destroyed) return;
    try {
      const state = binding.snapshot();
      const kind: StatusKind =
        state.kind === 'loading' || state.kind === 'empty' || state.kind === 'error'
          ? state.kind
          : 'ready';
      root.dataset.kind = kind;
      root.hidden = kind === 'ready';
      root.removeAttribute('role');
      root.removeAttribute('aria-live');
      root.removeAttribute('aria-busy');
      if (kind === 'error') {
        root.setAttribute('role', 'alert');
        root.setAttribute('aria-live', 'assertive');
      } else if (kind !== 'ready') {
        root.setAttribute('role', 'status');
        root.setAttribute('aria-live', 'polite');
      }
      if (kind === 'loading') root.setAttribute('aria-busy', 'true');
      message.textContent = state.message ?? uiMessage(options.localization, `status.${kind}`, defaultMessage(kind));
    } catch (error) {
      report(error);
    }
  };

  const handle: StatusHandle = {
    element: root,
    message,
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      releaseLocalization();
      try {
        unsubscribe?.();
      } catch (error) {
        report(error);
      }
      claim.release();
      root.remove();
      style?.remove();
    },
  };

  // Claim the host before destroying the previous surface: its cleanup may
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
  if (binding.subscribe) {
    try {
      unsubscribe = binding.subscribe(update);
    } catch (error) {
      report(error);
    }
  }
  releaseLocalization = bindLocalization(options.localization, update, () => !destroyed && claim.isCurrent(), options.onError);
  return handle;
}
