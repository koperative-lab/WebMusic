// @vitest-environment jsdom

import {describe, expect, it, vi} from 'vitest';
import {
  ANALYSIS_SPAN_SELECTOR,
  analysisStyle,
  createAnalysisPlayhead,
  createAnalysisRoot,
  readAnalysisIdleStyle,
  readAnalysisSpans,
  renderAudioAnalysisCard,
  renderChordTimeline,
  renderHistogram,
  renderKeyView,
  type AudioAnalysisCardResult,
  type AnalysisText,
  renderLiveChordPanel,
  renderRhythmPatternList,
  renderMotifList,
  renderRomanStrip,
  renderSummaryCard,
  renderVoiceLeadingList,
} from '../src/analysis';

describe('analysis surface', () => {
  it('shares the canonical surface between exported CSS and inline roots', () => {
    const root = createAnalysisRoot(document);

    for (const property of ['background', 'border', 'padding', 'border-radius']) {
      expect(root.style.getPropertyValue(property)).toContain('--wm-analysis-surface-');
    }
    expect(root.style.background).toContain('--wm-component-background');
    expect(root.style.color).toContain('--wm-foreground');
    expect(analysisStyle).toContain('--wm-analysis-surface-background');
    expect(analysisStyle).toContain('--wm-component-background');
  });

  it('uses the shared light control edge for timeline rows and chips', () => {
    const timeline = createAnalysisRoot(document);
    renderChordTimeline(
      [{chord: 'C', startQuarters: 0, endQuarters: 4}],
      timeline,
    );

    const roman = createAnalysisRoot(document);
    renderRomanStrip(
      {tonic: 'C', mode: 'major', confidence: 1, scores: []},
      [{chord: 'C', roman: 'I', startQuarters: 0, endQuarters: 4}],
      roman,
    );

    const live = createAnalysisRoot(document);
    renderLiveChordPanel(live).paint({chord: 'C', midis: [60, 64, 67], history: ['C']});

    const bordered = [
      timeline.querySelector<HTMLElement>('li')!,
      roman.querySelector<HTMLElement>('[data-start-quarters]')!,
      live.querySelector<HTMLElement>('span:last-child')!,
    ];
    for (const node of bordered) {
      expect(node.style.cssText).toContain('--wm-control-border');
      expect(node.style.cssText).toContain('#d8d8d8');
    }
  });
});

describe('analysis playhead-follow contract', () => {
  it('exposes chord-timeline rows through the span selector and reader', () => {
    const root = createAnalysisRoot(document);
    renderChordTimeline(
      [
        {chord: 'C', startQuarters: 0, endQuarters: 4},
        {chord: 'G', startQuarters: 4, endQuarters: 8},
      ],
      root,
    );
    const rows = [...root.querySelectorAll<HTMLElement>(ANALYSIS_SPAN_SELECTOR)];
    expect(rows).toHaveLength(2);
    expect(readAnalysisSpans(rows[0])).toEqual([{startQuarters: 0, endQuarters: 4}]);
    expect(readAnalysisSpans(rows[1])).toEqual([{startQuarters: 4, endQuarters: 8}]);
    for (const row of rows) {
      expect(readAnalysisIdleStyle(row)).toBeTruthy();
      expect(row.style.cssText.length).toBeGreaterThan(0);
    }
  });

  it('exposes every motif occurrence as its own span', () => {
    const root = createAnalysisRoot(document);
    renderMotifList(
      [{intervals: [2, 2], rhythm: [1, 1, 1], occurrences: [{startQuarters: 0}, {startQuarters: 8}]}],
      root,
    );
    const rows = [...root.querySelectorAll<HTMLElement>(ANALYSIS_SPAN_SELECTOR)];
    expect(rows).toHaveLength(1);
    expect(readAnalysisSpans(rows[0])).toEqual([
      {startQuarters: 0, endQuarters: 3},
      {startQuarters: 8, endQuarters: 11},
    ]);
  });

  it('gives voice-leading rows at least a one-quarter span', () => {
    const root = createAnalysisRoot(document);
    renderVoiceLeadingList(
      [{type: 'parallel-fifths', severity: 'warning', voices: ['s', 'a'], startQuarters: 2, endQuarters: 2}],
      root,
    );
    const rows = [...root.querySelectorAll<HTMLElement>(ANALYSIS_SPAN_SELECTOR)];
    expect(readAnalysisSpans(rows[0])).toEqual([{startQuarters: 2, endQuarters: 3}]);
  });

  it('reads no spans from nodes outside the contract', () => {
    const stray = document.createElement('div');
    expect(readAnalysisSpans(stray)).toEqual([]);
    expect(readAnalysisIdleStyle(stray)).toBeUndefined();
  });

  it('owns active styling, ARIA, scrolling and rewritten-span cache invalidation', () => {
    const root = createAnalysisRoot(document);
    renderMotifList(
      [
        {intervals: [2], rhythm: [2], occurrences: [{startQuarters: 0}]},
        {intervals: [-2], rhythm: [2], occurrences: [{startQuarters: 2}]},
      ],
      root,
    );
    const rows = [...root.querySelectorAll<HTMLElement>(ANALYSIS_SPAN_SELECTOR)];
    let firstScrolls = 0;
    let secondScrolls = 0;
    rows[0]!.scrollIntoView = () => { firstScrolls += 1; };
    rows[1]!.scrollIntoView = () => { secondScrolls += 1; };
    const playhead = createAnalysisPlayhead(root, {activeClassName: 'legacy-playing'});

    playhead.update(0.5);
    playhead.update(1.5);
    expect(rows[0]!.classList.contains('legacy-playing')).toBe(true);
    expect(rows[0]!.getAttribute('aria-current')).toBe('true');
    expect(rows[0]!.style.outline).toContain('2px');
    expect(firstScrolls).toBe(1);

    rows[0]!.dataset.spans = '8:10';
    playhead.update(2.5);
    expect(rows[0]!.classList.contains('legacy-playing')).toBe(false);
    expect(rows[0]!.hasAttribute('aria-current')).toBe(false);
    expect(rows[1]!.classList.contains('legacy-playing')).toBe(true);
    expect(secondScrolls).toBe(1);

    playhead.clear();
    expect(rows.every((row) => !row.classList.contains('legacy-playing'))).toBe(true);
    playhead.destroy();
  });

  it('replaces a previous controller for the same root', () => {
    const root = createAnalysisRoot(document);
    renderChordTimeline([{chord: 'C', startQuarters: 0, endQuarters: 4}], root);
    const row = root.querySelector<HTMLElement>(ANALYSIS_SPAN_SELECTOR)!;
    const first = createAnalysisPlayhead(root);
    first.update(1);
    expect(row.classList.contains('is-playing')).toBe(true);

    const second = createAnalysisPlayhead(root, {scroll: false});
    expect(row.classList.contains('is-playing')).toBe(false);
    first.update(1);
    expect(row.classList.contains('is-playing')).toBe(false);
    second.update(1);
    expect(row.classList.contains('is-playing')).toBe(true);
  });
});

describe('analysis document ownership', () => {
  it('creates nodes in the document that owns the caller-supplied root', () => {
    const foreign = document.implementation.createHTMLDocument('foreign');
    const root = createAnalysisRoot(foreign);
    expect(root.ownerDocument).toBe(foreign);
    renderChordTimeline([{chord: 'C', startQuarters: 0, endQuarters: 4}], root);
    renderAudioAnalysisCard('loudness', {loudness: {integratedLufs: -14, truePeakDb: -1, rms: 0.1}}, root);
    for (const node of root.querySelectorAll('*')) {
      expect(node.ownerDocument).toBe(foreign);
    }
  });
});

describe('renderHistogram', () => {
  it('scales bars against the largest bin', () => {
    const root = createAnalysisRoot(document);
    renderHistogram([
      {label: 'C', value: 10},
      {label: 'D', value: 5},
      {label: 'E', value: 0},
    ], root);

    const fills = [...root.querySelectorAll<HTMLElement>('span > span')];
    expect(fills).toHaveLength(3);
    expect(fills[0]!.style.width).toBe('100%');
    expect(fills[1]!.style.width).toBe('50%');
    expect(fills[2]!.style.width).toBe('0%');
  });

  it('renders flat rather than dividing by zero when every bin is empty', () => {
    const root = createAnalysisRoot(document);
    renderHistogram([{label: 'C', value: 0}, {label: 'D', value: 0}], root);

    const fills = [...root.querySelectorAll<HTMLElement>('span > span')];
    expect(fills.every((fill) => fill.style.width === '0%')).toBe(true);
  });

  it('shows the empty label for an empty bin list', () => {
    const root = createAnalysisRoot(document);
    renderHistogram([], root, {emptyLabel: 'Nothing here.'});

    expect(root.textContent).toContain('Nothing here.');
    expect(root.querySelector('.wui-analysis__histogram')).toBeNull();
  });

  it('formats values through the supplied formatter', () => {
    const root = createAnalysisRoot(document);
    renderHistogram([{label: 'C', value: 1234.567}], root, {
      format: (value) => `${Math.round(value)}t`,
    });

    expect(root.textContent).toContain('1235t');
  });
});

describe('renderSummaryCard', () => {
  it('renders a title and a definition row per fact', () => {
    const root = createAnalysisRoot(document);
    renderSummaryCard(
      {
        title: 'Prelude',
        subtitle: 'J. S. Bach',
        rows: [
          {label: 'Key', value: 'C major'},
          {label: 'Notes', value: '544'},
        ],
      },
      root,
    );

    expect(root.querySelector('.wui-analysis__title')?.textContent).toBe('Prelude');
    expect(root.textContent).toContain('J. S. Bach');
    const list = root.querySelector('dl')!;
    expect([...list.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual(['Key', 'Notes']);
    expect([...list.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual(['C major', '544']);
  });

  it('omits the subtitle when there is none', () => {
    const root = createAnalysisRoot(document);
    renderSummaryCard({title: 'Untitled', rows: [{label: 'Notes', value: '0'}]}, root);

    expect(root.textContent).toContain('Untitled');
    expect(root.querySelectorAll('dt')).toHaveLength(1);
  });
});

describe('renderRhythmPatternList', () => {
  it('renders one row per figure with counts and occurrence spans', () => {
    const root = createAnalysisRoot(document);
    renderRhythmPatternList([
      {pattern: [1, 1, 0.5, 0.5], count: 3, onsets: [0, 4, 8]},
      {pattern: [2, 2], count: 1, onsets: [12]},
    ], root);

    const rows = [...root.querySelectorAll<HTMLElement>('.wui-analysis__rhythms > li')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('×3');
    // Spans end at onset + the figure's total length (3 quarters here).
    expect(rows[0]!.dataset.spans).toBe('0:3 4:7 8:11');
  });

  it('falls back to the number for a non-dyadic duration', () => {
    const root = createAnalysisRoot(document);
    renderRhythmPatternList([{pattern: [0.333], count: 2, onsets: [0, 1]}], root);

    expect(root.textContent).toContain('0.333');
  });

  it('shows an empty message when nothing recurs', () => {
    const root = createAnalysisRoot(document);
    renderRhythmPatternList([], root);

    expect(root.textContent).toContain('No repeated rhythms found.');
    expect(root.querySelector('.wui-analysis__rhythms')).toBeNull();
  });
});

describe('interactive histogram controls', () => {
  it('preserves keyboard focus while active bins update and releases detached controls', () => {
    const root = createAnalysisRoot(document);
    document.body.append(root);
    const selected: number[] = [];
    const handle = renderHistogram([{label: 'A', value: 2}, {label: 'B', value: 0}], root, {
      onSelect: (index) => { selected.push(index); },
    });
    const [first, empty] = [...root.querySelectorAll<HTMLButtonElement>('button')];
    first!.focus();
    handle.setActive([0]);
    expect(document.activeElement).toBe(first);
    expect(first!.getAttribute('aria-current')).toBe('true');
    expect(empty!.disabled).toBe(true);
    first!.click();
    expect(selected).toEqual([0]);
    handle.setActive([]);
    expect(first!.hasAttribute('aria-current')).toBe(false);
    handle.destroy();
    handle.destroy();
    first!.click();
    expect(selected).toEqual([0]);
    expect(root.children).toHaveLength(0);
    root.remove();
  });
});

describe('analysis application text', () => {
  it('reads final key text at render time, with no automatic rerender', () => {
    let copy: AnalysisText = {keyName: ({tonic, mode}) => `${tonic}调${mode}`, confidence: ({value}) => `可信度 ${value}`};
    const root = createAnalysisRoot(document);
    const getText = () => copy;
    renderKeyView({tonic: 'C', mode: 'major', confidence: .8, scores: [{tonic: 'G', mode: 'major', score: .2}]}, root, 'Caption', {
      getText, formatters: {percent: value => `百分之${value * 100}`},
    });
    expect(root.textContent).toContain('CaptionC调major可信度 百分之80G调major');
    expect(root.querySelector<HTMLElement>('span > span')?.style.width).toBe('100%');
    copy = {noNotes: '{literal}'};
    expect(root.textContent).toContain('C调major');
    root.replaceChildren();
    renderKeyView(undefined, root, undefined, {getText});
    expect(root.textContent).toBe('—{literal}');
  });

  it('gives count callbacks raw numbers while preserving numeric playhead spans', () => {
    const copy: AnalysisText = {
      beat: ({value}) => `第${value}拍`, inKey: ({tonic, mode}) => `${tonic}调式${mode}`,
      count: ({count, value}) => count === 1 ? `${value}次` : `${value}多次`,
      intervals: ({values}) => `音程 ${values}`, quarters: ({value}) => `${value}四分音符`,
      voiceIssue: ({type}) => type === 'parallel-fifths' ? '平行五度' : type,
      issueLocation: ({voices, beat}) => `${voices}；${beat}`,
    };
    const options = {getText: () => copy, formatters: {number: (value: number) => `[${value}]`}};
    const root = createAnalysisRoot(document);
    renderChordTimeline([{chord: 'C', startQuarters: 1, endQuarters: 3}], root, options);
    renderRomanStrip({tonic: 'C', mode: 'major', confidence: 1, scores: []}, [], root, options);
    renderMotifList([{intervals: [2], rhythm: [1], occurrences: [{startQuarters: 4}]}], root, options);
    renderRhythmPatternList([{pattern: [1, .5], count: 2, onsets: [5]}], root, options);
    renderVoiceLeadingList([{type: 'parallel-fifths', severity: 'warning', voices: ['S', 'A'], startQuarters: 7, endQuarters: 8}], root, options);
    expect(root.textContent).toContain('第[2]拍');
    expect(root.textContent).toContain('C调式major');
    expect(root.textContent).toContain('[1]次音程 [2]');
    expect(root.textContent).toContain('[2]多次[1] [0.5][1.5]四分音符');
    expect(root.textContent).toContain('平行五度S / A；第[8]拍');
    expect([...root.querySelectorAll<HTMLElement>('[data-spans]')].map(node => node.dataset.spans)).toEqual(['4:5', '5:6.5']);
    expect(readAnalysisSpans(root.querySelector('[data-start-quarters]')!)).toEqual([{startQuarters: 1, endQuarters: 3}]);
  });

  it('reads latest application text on live paint and preserves explicit pitch formatting', () => {
    let copy: AnalysisText = {};
    const root = createAnalysisRoot(document);
    const panel = renderLiveChordPanel(root, {getText: () => copy, formatPitch: midi => `note-${midi}`});
    copy = {soundingNow: '当前发声', waiting: '等待播放'};
    panel.paint({chord: '', midis: [], history: []});
    expect(root.textContent).toBe('当前发声—等待播放');
    panel.paint({chord: 'C', midis: [60], history: ['C']});
    expect(root.textContent).toContain('note-60');
  });

  const audio: AudioAnalysisCardResult = {
    key: {tonic: 'C', mode: 'major', confidence: .8},
    tempo: {bpm: 120, confidence: .7, grid: {beats: [0, 1]}},
    loudness: {integratedLufs: -14, truePeakDb: -1, rms: .1},
    onsets: [1, 2], pitchTrack: {frequencies: [220, 440], times: [0, 1]},
  };
  it('renders supplied audio units and counts without changing time/pitch geometry', () => {
    const copy: AnalysisText = {
      tempo: ({value}) => `${value}拍每分`, tempoDetails: ({confidence, value}) => `${confidence}；${value}拍`,
      integrated: '综合', truePeak: '真峰值', rms: '均方根',
      lufs: ({value}) => `${value}响度`, dbfs: ({value}) => `${value}峰值单位`,
      onsets: ({value}) => `${value}起音`, pitchRange: ({minimum, maximum}) => `${minimum}至${maximum}赫兹`,
    };
    const options = {getText: () => copy, formatters: {number: (value: number) => `N${value}`, percent: (value: number) => `P${value}`}};
    const root = createAnalysisRoot(document);
    renderAudioAnalysisCard('tempo', audio, root, options);
    expect(root.textContent).toBe('N120拍每分P0.7；N2拍');
    renderAudioAnalysisCard('loudness', audio, root, options);
    expect(root.textContent).toBe('综合N-14响度真峰值N-1峰值单位均方根N0.1');
    renderAudioAnalysisCard('onsets', audio, root, {...options, durationSeconds: 4});
    expect(root.textContent).toBe('N2起音');
    expect([...root.querySelectorAll('span')].map(node => node.style.left)).toEqual(['25%', '50%']);
    renderAudioAnalysisCard('pitch', audio, root, options);
    expect(root.textContent).toBe('N220至N440赫兹');
    expect(root.querySelector('path')?.getAttribute('d')).toBe('M0.0 48.0 L240.0 0.0');
  });

  it.each([
    ['key', 'keyUnavailable'], ['tempo', 'tempoUnavailable'], ['onsets', 'onsetsUnavailable'], ['pitch', 'pitchUnavailable'],
  ] as const)('uses the application missing-%s label', (type, field) => {
    const root = renderAudioAnalysisCard(type, {loudness: audio.loudness}, undefined, {getText: () => ({[field]: '尚未分析'})});
    expect(root.textContent).toBe('尚未分析');
  });

  it('explicitly updates histogram text with focus, active bins and selection intact', () => {
    let copy: AnalysisText = {};
    let prefix = '';
    const root = createAnalysisRoot(document);
    document.body.append(root);
    const onSelect = vi.fn();
    const getText = vi.fn(() => copy);
    const handle = renderHistogram([{label: 'C', value: 2}, {label: 'D', value: 1}], root, {
      getText, onSelect, formatters: {number: value => `${prefix}${value}`},
    });
    const button = root.querySelector('button')!;
    button.focus();
    handle.setActive([0]);
    copy = {histogramSelect: ({label, value}) => `${label}，${value}，跳至下一处`}; prefix = '数';
    expect(button.getAttribute('aria-label')).toBe('C: 2. Go to next occurrence');
    handle.update();
    expect(root.querySelector('button')).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-current')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('C，数2，跳至下一处');
    expect(root.textContent).toContain('C数2D数1');
    button.click();
    expect(onSelect).toHaveBeenCalledWith(0, {label: 'C', value: 2});
    handle.destroy();
    getText.mockClear();
    handle.update(); button.click();
    expect(getText).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledOnce();
    expect(root.childElementCount).toBe(0);
    root.remove();
  });

  it('preserves histogram explicit overrides and contains reentrant destruction', () => {
    let copy: AnalysisText = {};
    const getText = () => copy;
    const root = createAnalysisRoot(document);
    const empty = renderHistogram([], root, {getText, emptyLabel: 'Application empty'});
    copy = {histogramEmpty: 'Ignored'}; empty.update();
    expect(root.textContent).toBe('Application empty'); empty.destroy();
    const handle = renderHistogram([{label: 'C', value: 2}], root, {getText, format: value => `${value} own`, onSelect() {}});
    const button = root.querySelector('button')!;
    expect(root.textContent).toBe('C2 own');
    copy = {histogramSelect: () => { handle.destroy(); return 'Stale'; }}; handle.update();
    expect(root.childElementCount).toBe(0);
    expect(button.getAttribute('aria-label')).not.toBe('Stale');
  });

  it.each([false, true])('refreshes retained histogram labels with selectable=%s', (selectable) => {
    const root = createAnalysisRoot(document);
    document.body.append(root);
    const bins = [{label: 'Major', value: 2}, {label: 'Minor', value: 1}];
    const onSelect = selectable ? vi.fn() : undefined;
    const handle = renderHistogram(bins, root, {onSelect});
    const rows = [...root.querySelector('.wui-analysis__histogram')!.children];
    const labels = rows.map(row => row.firstElementChild as HTMLElement);
    if (selectable) {
      labels[0]!.focus();
      handle.setActive([0]);
    }

    bins[0]!.label = '大调';
    bins[1]!.label = '小调';
    expect(labels.map(label => label.textContent)).toEqual(['Major', 'Minor']);
    handle.update();

    expect([...root.querySelector('.wui-analysis__histogram')!.children]).toEqual(rows);
    expect(rows.map(row => row.firstElementChild)).toEqual(labels);
    expect(labels.map(label => label.textContent)).toEqual(['大调', '小调']);
    if (selectable) {
      expect(document.activeElement).toBe(labels[0]);
      expect(labels[0]!.getAttribute('aria-current')).toBe('true');
      expect(labels[0]!.getAttribute('aria-label')).toBe('大调: 2. Go to next occurrence');
      labels[0]!.click();
      expect(onSelect).toHaveBeenCalledWith(0, bins[0]);
    } else {
      expect(labels.every(label => label.tagName === 'SPAN')).toBe(true);
    }
    handle.destroy();
    root.remove();
  });

  it('keeps histogram order and numeric presentation at the mounted snapshot', () => {
    const root = createAnalysisRoot(document);
    const first = {label: 'Major', value: 2};
    const second = {label: 'Minor', value: 1};
    const bins = [first, second];
    const handle = renderHistogram(bins, root, {onSelect() {}});
    const rows = [...root.querySelector('.wui-analysis__histogram')!.children];
    const widths = rows.map(row => (row.children[1]!.firstElementChild as HTMLElement).style.width);

    first.label = '大调';
    first.value = 0;
    bins.reverse();
    bins.push({label: 'Other', value: 10});
    handle.update();

    expect(root.textContent).toBe('大调2Minor1');
    expect(root.querySelectorAll('button')).toHaveLength(2);
    expect((rows[0]!.firstElementChild as HTMLButtonElement).disabled).toBe(false);
    expect(rows.map(row => (row.children[1]!.firstElementChild as HTMLElement).style.width)).toEqual(widths);
    handle.destroy();
  });
});

describe('analysis application formatting failures', () => {
  it('reports failing number callbacks in one-shot and live paints and keeps defaults', () => {
    const failure = new Error('Application number format');
    const onError = vi.fn();
    const options = {formatters: {number: () => { throw failure; }}, onError};
    const root = createAnalysisRoot(document);
    renderRhythmPatternList([{pattern: [1], count: 2, onsets: [0]}], root, options);
    expect(root.textContent).toContain('×21');
    expect(onError).toHaveBeenCalledWith(failure);
    onError.mockClear();
    root.replaceChildren();
    const panel = renderLiveChordPanel(root, options);
    panel.paint({chord: 'C', midis: [60], history: []});
    expect(root.textContent).toContain('60');
    expect(onError).toHaveBeenCalledWith(failure);
  });
});
