// Evidence locating for models that cannot cite character-exact quotes.
//
// The strict schema asks the model for {sourceIndex, quote, value} and rejects anything whose quote
// is not literally present. Small models can copy a value but routinely mislabel the source or
// paraphrase the quote, so they fail for a reason that has nothing to do with extraction quality.
//
// This inverts the work: the model returns plain values, and the code finds each one in the source.
// The safety property is unchanged — a fact still has to appear verbatim — but the model no longer
// has to be trusted about *where* it came from.
import { type Fact, type Source } from './domain.js';

export function locate(value: string | null | undefined, sources: Source[]): Fact | null {
  const wanted = (value ?? '').trim();
  if (!wanted) return null;
  for (const source of sources) {
    const start = source.text.indexOf(wanted);
    if (start < 0) continue;
    return {
      value: wanted,
      evidence: { source: source.source, page: source.page, start, end: start + wanted.length, quote: wanted },
    };
  }
  return null;
}

// Index a located fact back into the source array, so the strict verifier can be reused unchanged.
export function sourceIndex(fact: Fact, sources: Source[]): number {
  return sources.findIndex(s => s.source === fact.evidence.source && s.page === fact.evidence.page);
}
