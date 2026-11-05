import {readFileSync} from 'node:fs';
import {loadScore} from '../src/io';

export function loadArabesqueMxlFixture() {
  const bytes = readFileSync(new URL('../../../apps/doc/webmusic/public/mxl/Arabesque No.1.mxl', import.meta.url));
  return loadScore(bytes, {format: 'mxl'});
}
