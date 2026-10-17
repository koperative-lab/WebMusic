// Copied into the isolated tarball consumer by check-external-install.mjs.
// Use only installed public entries, never workspace paths or source imports.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);

for (const format of ['esm', 'cjs']) {
  const load = (specifier) => format === 'esm' ? import(specifier) : require(specifier);
  const {AudioClip} = await load('@webmusic/audio');
  const {loadClip, serializeWav} = await load('@webmusic/audio/play');
  const {createWebMusicProjectPlugins} = await load('@webmusic/bridge');
  const {ModuleAudioEnvironment, ModuleContext} = await load('@webmusic/kernel/module');
  const clip = await loadClip(serializeWav([new Float32Array(48)], 48000));
  assert.ok(clip instanceof AudioClip, `${format}: decoded AudioClip shares the root class`);
  assert.equal(clip.length, 48);
  assert.equal(clip.sampleRate, 48000);

  // Asset admission is lazy: this checks package composition without a native
  // device or fake Web Audio graph. An allocation here is a contract failure.
  const audio = new ModuleAudioEnvironment({create: () => {
    throw new Error('Project asset admission must not allocate audio.');
  }});
  const context = new ModuleContext({id: 'scope', audio});
  const factory = createWebMusicProjectPlugins().find((candidate) => candidate.id === 'webmusic.audio-player');
  assert.ok(factory, `${format}: Audio project factory is exported`);
  let instance;
  try {
    instance = await factory.create({
      record: {id: 'clip', contextId: context.id, plugin: {id: factory.id, version: factory.version}, config: {}},
      context, signal: new AbortController().signal,
      asset: () => undefined, resolveAsset: async () => clip,
    });
    assert.equal(context.registry.get('clip'), instance.module, `${format}: loader asset is admitted by Bridge`);
    assert.equal(audio.peek(), undefined, `${format}: project factory remains lazy`);
  } finally {
    try {
      instance?.dispose();
      assert.equal(context.registry.get('clip'), undefined, `${format}: disposal releases the registration`);
    } finally {
      context.registry.dispose();
      audio.dispose();
    }
  }
}

console.log('  Audio WAV loading and Bridge project asset admission run from installed tarballs in ESM and CommonJS');
