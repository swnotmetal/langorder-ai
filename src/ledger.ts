// Cost attribution for one run.
//
// The ledger already records every attempt, but "how much did this run cost" is the question a
// reviewer actually asks. Marking before and diffing after answers it without adding a second
// counter that could drift from the ledger.
import { resolve } from 'node:path';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

export type SpendMark = { dataDir: string; lastId: number };
export type Spend = { calls: number; usdMicro: number };

// Micro-USD per token, which is the list price per million tokens. Kept next to the ledger so a
// provider cannot report a cost the ledger does not understand.
const PRICES: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'eu.amazon.nova-micro-v1:0': { input: 0.035, output: 0.14 },
  'eu.amazon.nova-lite-v1:0': { input: 0.06, output: 0.24 },
  'eu.amazon.nova-pro-v1:0': { input: 0.8, output: 3.2 },
};

function open(dataDir: string) {
  return SqliteSaver.fromConnString(resolve(dataDir, 'model-budget.sqlite'));
}

function ensure(dataDir: string) {
  const ledger = open(dataDir);
  ledger.db.exec('CREATE TABLE IF NOT EXISTS model_budget (id INTEGER PRIMARY KEY, reserved_usd_micro INTEGER NOT NULL, actual_usd_micro INTEGER)');
  const columns = ledger.db.prepare('PRAGMA table_info(model_budget)').all() as { name: string }[];
  if (!columns.some(column => column.name === 'model')) ledger.db.exec('ALTER TABLE model_budget ADD COLUMN model TEXT');
  return ledger;
}

// A billed call from a provider that does not use the Gemini budget path. An unpriced model is still
// recorded, with a null cost, so the attempt is never invisible.
export function recordAttempt(
  dataDir: string,
  model: string,
  usage: { input_tokens: number; output_tokens: number } | undefined,
): number | null {
  const ledger = ensure(dataDir);
  try {
    const price = PRICES[model];
    const micro = usage && price ? Math.ceil(usage.input_tokens * price.input + usage.output_tokens * price.output) : null;
    ledger.db.prepare('INSERT INTO model_budget (reserved_usd_micro, actual_usd_micro, model) VALUES (0, ?, ?)').run(micro, model);
    return micro;
  } finally {
    ledger.db.close();
  }
}

export function markSpend(dataDir: string): SpendMark {
  const ledger = open(dataDir);
  try {
    const row = ledger.db.prepare('SELECT COALESCE(MAX(id), 0) AS last FROM model_budget').get() as { last: number } | undefined;
    return { dataDir, lastId: row?.last ?? 0 };
  } catch {
    // No ledger yet means no calls have ever been made; the next run creates the table.
    return { dataDir, lastId: 0 };
  } finally {
    ledger.db.close();
  }
}

export function spendSince(mark: SpendMark): Spend {
  const ledger = open(mark.dataDir);
  try {
    const row = ledger.db
      .prepare('SELECT COUNT(*) AS calls, COALESCE(SUM(actual_usd_micro), 0) AS micro FROM model_budget WHERE id > ?')
      .get(mark.lastId) as { calls: number; micro: number } | undefined;
    return { calls: row?.calls ?? 0, usdMicro: row?.micro ?? 0 };
  } catch {
    return { calls: 0, usdMicro: 0 };
  } finally {
    ledger.db.close();
  }
}
