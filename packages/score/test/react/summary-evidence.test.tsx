import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {ScoreBuilder} from '../../src/core';
import {AnalysisSummary} from '../../src/react/analysis';

describe('AnalysisSummary evidence', () => {
  it('does not present the empty-score key placeholder as a detected key', () => {
    const markup = renderToStaticMarkup(<AnalysisSummary score={new ScoreBuilder().build()} />);
    expect(markup).toContain('<dd>Unknown</dd>');
    expect(markup).not.toContain('<dd>C major</dd>');
  });
});
