// The per-run cost line is only useful if it counts this run and not the history, so the mark and
// the diff are pinned here against a real SQLite file.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { markSpend, spendSince } from '../src/ledger.js';

async function withLedger(fn: (dataDir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'ledger-'));
  const ledger = SqliteSaver.fromConnString(join(dir, 'model-budget.sqlite'));
  ledger.db.exec('CREATE TABLE IF NOT EXISTS model_budget (id INTEGER PRIMARY KEY, reserved_usd_micro INTEGER NOT NULL, actual_usd_micro INTEGER)');
  ledger.db.close();
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

function insert(dataDir: string, ...micro: (number | null)[]) {
  const ledger = SqliteSaver.fromConnString(join(dataDir, 'model-budget.sqlite'));
  const statement = ledger.db.prepare('INSERT INTO model_budget (reserved_usd_micro, actual_usd_micro) VALUES (0, ?)');
  for (const value of micro) statement.run(value);
  ledger.db.close();
}

test('only the calls made after the mark are counted', async () => {
  await withLedger(async dir => {
    insert(dir, 500, 700);
    const mark = markSpend(dir);
    insert(dir, 120, null);
    const spend = spendSince(mark);
    assert.equal(spend.calls, 2);
    assert.equal(spend.usdMicro, 120, 'a failed call with no usage contributes 0, not the reservation');
  });
});

test('a run with no calls reports zero rather than the historical total', async () => {
  await withLedger(async dir => {
    insert(dir, 900);
    const mark = markSpend(dir);
    assert.deepEqual(spendSince(mark), { calls: 0, usdMicro: 0 });
  });
});

test('a missing ledger is not an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ledger-empty-'));
  try {
    const mark = markSpend(dir);
    assert.deepEqual(spendSince(mark), { calls: 0, usdMicro: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
