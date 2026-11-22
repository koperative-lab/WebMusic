/** WebMusic supports browser Sandpack templates; Node server templates are disabled. */
export const INJECT_MESSAGE_TYPE = 'webmusic-unsupported-node-runtime-inject';
export const PREVIEW_LOADED_MESSAGE_TYPE = 'webmusic-unsupported-node-runtime-preview';

export class Nodebox {
  constructor() {
    throw new Error('Node server sandboxes are unavailable in WebMusic documentation. Use a browser template.');
  }
}
