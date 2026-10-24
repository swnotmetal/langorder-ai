// The reconciler is the only piece of this repo that closes the loop between a paused workflow and
// what actually happened in the ERP. It had no test until now, and that gap hid a real bug: the
// digest guard compared the ERP's `custom_review_digest` (= digest(draft)) against the interrupt's
// `revision` (= digest([sources, draft])), which can never match, so every submission was rejected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { workflow } from '../src/workflow.js';
import { FrappeERP } from '../src/erp.js';
import { reconcileErpReviews, type ReviewSyncGraph } from '../src/review-sync.js';
import { mockERP } from './mock-erp.js';

const cleanOrderText =
  'Customer: Acme Workshop\nPO: DEMO-777\nDelivery: 2027-03-01\nAddress: 10 Test Road, Helsinki, 00100, Finland\nItem: FILTER-A10 | 5 | Nos';
function orderExtractor(text: string, address: string) {
  const fact = (value: string) => {
    const start = text.indexOf(value);
    return { value, evidence: { source: 'email' as const, page: 0, start, end: start + value.length, quote: value } };
  };
  return async () => ({
    facts: { customer: [fact('Acme Workshop')], sender: [], location: [], po: [fact('DEMO-777')], date: [fact('2027-03-01')], address: [fact(address)] },
    intent: { kind: 'purchase' as const, evidence: fact('Item:') },
    lines: [{ description: fact('FILTER-A10'), quantity: fact('5'), unit: fact('Nos') }],
  });
}

async function pauseAtReview() {
  const mock = await mockERP();
  const dir = await mkdtemp(join(tmpdir(), 'review-sync-'));
  const saver = SqliteSaver.fromConnString(join(dir, 'checkpoints.sqlite'));
  const erp = new FrappeERP(mock.url, 'token test:test', 'Nordic Parts Demo', 1000);
  const graph = workflow(erp, saver, orderExtractor(cleanOrderText, '10 Test Road, Helsinki, 00100, Finland'));
  const thread = 'reconcile-1';
  const config = { configurable: { thread_id: thread } };
  await graph.invoke({ sources: [{ source: 'email', page: 0, text: cleanOrderText }] }, config);
  const state = await graph.getState(config);
  assert.equal(state.values.status, 'created', 'fixture must pause at the ERP review');
  return {
    graph: graph as unknown as ReviewSyncGraph,
    erp, mock, saver, dir, thread, config,
    state: state.values,
    order: mock.orders.find(o => o.name === state.values.order)!,
    close: async () => { saver.db.close(); await mock.close(); await rm(dir, { recursive: true, force: true }); },
  };
}

// The reconciler's structural graph type only exposes `draft`; the test needs the full resumed
// state to assert what happened after the decision.
async function resultState(x: Awaited<ReturnType<typeof pauseAtReview>>) {
  return (await x.graph.getState(x.config)).values as { status: string; audit: { action: string; actor: string }[] };
}

test('a draft submitted in the ERP is resumed as approved, with the ERP actor', async () => {
  const x = await pauseAtReview();
  try {
    (x.order as Record<string, unknown>).docstatus = 1;
    (x.order as Record<string, unknown>).modified_by = 'sales@example.invalid';
    (x.order as Record<string, unknown>).modified = '2026-10-25 10:00:00';

    const result = await reconcileErpReviews({ graph: x.graph, erp: x.erp, threadIds: [x.thread] });
    assert.equal(result.pending, 1);
    assert.equal(result.resumed.length, 1);
    assert.equal(result.resumed[0].action, 'approve');
    assert.equal(result.resumed[0].actor, 'sales@example.invalid');

    const vals = await resultState(x);
    assert.equal(vals.status, 'submitted');
    const human = vals.audit.find(a => a.action === 'human-submitted');
    assert.ok(human, 'a human submission must be recorded in the audit trail');
    assert.equal(human.actor, 'sales@example.invalid');
  } finally { await x.close(); }
});

test('an open draft is not resumed: a human has not decided yet', async () => {
  const x = await pauseAtReview();
  try {
    const result = await reconcileErpReviews({ graph: x.graph, erp: x.erp, threadIds: [x.thread] });
    assert.equal(result.pending, 1);
    assert.equal(result.resumed.length, 0);
  } finally { await x.close(); }
});

test('a draft whose ERP content diverged from the proposal is rejected, not approved', async () => {
  const x = await pauseAtReview();
  try {
    // docstatus 1 (submitted) but the stored digest no longer matches the proposal, and no
    // modified_by was recorded — which also exercises the empty-actor fallback.
    (x.order as Record<string, unknown>).docstatus = 1;
    (x.order as Record<string, unknown>).custom_review_digest = 'something-else-was-edited';
    const result = await reconcileErpReviews({ graph: x.graph, erp: x.erp, threadIds: [x.thread] });
    assert.equal(result.resumed[0].action, 'reject');
    assert.match(result.resumed[0].reason, /no longer matches/);
    assert.equal(result.resumed[0].actor, 'unknown', 'an empty actor must not wedge the loop');
    const vals = await resultState(x);
    assert.equal(vals.status, 'cancelled');
  } finally { await x.close(); }
});

test('a draft deleted outright is treated as a human rejection', async () => {
  const x = await pauseAtReview();
  try {
    x.mock.reset();
    const result = await reconcileErpReviews({ graph: x.graph, erp: x.erp, threadIds: [x.thread] });
    assert.equal(result.resumed[0].action, 'reject');
    assert.equal(result.resumed[0].actor, 'unknown');
    assert.match(result.resumed[0].reason, /no longer exists/);
  } finally { await x.close(); }
});

test('dryRun reports the resume but leaves the workflow paused', async () => {
  const x = await pauseAtReview();
  try {
    (x.order as Record<string, unknown>).docstatus = 1;
    (x.order as Record<string, unknown>).modified_by = 'sales@example.invalid';
    const result = await reconcileErpReviews({ graph: x.graph, erp: x.erp, threadIds: [x.thread], dryRun: true });
    assert.equal(result.resumed.length, 1);
    const vals = await resultState(x);
    assert.equal(vals.status, 'created', 'dryRun must not advance the graph');
  } finally { await x.close(); }
});
