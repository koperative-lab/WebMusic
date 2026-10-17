import {strToU8, zipSync} from 'fflate';
import {loadScore, parseMusicXML} from '../src/io';

/** Original deterministic notation exercise, not an arrangement of a published work. */
export function notationStudyXml(measureCount = 64): string {
  const measures = Array.from({length: measureCount}, (_, bar) => {
    const initial = bar === 0 ? `<divisions>6</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>
      <clef number="1"><sign>G</sign><line>2</line></clef>
      <clef number="2"><sign>G</sign><line>2</line></clef>` : '';
    const change = bar > 0 && bar % 16 === 0
      ? `<clef number="2"><sign>${bar % 32 === 0 ? 'G' : 'F'}</sign><line>${bar % 32 === 0 ? 2 : 4}</line></clef>` : '';
    const attributes = initial || change ? `<attributes>${initial}${change}</attributes>` : '';
    const staves = [1, 2].map((staff) => Array.from({length: 12}, (_, index) => {
      const groupPosition = index % 3;
      const endpoint = groupPosition === 0 ? 'start' : groupPosition === 2 ? 'stop' : undefined;
      const rest = staff === 1 && index === 0 && [4, 8, 12].includes(bar);
      const pitch = rest
        ? `<rest><display-step>${bar === 4 ? 'E' : 'F'}</display-step><display-octave>${bar === 4 ? 4 : 5}</display-octave></rest>`
        : `<pitch><step>${['C', 'E', 'G', 'D', 'F', 'A', 'E'][((bar * 2) + index + staff) % 7]}</step><octave>${staff === 1 ? 5 : 4}</octave></pitch>`;
      const articulation = index === 0 ? 'staccato' : index === 3 ? 'tenuto' : index === 6 ? 'accent' : undefined;
      const notation = `${endpoint ? `<tuplet type="${endpoint}" number="1" bracket="no" show-number="${index < 3 ? 'none' : 'actual'}" placement="below"/>
        <slur type="${endpoint}" number="1" placement="above"/>` : ''}${articulation ? `<articulations><${articulation}/></articulations>` : ''}`;
      return `<note>${pitch}<duration>2</duration><voice>${staff}</voice><type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
        <stem>${staff === 1 ? 'up' : 'down'}</stem><staff>${staff}</staff>
        <beam number="1">${groupPosition === 0 ? 'begin' : groupPosition === 2 ? 'end' : 'continue'}</beam>
        ${notation ? `<notations>${notation}</notations>` : ''}</note>`;
    }).join('')).join('<backup><duration>24</duration></backup>');
    const directions = `<direction placement="above"><direction-type><words font-style="italic">Study ${bar + 1}</words></direction-type><staff>1</staff></direction>
      <direction><direction-type><dynamics><${bar % 2 === 0 ? 'p' : 'mf'}/></dynamics></direction-type><staff>1</staff></direction>
      <direction><direction-type><pedal type="start" line="yes"/></direction-type><staff>2</staff></direction>
      <direction><direction-type><wedge type="crescendo" number="1"/></direction-type><staff>1</staff></direction>`;
    const endings = `<direction><direction-type><pedal type="stop" line="yes"/></direction-type><staff>2</staff></direction>
      <direction><direction-type><wedge type="stop" number="1"/></direction-type><staff>1</staff></direction>`;
    const barline = bar === measureCount - 1 ? 'light-heavy' : [15, 31].includes(bar) ? 'light-light' : undefined;
    return `<measure number="${bar + 1}">${attributes}${bar === 0 ? '<sound tempo="120"/>' : ''}${directions}${staves}${endings}
      ${barline ? `<barline location="right"><bar-style>${barline}</bar-style></barline>` : ''}</measure>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">
    <work><work-title>WebMusic Notation Stress Study</work-title></work>
    <identification><creator type="composer">WebMusic Contributors</creator></identification>
    <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
    <part id="P1">${measures}</part></score-partwise>`;
}

export function loadNotationStudyFixture(measureCount = 64) {
  return parseMusicXML(notationStudyXml(measureCount));
}

export function loadNotationStudyMxlFixture() {
  const archive = zipSync({
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>'),
    'score.musicxml': strToU8(notationStudyXml()),
  }, {level: 6, mtime: new Date('2000-01-01T00:00:00Z')});
  return loadScore(archive, {format: 'mxl'});
}

/** Original large-score rendering fixture; notation fidelity is exercised above. */
export function largeScoreStudyXml(): string {
  const measures = Array.from({length: 96}, (_, bar) => {
    const attributes = bar === 0 ? `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
      <staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <sound tempo="120"/>` : '';
    const staves = [1, 2].map((staff) => Array.from({length: 4}, (_, beat) => [0, 1].map((tone) =>
      `<note>${tone === 1 ? '<chord/>' : ''}<pitch><step>${['C', 'D', 'E', 'F', 'G', 'A', 'B'][(bar + beat + tone * 2) % 7]}</step>
        <octave>${staff === 1 ? 5 : 3}</octave></pitch><duration>1</duration><voice>${staff}</voice><type>quarter</type><staff>${staff}</staff></note>`,
    ).join('')).join('')).join('<backup><duration>4</duration></backup>');
    return `<measure number="${bar + 1}">${attributes}${staves}</measure>`;
  }).join('');
  return `<score-partwise version="4.0"><work><work-title>WebMusic Large Score Study</work-title></work>
    <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
    <part id="P1">${measures}</part></score-partwise>`;
}
