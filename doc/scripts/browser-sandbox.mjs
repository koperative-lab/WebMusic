import {fileURLToPath} from 'node:url';

// Documentation examples use the browser/Parcel runtime. Do not distribute
// Sandpack's optional, separately licensed Nodebox server runtime.
export const browserSandboxAlias = {
  find: /^@codesandbox\/nodebox$/,
  replacement: fileURLToPath(new URL('../src/runtime/unsupported-nodebox.mjs', import.meta.url)),
};
