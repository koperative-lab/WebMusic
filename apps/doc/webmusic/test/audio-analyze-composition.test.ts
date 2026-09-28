import {readFileSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {AUDIO_ANALYZE_PARAMS} from '../src/lib/params/audio-analyze';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tags = [
  'audio-meter',
  'audio-level-analyzer',
  'audio-spectrum-analyzer',
  'audio-oscilloscope',
  'audio-transient-analyzer',
] as const;
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const mp3 = '/mp3/Arabesque%20No.1.mp3';

describe('Audio Analyze live-tool demos', () => {
  it('documents exactly the task-specific Element tags', () => {
    expect(Object.keys(AUDIO_ANALYZE_PARAMS)).toEqual(tags);
    const inventory = read('src/content/docs/audio/element/index.mdx');
    const analyze = inventory.split('## Analyze\n')[1]?.split('## View\n')[0];
    expect(analyze).toBeDefined();
    for (const tag of tags) expect(analyze).toContain(`<${tag}>`);
    expect(analyze).not.toContain('<audio-tuner>');
    expect(inventory).not.toContain('<audio-analysis>');
    expect(inventory).not.toContain('<audio-onset-analysis>');
    expect(inventory).not.toContain('<audio-beat-analysis>');
    expect(inventory).not.toContain('<audio-pitch-analysis>');
  });

  it.each(tags)('%s pairs one real player with the isolated analysis surface', (tag) => {
    const page = read(`src/content/docs/audio/element/analyze/${tag}.mdx`);
    expect(page).toContain(`<AudioAnalyzeFeaturePlayground tag="${tag}" />`);
    expect(page).toContain(`<audio-player id="session" src="${mp3}"`);
    expect(page).toContain(`<${tag} player="#session"`);
  });

  it('copies the complete player/companion composition and registers real tags', () => {
    const demo = read('src/components/elements/AudioAnalyzeFeaturePlayground.astro');
    expect(demo).toContain('markup="[data-demo-composition]"');
    expect(demo).toContain('<ElementComposition>');
    expect(demo.match(/<audio-player\b/g)).toHaveLength(1);
    for (const tag of tags) expect(demo).toContain(`<${tag} player={`);
    expect(demo).toContain('defineAudioPlayerElement()');
    expect(demo).toContain('defineAllAudioElements()');
    expect(demo).not.toContain('<audio-analysis ');
    expect(demo).toContain('mp3/Arabesque%20No.1.mp3');
    expect(statSync(resolve(root, 'public/mp3/Arabesque No.1.mp3')).size).toBeGreaterThan(0);
    expect(statSync(resolve(root, 'public/wav/Arabesque No.1.wav')).size).toBeGreaterThan(0);
  });
});
