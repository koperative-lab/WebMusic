import {defineAllElements} from '@webmusic/score/play/element';
import type {MountContext} from '../model';
import {addReadout, arabesqueUrl, every, reportErrors, setMarkup, stopPlayers, wireMonitoredInput} from './shared';

/** B1: three declared parts under one desk and one transport. */
export function mountRackParts(context: MountContext): () => void {
  defineAllElements();
  const midi = arabesqueUrl('midi');
  setMarkup(context.canvas, `
    <score-player time-control="full" aria-label="Rack transport">
      <score-rack-control mute solo>
        <score-rack-part id="lead" src="${midi}" sound="triangle"></score-rack-part>
        <score-rack-part id="bass" src="${midi}" sound="sawtooth"></score-rack-part>
        <score-rack-part id="pad" src="${midi}" sound="sine"></score-rack-part>
      </score-rack-control>
    </score-player>`);
  const stopErrors = reportErrors(context);
  return () => { stopErrors(); stopPlayers(context.canvas); };
}

interface DeskElement extends HTMLElement {
  module?: {list(): readonly {id: string; volume?: number; muted?: boolean}[]};
}

/** B2: a recorder inside a desk monitors and auditions on its own channel. */
export function mountRecorderInDesk(context: MountContext): () => void {
  defineAllElements();
  const midi = arabesqueUrl('midi');
  setMarkup(context.canvas, `
    <score-player time-control="full" aria-label="Desk transport">
      <score-rack-control id="mt-rec-desk" mute solo>
        <score-rack-part id="piano" src="${midi}"></score-rack-part>
        <score-note-input id="keys" layout="piano" start="60" end="72" keyboard routing="manual"></score-note-input>
        <score-recorder id="rec" quantize="0"></score-recorder>
      </score-rack-control>
    </score-player>`);
  const stopErrors = reportErrors(context);
  const desk = context.canvas.querySelector<DeskElement>('#mt-rec-desk')!;
  wireMonitoredInput(context.canvas.querySelector('#keys')!, context.canvas.querySelector('#rec')!);
  const channels = addReadout(context, {zh: '调音台通道', en: 'Desk channels'});
  every(context.signal, 250, () => {
    const list = desk.module?.list() ?? [];
    channels(list.length ? list.map((channel) => channel.muted ? `${channel.id} (muted)` : channel.id).join(' · ') : '—');
  });
  return () => { stopErrors(); stopPlayers(context.canvas); };
}
