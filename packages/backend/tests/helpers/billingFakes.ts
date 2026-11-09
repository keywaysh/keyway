/**
 * In-memory stand-ins for what the Stripe webhook touches: the
 * stripe_webhook_events, subscriptions, users and organizations tables, plus
 * builders for Stripe subscription objects. A test sets up the world (stored
 * rows, the subscriptions Stripe holds right now) and asserts the outcome,
 * whatever order the service queries it in.
 *
 * In a test file:
 *   vi.mock("drizzle-orm", async (importOriginal) => ({
 *     ...(await importOriginal<typeof import("drizzle-orm")>()),
 *     ...(await import("../helpers/billingFakes")).conditionFakes,
 *   }));
 *   vi.mock("../../src/db", async () => (await import("../helpers/billingFakes")).fakeDbModule);
 */

type Row = Record<string, unknown>;

type Condition =
  | { op: "eq"; column: string; value: unknown }
  | { op: "lt"; column: string; value: unknown }
  | { op: "and"; conditions: Condition[] };

/** drizzle-orm's eq/lt/and, as inspectable objects the fake tables evaluate. */
export const conditionFakes = {
  eq: (column: string, value: unknown): Condition => ({ op: "eq", column, value }),
  lt: (column: string, value: unknown): Condition => ({ op: "lt", column, value }),
  and: (...conditions: Condition[]): Condition => ({ op: "and", conditions }),
};

function matches(row: Row, condition: Condition): boolean {
  switch (condition.op) {
    case "eq":
      return row[condition.column] === condition.value;
    case "lt":
      return (row[condition.column] as Date).getTime() < (condition.value as Date).getTime();
    case "and":
      return condition.conditions.every((c) => matches(row, c));
  }
}

function firstEqValue(condition: Condition): unknown {
  if (condition.op === "eq") {
    return condition.value;
  }
  return condition.op === "and" ? firstEqValue(condition.conditions[0]) : undefined;
}

export const billingDb = {
  webhookEvents: [] as Row[],
  users: [] as Row[],
  subscriptions: [] as Row[],
  organizations: [] as Row[],
  /** Every write, in order: "insert stripe_webhook_events evt_1", "update users", ... */
  writes: [] as string[],
  /** Values passed to every update, in order, with the table they went to. */
  updates: [] as { table: string; values: Row }[],
  /** Tables whose writes throw, to simulate a failure in the middle of processing. */
  failingTables: new Set<string>(),

  reset() {
    this.webhookEvents.length = 0;
    this.users.length = 0;
    this.subscriptions.length = 0;
    this.organizations.length = 0;
    this.writes.length = 0;
    this.updates.length = 0;
    this.failingTables.clear();
  },
};

const tables = {
  users: { name: "users", id: "id", plan: "plan", stripeCustomerId: "stripeCustomerId" },
  subscriptions: { name: "subscriptions", userId: "userId" },
  stripeWebhookEvents: {
    name: "stripe_webhook_events",
    id: "id",
    stripeEventId: "stripeEventId",
    processedAt: "processedAt",
  },
  organizations: { name: "organizations", id: "id", stripeCustomerId: "stripeCustomerId" },
};
type Table = (typeof tables)[keyof typeof tables];

const UNIQUE_KEY: Record<string, string> = {
  stripe_webhook_events: "stripeEventId",
  subscriptions: "userId",
  users: "id",
  organizations: "id",
};

function rowsOf(table: Table): Row[] {
  switch (table.name) {
    case "users":
      return billingDb.users;
    case "subscriptions":
      return billingDb.subscriptions;
    case "stripe_webhook_events":
      return billingDb.webhookEvents;
    default:
      return billingDb.organizations;
  }
}

function recordWrite(table: Table, op: string, detail?: unknown) {
  if (billingDb.failingTables.has(table.name)) {
    throw new Error(`write to ${table.name} failed`);
  }
  billingDb.writes.push(detail === undefined ? `${op} ${table.name}` : `${op} ${table.name} ${detail}`);
}

/** A query builder end that runs once, when awaited or when `.returning()` is called. */
function deferred(run: () => Row[]) {
  let result: Promise<Row[]> | undefined;
  const exec = () => (result ??= Promise.resolve().then(run));
  return {
    returning: () => exec(),
    then<T1 = void, T2 = never>(
      onFulfilled?: ((value: void) => T1 | PromiseLike<T1>) | null,
      onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
    ) {
      return exec()
        .then(() => undefined)
        .then(onFulfilled, onRejected);
    },
  };
}

type OnConflict = { kind: "error" } | { kind: "nothing" } | { kind: "update"; set: Row };

function insertRow(table: Table, values: Row, onConflict: OnConflict): Row[] {
  const isEvents = table.name === "stripe_webhook_events";
  recordWrite(table, "insert", isEvents ? values.stripeEventId : undefined);
  const rows = rowsOf(table);
  const key = UNIQUE_KEY[table.name];
  const existing = rows.find((r) => r[key] === values[key]);
  if (existing) {
    if (onConflict.kind === "nothing") {
      return [];
    }
    if (onConflict.kind === "update") {
      Object.assign(existing, onConflict.set);
      return [existing];
    }
    throw new Error(`duplicate key value violates unique constraint "${table.name}.${key}"`);
  }
  const row = isEvents ? { id: `row_${rows.length + 1}`, processedAt: new Date(), ...values } : { ...values };
  rows.push(row);
  return [row];
}

export const fakeDbModule = {
  db: {
    select: () => ({
      from: (table: Table) => ({
        where: (condition: Condition) => ({
          limit: async (n: number) => rowsOf(table).filter((r) => matches(r, condition)).slice(0, n),
        }),
      }),
    }),
    insert: (table: Table) => ({
      values: (values: Row) => ({
        ...deferred(() => insertRow(table, values, { kind: "error" })),
        onConflictDoNothing: () => deferred(() => insertRow(table, values, { kind: "nothing" })),
        onConflictDoUpdate: ({ set }: { set: Row }) =>
          deferred(() => insertRow(table, values, { kind: "update", set })),
      }),
    }),
    update: (table: Table) => ({
      set: (values: Row) => ({
        where: (condition: Condition) =>
          deferred(() => {
            recordWrite(table, "update", table.name === "stripe_webhook_events" ? firstEqValue(condition) : undefined);
            billingDb.updates.push({ table: table.name, values });
            const hit = rowsOf(table).filter((r) => matches(r, condition));
            hit.forEach((r) => Object.assign(r, values));
            return hit;
          }),
      }),
    }),
    delete: (table: Table) => ({
      where: (condition: Condition) =>
        deferred(() => {
          recordWrite(table, "delete", table.name === "stripe_webhook_events" ? firstEqValue(condition) : undefined);
          const rows = rowsOf(table);
          const removed = rows.filter((r) => matches(r, condition));
          for (const r of removed) {
            rows.splice(rows.indexOf(r), 1);
          }
          return removed;
        }),
    }),
  },
  ...tables,
};

// ============================================================================
// Stripe objects
// ============================================================================

const LOOKUP_KEY = { team: "team_month_eur", business: "business_month_eur" } as const;

/** A Stripe subscription on customer cus_1 for one price of `plan`. */
export function stripeSubscription(
  id: string,
  status: string,
  plan: "team" | "business",
  metadata: Record<string, string>,
  customer = "cus_1"
) {
  return {
    id,
    object: "subscription",
    status,
    customer,
    cancel_at_period_end: false,
    metadata,
    items: {
      data: [
        {
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          price: { id: `price_${plan}_m`, lookup_key: LOOKUP_KEY[plan], recurring: { interval: "month" } },
        },
      ],
    },
  } as any;
}

export function stripeEvent(type: string, subscription: ReturnType<typeof stripeSubscription>, id?: string) {
  return {
    id: id ?? `evt_${subscription.id}_${subscription.status}_${type}`,
    type,
    data: { object: subscription },
  } as any;
}
