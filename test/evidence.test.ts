// The plain-value path exists so a small local model can be used without lowering the bar: a fact
// still has to appear verbatim in the source, but the model no longer has to cite where.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { locate, sourceIndex } from '../src/evidence.js';
import { verifyPlainProposal } from '../src/model.js';
import { type Source } from '../src/domain.js';

const sources: Source[] = [
  { source: 'email', page: 0, text: 'Hello, please quote Filter A10 - 40 Stück.\n\nRegards,\nNguyen Van A\nHanoi Tech-Logistics Co.' },
  { source: 'subject', page: 0, text: 'RFQ Filter A10' },
  { source: 'sender', page: 0, text: 'buyer@example.invalid' },
];

const plain = (overrides: Record<string, unknown> = {}) => ({
  facts: { customer: [], sender: [], location: [], po: [], date: [], address: [] },
  lines: [],
  ...overrides,
});

test('a copied value is located with exact offsets', () => {
  const fact = locate('Hanoi Tech-Logistics Co.', sources);
  assert.ok(fact);
  assert.equal(fact.value, 'Hanoi Tech-Logistics Co.');
  assert.equal(fact.evidence.source, 'email');
  assert.equal(sources[0].text.slice(fact.evidence.start, fact.evidence.end), 'Hanoi Tech-Logistics Co.');
  assert.equal(sourceIndex(fact, sources), 0);
});

test('a paraphrase is not located, and an empty value never matches', () => {
  assert.equal(locate('Hanoi Tech Logistics', sources), null);
  assert.equal(locate('   ', sources), null);
  assert.equal(locate(null, sources), null);
});

test('grounded facts are kept and dropped ones are reported, not hidden', () => {
  const extraction = verifyPlainProposal(plain({
    facts: { customer: ['Hanoi Tech-Logistics Co.'], sender: [], location: [], po: ['PO-999'], date: [], address: [] },
  }), sources);
  assert.deepEqual(extraction.facts.customer.map(f => f.value), ['Hanoi Tech-Logistics Co.']);
  assert.deepEqual(extraction.facts.po, [], 'an invented PO must not survive');
  assert.ok(extraction.warnings?.some(w => w.field === 'po'));
  assert.equal(extraction.warnings?.some(w => w.field === 'customer'), false);
});

test('a line survives only when description, quantity and unit are all in the source', () => {
  const extraction = verifyPlainProposal(plain({
    lines: [
      { description: 'Filter A10', quantity: '40', unit: 'Stück' },
      { description: 'Filter A10', quantity: 'inferred as 40', unit: 'Stück' },
    ],
  }), sources);
  assert.equal(extraction.lines.length, 1, 'the phrase "inferred as 40" is not a quantity');
  assert.equal(extraction.lines[0].quantity.value, '40');
});
