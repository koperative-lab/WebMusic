// @vitest-environment node

import {readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

/**
 * The kit lays notes out; its caller says what they are called.
 *
 * `scripts/check-architecture.mjs`'s `checkUiDomainVocabulary` already enforces
 * this, and it is the authority. This is the same scan run from inside the
 * package, for one reason: the architecture gate is the LAST thing a commit
 * runs, and a sharp sign typed into a comment three files ago should go red in
 * `npm test` — a second, while the file is still open — rather than a minute
 * later at the end of the chain.
 *
 * The range is copied from that check deliberately rather than imported: two
 * independent statements of the same rule is what makes disagreeing with it an
 * event. Transport iconography is not caught by either — a play triangle is
 * interface, not a convention of this domain.
 */
const NOTATION = /[\u2669-\u266F]|[\u{1D100}-\u{1D1FF}]/gu;

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith('.ts') ? [full] : [];
  });
}

describe('@webmusic/ui carries no notation', () => {
  it('has no musical glyph anywhere in its sources, comments included', () => {
    const offences: string[] = [];
    const files = sourceFiles(sourceRoot);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(NOTATION)) {
        const line = text.slice(0, match.index).split('\n').length;
        offences.push(
          `${path.relative(sourceRoot, file)}:${line} contains ${JSON.stringify(match[0])}`,
        );
      }
    }
    expect(offences).toEqual([]);
    // A scan that found no files would pass for the wrong reason.
    expect(files.length).toBeGreaterThan(20);
  });

  it('still catches a glyph, so the scan is not vacuous', () => {
    // The literal the gate is for, written the one way that cannot be mistaken
    // for a source occurrence: as an escape, in a test that is not scanned.
    expect('C\u266F4'.match(NOTATION)).not.toBeNull();
    expect('\u{1D11E}'.match(NOTATION)).not.toBeNull();
    // And the two marks the fretboard really does draw are outside it.
    expect('\u00D7'.match(NOTATION)).toBeNull();
    expect('\u25CB'.match(NOTATION)).toBeNull();
  });
});
