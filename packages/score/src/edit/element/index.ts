export {
  ScoreDocumentElement, defineScoreDocumentElement,
  type ScoreDocumentLoadResult, type ScoreDocumentStateDetail, type ScoreDocumentStatus,
} from './score-document';

import {defineScoreDocumentElement} from './score-document';

/** Register the nonvisual Score editing declaration. */
export function defineAllElements(): void { defineScoreDocumentElement(); }
