/**
 * Tier 1 read-only tools. Field-level filtering happens HERE, before data can
 * ever reach model context: the output schema simply has no `ssn` field, and
 * masking is applied to partially-visible fields.
 */
import { z } from 'zod';
import type { ToolDefinition } from '../tool.js';
import { maskValue } from '../../security/redact.js';

const ID_RE = /^[A-Z]-\d{4,8}$/;

// --- get_customer ----------------------------------------------------------

const GetCustomerInput = z.object({ customerId: z.string().regex(ID_RE) }).strict();

const CustomerView = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  plan: z.string(),
  active: z.boolean(),
  version: z.number().int(),
  // NOTE: no `ssn`, no `tenantId`. The projection IS the permission.
}).strict();

export const getCustomerTool: ToolDefinition<z.infer<typeof GetCustomerInput>, z.infer<typeof CustomerView>> = {
  name: 'get_customer',
  description: 'Fetch one customer record (field-filtered for the caller role).',
  riskTier: 1,
  input: GetCustomerInput,
  output: CustomerView,
  requiredRoles: ['viewer', 'support_agent', 'support_manager'],
  sensitivity: 'pii',
  timeoutMs: 5000,
  reversible: true,
  targets: (i) => ({ resourceType: 'customer', resourceIds: [i.customerId] }),
  async handler(input, ctx, backend) {
    const c = backend.getCustomer(ctx, input.customerId);
    if (!c) throw new Error(`customer ${input.customerId} not found`);
    return {
      id: c.id,
      name: c.name,
      email: String(maskValue('email', c.email)),
      phone: String(maskValue('phone', c.phone)),
      plan: c.plan,
      active: c.active,
      version: c.version,
    };
  },
};

// --- search_orders ---------------------------------------------------------

const MAX_ROWS = 50;

const SearchOrdersInput = z.object({
  customerId: z.string().regex(ID_RE),
  limit: z.number().int().min(1).max(MAX_ROWS),
}).strict();

const OrderView = z.object({
  id: z.string(),
  customerId: z.string(),
  total: z.number(),
  status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']),
  createdAt: z.string(),
}).strict();

export const searchOrdersTool: ToolDefinition<z.infer<typeof SearchOrdersInput>, z.infer<typeof OrderView>[]> = {
  name: 'search_orders',
  description: 'Search a customer\'s orders, newest first. Row-capped.',
  riskTier: 1,
  input: SearchOrdersInput,
  output: z.array(OrderView).max(MAX_ROWS),
  requiredRoles: ['viewer', 'support_agent', 'support_manager'],
  sensitivity: 'internal',
  timeoutMs: 5000,
  reversible: true,
  maxRows: MAX_ROWS,
  targets: (i) => ({ resourceType: 'customer', resourceIds: [i.customerId] }),
  async handler(input, ctx, backend) {
    return backend
      .searchOrders(ctx, input.customerId, Math.min(input.limit, MAX_ROWS))
      .map((o) => ({ id: o.id, customerId: o.customerId, total: o.total, status: o.status, createdAt: o.createdAt }));
  },
};
