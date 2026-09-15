import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {scoreFromJSON} from '../../src/core';
import {parseMusicXML, parseMusicXMLDetailed, serializeMusicXML} from '../../src/io';

const opening = '<attributes><divisions>8</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>';
const note = '<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>half</type><staff>1</staff></note>';
function document(content: string, second = ''): string {
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part>${second ? '<score-part id="P2"><part-name>Viola</part-name></score-part>' : ''}</part-list><part id="P1"><measure number="1">${opening}${content}</measure></part>${second}</score-partwise>`;
}

describe('MusicXML timed notation', () => {
  it('retains each part and staff clef including changes after a backup inside the bar', () => {
    const xml = document(`${note}${note}<backup><duration>32</duration></backup>
      <forward><duration>12</duration></forward><attributes><clef number="2"><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef></attributes>
      <forward><duration>20</duration></forward>`,
    '<part id="P2"><measure number="1"><attributes><divisions>8</divisions><clef><sign>C</sign><line>3</line></clef></attributes><note><rest/><duration>32</duration><type>whole</type></note></measure></part>');
    const {score, diagnostics} = parseMusicXMLDetailed(xml);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'musicxml-mid-measure-clef-ignored')).toBe(false);
    for (const restored of [score, parseMusicXML(serializeMusicXML(score)), scoreFromJSON(score.toJSON())]) {
      expect(restored.parts[0].clefChanges?.map(({onsetQuarters, ...change}) => ({...change, at: onsetQuarters.toString()}))).toEqual([
        {at: '0', staff: 1, clef: {sign: 'G', line: 2}},
        {at: '0', staff: 2, clef: {sign: 'F', line: 4}},
        {at: '3/2', staff: 2, clef: {sign: 'G', line: 2, octaveChange: -1}},
      ]);
      expect(restored.parts[1].clefChanges?.map(({clef}) => clef)).toEqual([{sign: 'C', line: 3}]);
      expect(restored.parts[0].notes.map((value) => value.onsetQuarters.toString())).toEqual(['0', '2']);
      expect(restored.measures[0].durationQuarters.toString()).toBe('4');
    }
  });

  it('preserves positioned words, dynamics, tempo markings and pedal/hairpin endpoints through XML and JSON', () => {
    const xml = document(`
      <direction placement="above"><direction-type><words font-style="italic" font-weight="bold" font-size="12" default-x="-4" default-y="20" relative-x="2" relative-y="3">rit. &amp; dolce</words></direction-type><offset>-4</offset><staff>1</staff></direction>
      <direction placement="below"><direction-type><dynamics><pp/><other-dynamics>subito</other-dynamics></dynamics></direction-type><staff>2</staff></direction>
      <direction print-object="no"><direction-type><rehearsal>A</rehearsal></direction-type></direction>
      <direction><direction-type><metronome parentheses="yes"><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>72</per-minute></metronome></direction-type></direction>
      <direction placement="below"><direction-type><pedal type="start" number="2" line="yes" sign="yes"/></direction-type><staff>2</staff></direction>
      <direction placement="below"><direction-type><wedge type="crescendo" number="3" spread="0" niente="yes"/></direction-type><staff>2</staff></direction>
      ${note}
      <direction><direction-type><pedal type="change" number="2" line="yes"/></direction-type><offset>-2</offset><staff>2</staff></direction>
      ${note}
      <direction><direction-type><pedal type="stop" number="2" line="yes"/></direction-type><staff>2</staff></direction>
      <direction><direction-type><wedge type="stop" number="3" spread="15"/></direction-type><staff>2</staff></direction>`);
    const score = parseMusicXML(xml);
    expect(score.parts[0].directions?.map((direction) => direction.onsetQuarters.toString())).toEqual(['-1/2', '0', '0', '0', '0', '0', '7/4', '4', '4']);
    const json = score.toJSON().parts[0].directions;
    expect(json?.[0]).toMatchObject({kind: 'words', text: 'rit. & dolce', placement: 'above', staff: 1, fontStyle: 'italic', fontWeight: 'bold', fontSize: 12, defaultX: -4, defaultY: 20, relativeX: 2, relativeY: 3});
    expect(json?.[2]).toMatchObject({kind: 'rehearsal', text: 'A', printObject: false});
    expect(json?.[3]).toMatchObject({kind: 'metronome', beatUnit: {base: [1, 1], dots: 1, tuplet: [1, 1]}, perMinute: 72, parentheses: true});
    for (const restored of [parseMusicXML(serializeMusicXML(score)), scoreFromJSON(score.toJSON())]) {
      expect(restored.toJSON().parts[0].directions).toEqual(json);
      expect(restored.parts[0].notes.map((value) => value.onsetQuarters.toString())).toEqual(['0', '2']);
      expect(restored.measures[0].durationQuarters.toString()).toBe('4');
    }
  });

  it('keeps hidden tuplet numbers and authored tie placement', () => {
    const xml = document(`<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>half</type><tie type="start"/><notations><tied type="start" orientation="under"/><tuplet type="start" show-number="none"/></notations></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>half</type><tie type="stop"/><notations><tied type="stop" placement="above"/><tuplet type="stop" show-number="both"/></notations></note>`);
    const score = parseMusicXML(xml);
    for (const restored of [score, parseMusicXML(serializeMusicXML(score)), scoreFromJSON(score.toJSON())]) {
      expect(restored.parts[0].notes.map((value) => value.tiePlacement)).toEqual(['below', 'above']);
      expect(restored.parts[0].notes.map((value) => value.tupletMarks?.[0].showNumber)).toEqual(['none', 'both']);
    }
  });

  it('reports unsupported direction families instead of implying a lossless import', () => {
    const {diagnostics} = parseMusicXMLDetailed(document('<direction><direction-type><octave-shift type="up" size="8"/></direction-type></direction>' + note));
    expect(diagnostics).toContainEqual(expect.objectContaining({code: 'musicxml-direction-unsupported'}));
  });

  it('round-trips every clef and supported direction from the original study', () => {
    const xml = readFileSync(new URL('../../../../apps/doc/webmusic/public/xml/demo.xml', import.meta.url), 'utf8');
    const score = parseMusicXML(xml);
    const expected = score.toJSON().parts[0];
    for (const restored of [score, parseMusicXML(serializeMusicXML(score)), scoreFromJSON(score.toJSON())]) {
      const part = restored.parts[0];
      expect(part.clefChanges).toHaveLength(5);
      expect(Object.fromEntries(['pedal', 'wedge', 'words', 'dynamics'].map((kind) => [kind, part.directions?.filter((value) => value.kind === kind).length]))).toEqual({pedal: 16, wedge: 4, words: 4, dynamics: 2});
      expect(part.toJSON().clefChanges).toEqual(expected.clefChanges);
      expect(part.toJSON().directions).toEqual(expected.directions);
      expect(part.notes.flatMap((value) => value.tupletMarks ?? []).filter((mark) => mark.showNumber === 'none')).toHaveLength(128);
      expect(Object.fromEntries(['staccato', 'tenuto', 'accent'].map((type) => [type, part.notes.flatMap((value) => value.articulations ?? []).filter((mark) => mark === type).length]))).toEqual({staccato: 4, tenuto: 16, accent: 2});
      expect(restored.measures.filter((measure) => measure.barlineEnd).map((measure) => [measure.number, measure.barlineEnd])).toEqual([[4, 'light-light'], [8, 'light-light'], [12, 'light-light'], [16, 'light-heavy']]);
      expect(part.notes.filter((value) => value.restDisplay).map((value) => value.restDisplay)).toEqual([{step: 'E', octave: 4}, {step: 'F', octave: 5}, {step: 'F', octave: 5}]);
    }
  });

  it('preserves left/right bar styles, common articulations and rest placement', () => {
    const xml = document(`<barline location="left"><bar-style>heavy-light</bar-style></barline>
      <note><rest><display-step>F</display-step><display-octave>5</display-octave></rest><duration>8</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>quarter</type><notations><articulations><staccato/><accent/><tenuto/><strong-accent/><staccatissimo/></articulations></notations></note>
      <barline><bar-style>light-heavy</bar-style></barline>`);
    const score = parseMusicXML(xml);
    for (const restored of [score, parseMusicXML(serializeMusicXML(score)), scoreFromJSON(score.toJSON())]) {
      expect(restored.measures[0].barlineStart).toBe('heavy-light');
      expect(restored.measures[0].barlineEnd).toBe('light-heavy');
      expect(restored.parts[0].notes[0].restDisplay).toEqual({step: 'F', octave: 5});
      expect(restored.parts[0].notes[0].pitch).toBeUndefined();
      expect(restored.parts[0].notes[1].articulations).toEqual(['staccato', 'accent', 'tenuto', 'marcato', 'staccatissimo']);
    }
  });
});
