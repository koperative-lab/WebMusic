// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {Rational} from '../../src/core';
import {parseMusicXML, serializeMusicXML} from '../../src/io';

// Independently authored MusicXML: playback-only tempos and a slur spanning
// three complete measures. No generated notation or third-party score asset.
const tempoScore = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <sound tempo="120"/>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><notations><slur type="start" number="1"/></notations></note>
    </measure>
    <measure number="2">
      <sound tempo="90"><offset>8</offset></sound>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="3">
      <sound tempo="60"/>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><notations><slur type="stop" number="1"/></notations></note>
    </measure>
  </part>
</score-partwise>`;

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('round-trips sound offsets without creating visual directions', () => {
  let score = parseMusicXML(tempoScore);
  for (let round = 0; round < 3; round += 1) {
    expect(score.parts[0]!.directions).toEqual([]);
    expect(score.timeMap.tempoAt(new Rational(5)).bpm).toBe(120);
    expect(score.timeMap.tempoAt(new Rational(6)).bpm).toBe(90);
    expect(score.timeMap.tempoAt(new Rational(8)).bpm).toBe(60);
    const xml = serializeMusicXML(score);
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    expect(document.querySelectorAll('direction')).toHaveLength(0);
    expect(document.querySelectorAll('measure > sound')).toHaveLength(3);
    expect(document.querySelector('sound[tempo="90"] > offset')?.textContent).toBe('960');
    score = parseMusicXML(xml);
  }
});

it('uses signed sound offsets and lets sound override its enclosing direction offset', () => {
  const xml = tempoScore.replace('<sound tempo="90"><offset>8</offset></sound>', '');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const measure = document.querySelector('measure[number="2"]')!;
  const additions = new DOMParser().parseFromString(`<measure>
    <sound tempo="90"><offset>-8</offset></sound>
    <direction><direction-type><words>change</words></direction-type><offset>-12</offset><sound tempo="60"><offset>-4</offset></sound></direction>
  </measure>`, 'application/xml');
  for (const child of [...additions.documentElement.children]) measure.append(document.importNode(child, true));
  const score = parseMusicXML(new XMLSerializer().serializeToString(document));
  expect(score.timeMap.tempoAt(new Rational(5)).bpm).toBe(120);
  expect(score.timeMap.tempoAt(new Rational(6)).bpm).toBe(90);
  expect(score.timeMap.tempoAt(new Rational(7)).bpm).toBe(60);
  expect(score.parts[0]!.directions?.[0]?.onsetQuarters.toFloat()).toBe(5);
});
