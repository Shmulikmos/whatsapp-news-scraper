/**
 * In-memory stand-in for the existing application services + database.
 *
 * It models the two properties the real backend must have:
 *  1. Tenant isolation is structural: every read/write requires the caller's
 *     AuthContext and is scoped to ctx.tenantId (the RLS analog). There is no
 *     API that returns cross-tenant data.
 *  2. Writes support optimistic locking (expectedVersion) and idempotency keys.
 */
import type { AuthContext } from '../types.js';

export interface Customer {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  phone: string;
  plan: string;
  ssn: string; // present to prove field-level filtering works
  version: number;
  active: boolean;
  notes: string[];
}

export interface Order {
  id: string;
  tenantId: string;
  customerId: string;
  total: number;
  status: 'pending' | 'shipped' | 'delivered' | 'cancelled';
  createdAt: string;
  refundedAmount: number;
}

export interface SentEmail {
  templateId: string;
  recipients: string[];
  sentBy: string;
}

export interface RefundRequest {
  id: string;
  orderId: string;
  amount: number;
  requestedBy: string;
  status: 'pending_approval' | 'approved' | 'executed' | 'rejected';
}

export class ConflictError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ConflictError';
  }
}

export class FakeBackend {
  private customers = new Map<string, Customer>();
  private orders = new Map<string, Order>();
  readonly sentEmails: SentEmail[] = [];
  readonly refundRequests: RefundRequest[] = [];
  private appliedIdempotencyKeys = new Set<string>();
  private refundSeq = 0;

  seed(customers: Customer[], orders: Order[]): void {
    for (const c of customers) this.customers.set(c.id, { ...c, notes: [...c.notes] });
    for (const o of orders) this.orders.set(o.id, { ...o });
  }

  /** RLS analog: a row outside the caller's tenant does not exist for them. */
  getCustomer(ctx: AuthContext, id: string): Customer | undefined {
    const c = this.customers.get(id);
    if (!c || c.tenantId !== ctx.tenantId) return undefined;
    return { ...c, notes: [...c.notes] };
  }

  searchOrders(ctx: AuthContext, customerId: string, limit: number): Order[] {
    return [...this.orders.values()]
      .filter((o) => o.tenantId === ctx.tenantId && o.customerId === customerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((o) => ({ ...o }));
  }

  getOrder(ctx: AuthContext, id: string): Order | undefined {
    const o = this.orders.get(id);
    if (!o || o.tenantId !== ctx.tenantId) return undefined;
    return { ...o };
  }

  addNote(ctx: AuthContext, customerId: string, note: string, idempotencyKey: string): Customer {
    const c = this.requireCustomer(ctx, customerId);
    if (!this.appliedIdempotencyKeys.has(idempotencyKey)) {
      c.notes.push(note);
      c.version += 1;
      this.appliedIdempotencyKeys.add(idempotencyKey);
    }
    return { ...c, notes: [...c.notes] };
  }

  updateCustomerFields(
    ctx: AuthContext,
    customerId: string,
    fields: Partial<Pick<Customer, 'phone' | 'email' | 'name'>>,
    expectedVersion: number,
    idempotencyKey: string
  ): Customer {
    const c = this.requireCustomer(ctx, customerId);
    if (this.appliedIdempotencyKeys.has(idempotencyKey)) return { ...c, notes: [...c.notes] };
    if (c.version !== expectedVersion) {
      throw new ConflictError(
        `version mismatch for ${customerId}: expected ${expectedVersion}, is ${c.version}`
      );
    }
    Object.assign(c, fields);
    c.version += 1;
    this.appliedIdempotencyKeys.add(idempotencyKey);
    return { ...c, notes: [...c.notes] };
  }

  /** The set of externally-addressable recipients this tenant has verified. */
  verifiedRecipients(ctx: AuthContext): Set<string> {
    return new Set(
      [...this.customers.values()].filter((c) => c.tenantId === ctx.tenantId).map((c) => c.email)
    );
  }

  sendTemplatedEmail(
    ctx: AuthContext,
    templateId: string,
    recipients: string[],
    idempotencyKey: string
  ): { sent: number } {
    if (this.appliedIdempotencyKeys.has(idempotencyKey)) {
      return { sent: recipients.length };
    }
    this.appliedIdempotencyKeys.add(idempotencyKey);
    this.sentEmails.push({ templateId, recipients: [...recipients], sentBy: ctx.userId });
    return { sent: recipients.length };
  }

  createRefundRequest(ctx: AuthContext, orderId: string, amount: number, idempotencyKey: string): RefundRequest {
    const order = this.orders.get(orderId);
    if (!order || order.tenantId !== ctx.tenantId) throw new ConflictError(`no such order ${orderId}`);
    const existing = this.refundRequests.find((r) => r.id === `RR-${idempotencyKey.slice(0, 8)}`);
    if (existing) return { ...existing };
    this.refundSeq += 1;
    const req: RefundRequest = {
      id: `RR-${idempotencyKey.slice(0, 8)}`,
      orderId,
      amount,
      requestedBy: ctx.userId,
      status: 'pending_approval',
    };
    this.refundRequests.push(req);
    return { ...req };
  }

  private requireCustomer(ctx: AuthContext, id: string): Customer {
    const c = this.customers.get(id);
    if (!c || c.tenantId !== ctx.tenantId) throw new ConflictError(`no such customer ${id}`);
    return c;
  }
}

/** Two tenants so cross-tenant tests are meaningful. */
export function seededBackend(): FakeBackend {
  const b = new FakeBackend();
  b.seed(
    [
      {
        id: 'C-10422', tenantId: 'acme', name: 'Dana Levi', email: 'dana@example.com',
        phone: '+97235550100', plan: 'pro', ssn: '123-45-6789', version: 17, active: true, notes: [],
      },
      {
        id: 'C-20011', tenantId: 'acme', name: 'Avi Cohen', email: 'avi@example.com',
        phone: '+97235550200', plan: 'basic', ssn: '987-65-4321', version: 3, active: false, notes: [],
      },
      {
        id: 'C-90001', tenantId: 'globex', name: 'Noa Bar', email: 'noa@globex-customer.com',
        phone: '+97235559900', plan: 'enterprise', ssn: '555-11-2222', version: 8, active: true, notes: [],
      },
    ],
    [
      { id: 'O-8817', tenantId: 'acme', customerId: 'C-10422', total: 7200, status: 'delivered', createdAt: '2026-07-20', refundedAmount: 0 },
      { id: 'O-8810', tenantId: 'acme', customerId: 'C-10422', total: 150, status: 'shipped', createdAt: '2026-07-01', refundedAmount: 0 },
      { id: 'O-8711', tenantId: 'acme', customerId: 'C-10422', total: 90, status: 'delivered', createdAt: '2026-06-11', refundedAmount: 0 },
      { id: 'O-9001', tenantId: 'globex', customerId: 'C-90001', total: 50000, status: 'pending', createdAt: '2026-07-30', refundedAmount: 0 },
    ]
  );
  return b;
}
