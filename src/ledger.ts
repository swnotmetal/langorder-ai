// Cost attribution for one run.
//
// The ledger already records every attempt, but "how much did this run cost" is the question a
// reviewer actually asks. Marking before and diffing after answers it without adding a second
// counter that could drift from the ledger.
import { resolve } from 'node:path';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

export type SpendMark = { dataDir: string; lastId: number };
export type Spend = { calls: number; usdMicro: number };

function open(dataDir: string) {
  return SqliteSaver.fromConnString(resolve(dataDir, 'model-budget.sqlite'));
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
