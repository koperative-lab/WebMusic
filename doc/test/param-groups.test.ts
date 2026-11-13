import {describe, expect, it} from 'vitest';
import {ELEMENT_PARAMS, paramGroup} from '../src/lib/params';

// The three groups a tool such as the component library shows apart. The
// expectations pin the name rule against attributes it must not misfile.
const groupOf = (tag: string, name: string) => {
  const param = ELEMENT_PARAMS[tag]?.params.find((candidate) => candidate.name === name);
  if (!param) throw new Error(`<${tag}> has no ${name}`);
  return paramGroup(param);
};

describe('parameter groups', () => {
  it('files sources, links, sessions and ids as data', () => {
    for (const [tag, name] of [['score-player', 'src'], ['score-player', 'session'], ['score-rack-part', 'id'], ['score-view', 'input'],
      ['score-effect', 'target'], ['audio-meter', 'port'], ['audio-view', 'peaks-src'], ['audio-recorder', 'device-id']] as const) {
      expect(groupOf(tag, name), `${tag} ${name}`).toBe('data');
    }
  });

  it('files appearance-only attributes as style', () => {
    for (const [tag, name] of [['score-view', 'note-color'], ['score-view', 'height'], ['audio-view', 'wave-color'], ['audio-view', 'amplitude'],
      ['audio-view', 'color'], ['audio-meter', 'theme'], ['score-pitch-view', 'white-key-width'], ['score-chord-analysis', 'scheme']] as const) {
      expect(groupOf(tag, name), `${tag} ${name}`).toBe('style');
    }
  });

  it('keeps behaviour, types and musical choices as param', () => {
    for (const [tag, name] of [['score-view', 'type'], ['score-note-input', 'map'], ['score-player', 'volume'], ['score-effect', 'wet'],
      ['audio-view', 'pixels-per-second'], ['audio-meter', 'mode'], ['score-scale-analysis', 'tonic']] as const) {
      expect(groupOf(tag, name), `${tag} ${name}`).toBe('param');
    }
  });

  it('lets a catalog entry override the name rule', () => {
    expect(paramGroup({name: 'height', kind: 'number', note: 'Rows of data.', group: 'param'})).toBe('param');
  });
});
