import "server-only";

import { createHash } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import { canonicalise } from "@/ai/capital-engine/canonical-json";
import { db } from "@/db";
import {
  ledgerAccounts,
  ledgerAuditChain,
  ledgerEntries,
  ledgerOrderEvents,
  ledgerReconciliations,
  ledgerTransactions,
} from "@/db/schema/portfolio";
import {
  CAPITAL_LEDGER_CURRENCIES,
  unifyLedgerCashBalances,
} from "@/lib/capital-basis";

export interface LedgerEntryInput {
  accountId: string;
  amount: number;
  currency: string;
  side: "debit" | "credit";
}

export interface LedgerTransactionInput {
  accountId: string;
  entries: LedgerEntryInput[];
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  source: string;
}

export interface LedgerPostResult {
  duplicate: boolean;
  transactionId: string;
}

/**
 * Validate the accounting invariant before touching the database.
 * Amounts are positive magnitudes; side carries the accounting direction.
 * The database remains the durable source of truth and numeric columns retain
 * precision; this preflight rejects malformed and materially unbalanced posts.
 */
export function validateBalancedEntries(entries: LedgerEntryInput[]): void {
  if (entries.length < 2) {
    throw new Error("A ledger transaction requires at least two entries");
  }

  const totals = new Map<string, { credit: number; debit: number }>();
  for (const entry of entries) {
    if (!entry.currency.trim()) {
      throw new Error("Ledger entry currency is required");
    }
    if (!Number.isFinite(entry.amount) || entry.amount <= 0) {
      throw new Error("Ledger entry amount must be a positive finite number");
    }
    const total = totals.get(entry.currency) ?? { credit: 0, debit: 0 };
    total[entry.side] += entry.amount;
    totals.set(entry.currency, total);
  }

  for (const [currency, total] of totals) {
    if (Math.abs(total.debit - total.credit) > 1e-12) {
      throw new Error(
        `Ledger transaction is unbalanced for ${currency}: debit ${total.debit} != credit ${total.credit}`,
      );
    }
  }
}

/**
 * Post one immutable, balanced transaction. Repeating an idempotency key
 * returns the original transaction and never inserts a second set of legs.
 */
export async function postLedgerTransaction(
  input: LedgerTransactionInput,
): Promise<LedgerPostResult> {
  validateBalancedEntries(input.entries);

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(ledgerTransactions)
      .values({
        accountId: input.accountId,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
        source: input.source,
      })
      .onConflictDoNothing({ target: ledgerTransactions.idempotencyKey })
      .returning({ id: ledgerTransactions.id });

    if (inserted.length === 0) {
      const [existing] = await tx
        .select({ id: ledgerTransactions.id })
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (!existing) {
        throw new Error(
          "Ledger idempotency conflict occurred without an existing transaction",
        );
      }
      return { duplicate: true, transactionId: existing.id };
    }

    const transactionId = inserted[0].id;
    await tx.insert(ledgerEntries).values(
      input.entries.map((entry) => ({
        accountId: entry.accountId,
        amount: entry.amount.toString(),
        currency: entry.currency,
        side: entry.side,
        transactionId,
      })),
    );

    return { duplicate: false, transactionId };
  });
}

/** Resolve an account UUID by its stable code and currency. */
export async function findLedgerAccount(
  accountCode: string,
  currency: string,
): Promise<string | null> {
  const [account] = await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.accountCode, accountCode),
        eq(ledgerAccounts.currency, currency),
      ),
    )
    .limit(1);
  return account?.id ?? null;
}

async function ensureLedgerAccount(
  accountCode: string,
  currency: string,
): Promise<string> {
  const inserted = await db
    .insert(ledgerAccounts)
    .values({ accountCode, currency })
    .onConflictDoNothing({
      target: [ledgerAccounts.accountCode, ledgerAccounts.currency],
    })
    .returning({ id: ledgerAccounts.id });
  if (inserted[0]) {
    return inserted[0].id;
  }
  const existing = await findLedgerAccount(accountCode, currency);
  if (!existing) {
    throw new Error(`Ledger account ${accountCode}/${currency} is unavailable`);
  }
  return existing;
}

/**
 * Post a broker cash movement using the canonical chart of accounts. This is
 * the first production integration point; trade inventory legs remain a
 * separate multi-currency phase until lot/mark accounting is available.
 */
export async function postCapitalMovement(input: {
  amount: number;
  currency: string;
  idempotencyKey: string;
  source: string;
  type: "deposit" | "withdrawal";
}): Promise<LedgerPostResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Capital movement amount must be positive");
  }
  const cash = await ensureLedgerAccount("assets:cash", input.currency);
  const capital = await ensureLedgerAccount("equity:capital", input.currency);
  const isDeposit = input.type === "deposit";
  return postLedgerTransaction({
    accountId: "system",
    entries: [
      {
        accountId: isDeposit ? cash : capital,
        amount: input.amount,
        currency: input.currency,
        side: "debit",
      },
      {
        accountId: isDeposit ? capital : cash,
        amount: input.amount,
        currency: input.currency,
        side: "credit",
      },
    ],
    idempotencyKey: input.idempotencyKey,
    source: input.source,
  });
}

/** Read a derived debit-minus-credit balance for one ledger account. */
export async function recordLedgerOrderEvent(input: {
  brokerOrderId?: string;
  eventType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  proposalId: string;
}): Promise<string> {
  const [row] = await db
    .insert(ledgerOrderEvents)
    .values(input)
    .onConflictDoNothing({ target: ledgerOrderEvents.idempotencyKey })
    .returning({ id: ledgerOrderEvents.id });
  if (row) {
    return row.id;
  }
  const [existing] = await db
    .select({ id: ledgerOrderEvents.id })
    .from(ledgerOrderEvents)
    .where(eq(ledgerOrderEvents.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (!existing) {
    throw new Error("Ledger order event idempotency conflict without a row");
  }
  return existing.id;
}

export async function postCompensatingTransaction(input: {
  correctionOf: string;
  entries: LedgerEntryInput[];
  idempotencyKey: string;
  source: string;
}): Promise<LedgerPostResult> {
  return postLedgerTransaction({
    accountId: "system",
    entries: input.entries,
    idempotencyKey: input.idempotencyKey,
    metadata: { correctionOf: input.correctionOf },
    source: input.source,
  });
}

export async function recordLedgerReconciliation(input: {
  accountId: string;
  actual: Record<string, unknown>;
  difference: Record<string, unknown>;
  expected: Record<string, unknown>;
  source: string;
  status: "MATCHED" | "DRIFT" | "UNKNOWN";
}): Promise<string> {
  const [row] = await db
    .insert(ledgerReconciliations)
    .values(input)
    .returning({ id: ledgerReconciliations.id });
  return row.id;
}

/** Append a tamper-evident audit event; existing rows are never edited. */
export async function appendLedgerAudit(input: {
  entityId: string;
  entityType: string;
  payload: Record<string, unknown>;
}): Promise<{ currentHash: string; previousHash: string | null }> {
  const [previous] = await db
    .select({ currentHash: ledgerAuditChain.currentHash })
    .from(ledgerAuditChain)
    .orderBy(desc(ledgerAuditChain.recordedAt))
    .limit(1);
  const previousHash = previous?.currentHash ?? null;
  const currentHash = createHash("sha256")
    .update(
      canonicalise({
        entityId: input.entityId,
        entityType: input.entityType,
        payload: input.payload,
        previousHash,
      }),
    )
    .digest("hex");
  await db.insert(ledgerAuditChain).values({
    currentHash,
    entityId: input.entityId,
    entityType: input.entityType,
    payload: input.payload,
    previousHash,
  });
  return { currentHash, previousHash };
}

export interface CapitalLedgerHealth {
  checkedAt: string;
  entryCount: number;
  healthy: boolean;
  imbalancedTransactionCount: number;
  transactionCount: number;
}

/**
 * Operational invariant probe. It never repairs data or edits ledger facts;
 * callers can alert and halt promotion when an imbalance is detected.
 */
export async function checkCapitalLedgerHealth(): Promise<CapitalLedgerHealth> {
  // Aggregate selects return exactly one row; unwrap it in the promise so
  // Promise.all types stay precise (no nested array destructure).
  const [counts, imbalanced] = await Promise.all([
    db
      .select({
        entryCount: sql<number>`count(${ledgerEntries.id})::int`,
        transactionCount: sql<number>`count(distinct ${ledgerTransactions.id})::int`,
      })
      .from(ledgerTransactions)
      .leftJoin(
        ledgerEntries,
        eq(ledgerEntries.transactionId, ledgerTransactions.id),
      )
      .then((rows) => rows[0]),
    db
      .select({
        transactionId: ledgerEntries.transactionId,
        debit: sql<string>`coalesce(sum(case when ${ledgerEntries.side} = 'debit' then ${ledgerEntries.amount} else 0 end), '0')`,
        credit: sql<string>`coalesce(sum(case when ${ledgerEntries.side} = 'credit' then ${ledgerEntries.amount} else 0 end), '0')`,
      })
      .from(ledgerEntries)
      .groupBy(ledgerEntries.transactionId)
      .having(
        sql`sum(case when ${ledgerEntries.side} = 'debit' then ${ledgerEntries.amount} else -${ledgerEntries.amount} end) <> 0`,
      ),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    entryCount: counts?.entryCount ?? 0,
    healthy: imbalanced.length === 0,
    imbalancedTransactionCount: imbalanced.length,
    transactionCount: counts?.transactionCount ?? 0,
  };
}

export async function readLedgerAccountBalance(
  accountCode: string,
  currency: string,
): Promise<number | null> {
  const accountId = await findLedgerAccount(accountCode, currency);
  if (!accountId) {
    return null;
  }
  const [row] = await db
    .select({
      balance: sql<string>`coalesce(sum(case when ${ledgerEntries.side} = 'debit' then ${ledgerEntries.amount} else -${ledgerEntries.amount} end), '0')`,
      entries: sql<number>`count(*)::int`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.accountId, accountId));
  return row && row.entries > 0 ? Number(row.balance) : null;
}

/**
 * Sum of the unified ledger cash book across BOTH capital currencies (see
 * src/lib/capital-basis.ts). Null when no capital-currency account has any
 * entries — the fresh-ledger signal capital readers fall back on. Every
 * capital denominator (risk gate, portfolio rollup, balance sync basis)
 * reads through this so OKX and Alpaca capital count as one book.
 */
export async function readUnifiedLedgerCash(): Promise<number | null> {
  const balances = await Promise.all(
    CAPITAL_LEDGER_CURRENCIES.map(async (currency) => {
      const balance = await readLedgerAccountBalance("assets:cash", currency);
      return balance;
    }),
  );
  return unifyLedgerCashBalances(balances);
}
