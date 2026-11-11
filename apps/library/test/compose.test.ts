import {describe, expect, it} from 'vitest';
import {composeApp, resolveSelection, snippet} from '../src/compose.ts';
import {LIBRARY} from '../src/catalog.ts';

const compose = (tags: readonly string[], overrides = {}) => composeApp(tags, {mediaBase: '/', overrides});
const tagsIn = (markup: string) => [...markup.matchAll(/<([a-z]+-[a-z-]+)/g)].map((match) => match[1]);

describe('app composition', () => {
  it('composes every element on its own into markup that contains it', () => {
    for (const entry of LIBRARY) {
      const composition = compose([entry.tag]);
      expect(tagsIn(composition.markup), entry.tag).toContain(entry.tag);
      // Every tag in the markup is defined by the script.
      const defined = [...composition.imports.values()].flat();
      for (const tag of new Set(tagsIn(composition.markup))) {
        expect(defined.length, tag).toBeGreaterThan(0);
        expect(composition.script, tag).toContain(LIBRARY.find((other) => other.tag === tag)!.recipe.define);
      }
    }
  });

  it('nests companions in the player that lends them time, one player per domain', () => {
    const {markup} = compose(['score-view', 'score-chord-analysis', 'audio-meter', 'audio-view']);
    expect(markup.match(/<score-player/g)).toHaveLength(1);
    expect(markup.match(/<audio-player/g)).toHaveLength(1);
    expect(markup).toMatch(/<score-player id="score" src="\/mxl\/Arabesque%20No\.1\.mxl"[^>]*>\n {2}<score-view/);
    expect(markup).toMatch(/<audio-player id="audio" src="\/wav\/Arabesque%20No\.1\.wav" controls>\n {2}<audio-view/);
  });

  it('plays MIDI unless a view needs authored notation', () => {
    expect(compose(['score-pitch-view']).markup).toContain('/midi/Arabesque%20No.1.mid');
    expect(snippet(compose(['score-grid-view']))).toContain('/midi/Arabesque%20No.1.mid');
    expect(snippet(compose(['score-grid-view', 'score-sheet-view']))).toContain('/mxl/Arabesque%20No.1.mxl');
  });

  it('adds what an element needs and reports it', () => {
    expect(resolveSelection(['score-recorder'])).toEqual({tags: ['score-note-input', 'score-recorder'], added: ['score-note-input']});
    expect(resolveSelection(['score-rack-part']).added).toEqual(['score-rack-control']);
    expect(resolveSelection(['not-a-tag', 'audio-player']).tags).toEqual(['audio-player']);
  });

  it('puts score companions in the lead part of a desk with one transport', () => {
    const {markup} = compose(['score-rack-control', 'score-view', 'score-note-input']);
    expect(markup.match(/<score-player/g)).toHaveLength(1);
    expect(markup).toMatch(/<score-rack-part id="lead"[^>]*>\n\s+<score-view/);
    expect(markup).toMatch(/<score-rack-part id="pad"/);
    expect(markup).toMatch(/<score-note-input id="keys"/);
  });

  it('leaves free elements standalone when nothing needs a player', () => {
    const {markup} = compose(['score-note-input']);
    expect(markup).not.toContain('<score-player');
    expect(markup.startsWith('<score-note-input')).toBe(true);
    // A synth panel edits a player's sound, so it always nests in one.
    expect(compose(['score-synth-panel']).markup).toMatch(/^<score-player id="score"[^>]*>\n {2}<score-synth-panel/);
  });

  it('taps a mixer’s master bus with meters and queues a playlist without a player source', () => {
    const mixed = compose(['audio-mixer', 'audio-spectrum-analyzer']).markup;
    expect(mixed).toContain('<audio-spectrum-analyzer input="#mix" port="master">');
    expect(mixed).not.toContain('<audio-player id="audio"');
    const queued = compose(['audio-playlist']).markup;
    expect(queued).toContain('<audio-player id="audio" controls>');
    expect(queued).toContain('src="/wav/Arabesque%20No.1.wav, /mp3/Arabesque%20No.1.mp3"');
  });

  it('applies Parameters overrides to the element and escapes values', () => {
    const {markup} = compose(['score-view'], {'score-view': {type: 'waterfall', 'note-color': 'a"b'}});
    expect(markup).toContain('<score-view type="waterfall" note-color="a&quot;b">');
    expect(compose(['audio-player'], {'audio-player': {controls: null}}).markup).toContain('<audio-player id="audio" src="/wav/Arabesque%20No.1.wav">');
  });

  it('uses only Arabesque No. 1 media', () => {
    const all = compose(LIBRARY.map((entry) => entry.tag));
    for (const match of all.markup.matchAll(/\/(midi|mxl|wav|mp3)\/([^"\s,]+)/g)) expect(match[2]).toMatch(/^Arabesque%20No\.1\./);
  });

  it('writes a docs-style snippet: the define script, then the markup', () => {
    const composition = compose(['audio-player', 'audio-meter']);
    const text = snippet(composition);
    expect(text.startsWith('<script type="module">')).toBe(true);
    expect(text).toContain("  import {defineAudioPlayerElement} from '@webmusic/audio/play/element';");
    expect(text).toContain("  import {defineAudioMeterElement} from '@webmusic/audio/analyze/element';");
    expect(text).toContain('<audio-player id="audio"');
    expect(snippet(compose([]))).toBe('');
  });
});

describe('editing views', () => {
  it('lends one score editor to the player and its editing views instead of a source', () => {
    const composition = compose(['score-grid-view', 'score-sheet-view', 'score-view']);
    expect(composition.markup).toMatch(/^<score-player id="score" time-control="full">/);
    expect(composition.markup).toContain('<score-grid-view editable>');
    expect(composition.markup).toContain('<score-sheet-view editable layout="flow">');
    expect(composition.editors).toEqual([{kind: 'score', url: '/mxl/Arabesque%20No.1.mxl', targets: ['#score', 'score-sheet-view', 'score-grid-view']}]);
    expect(composition.script).toContain("import {loadScoreEditor} from '@webmusic/score/view/headless';");
    expect(composition.script).toContain("const scoreEditor = await loadScoreEditor('/mxl/Arabesque%20No.1.mxl');");
    expect(composition.script).toContain("document.querySelectorAll('#score, score-sheet-view, score-grid-view')");
  });

  it('keeps editing views read-only inside a desk', () => {
    const composition = compose(['score-rack-control', 'score-grid-view']);
    expect(composition.editors).toEqual([]);
    expect(composition.markup).toContain('<score-grid-view></score-grid-view>');
  });

  it('gives the clip editor the audio player, or a player of its own beside a queue', () => {
    const edited = compose(['audio-clip-view', 'audio-meter']);
    expect(edited.markup).toMatch(/^<audio-player id="audio" controls>\n {2}<audio-clip-view editable><\/audio-clip-view>\n {2}<audio-meter>/);
    expect(edited.editors).toEqual([{kind: 'audio', url: '/wav/Arabesque%20No.1.wav', targets: ['#audio', 'audio-clip-view']}]);
    const queued = compose(['audio-playlist', 'audio-clip-view']);
    expect(queued.markup).toContain('<audio-player id="clip" controls>');
    expect(queued.editors[0]?.targets).toEqual(['#clip', 'audio-clip-view']);
  });
});

describe('linked analysis', () => {
  it('links Score analysis to its player by input, as a sibling', () => {
    const {markup} = compose(['score-view', 'score-interval-analysis']);
    expect(markup).toMatch(/<\/score-player>\n<score-interval-analysis input="#score" window="1"><\/score-interval-analysis>$/);
    expect(markup).not.toMatch(/<score-player[^]*<score-interval-analysis[^]*<\/score-player>/);
  });

  it('links to the lead part inside a desk', () => {
    expect(compose(['score-rack-control', 'score-chord-analysis']).markup).toContain('<score-chord-analysis input="#lead" window="1">');
  });

  it('shows an insert through a panel on its parameters', () => {
    expect(compose(['score-effect']).markup).toContain('<score-synth-panel target="#room" sections="effects">');
    expect(compose(['audio-effect']).markup).toContain('<score-synth-panel target="#filter" sections="effects">');
  });

  it('hides only the transports of players the selection does not name', () => {
    const bare = (tags: string[]) => composeApp(tags, {mediaBase: '/', bareHosts: true}).markup;
    expect(bare(['score-view'])).toContain('<score-player id="score" src="/mxl/Arabesque%20No.1.mxl" time-control="full" controls="hide">');
    expect(bare(['score-player'])).not.toContain('controls="hide"');
    expect(bare(['audio-meter'])).toContain('<audio-player id="audio" src="/wav/Arabesque%20No.1.wav" controls="hide">');
  });
});

describe('shared documents', () => {
  it('prefixes ids and references but keeps channel labels', () => {
    const composition = composeApp(['score-rack-control', 'score-recorder', 'score-effect', 'score-chord-analysis', 'audio-clip-view'], {mediaBase: '/', idPrefix: 'c7-'});
    const ids = [...composition.markup.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toEqual(expect.arrayContaining(['c7-score', 'c7-desk', 'lead', 'pad', 'c7-keys', 'c7-room', 'c7-audio']));
    for (const match of composition.markup.matchAll(/ (?:input|target)="#([^"]+)"/g)) expect(ids, match[1]).toContain(match[1]);
    expect(composition.editors.flatMap((step) => step.targets).filter((target) => target.startsWith('#'))).toEqual(['#c7-audio']);
  });
});
