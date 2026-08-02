/**
 * Tier 4 tools: confirmation + fresh step-up; approval by a second human above
 * thresholds. Both are deliberately "staged": request_refund creates a request
 * (money moves only after finance approval); export runs as an async job whose
 * rows NEVER pass through the model.
 */
import { z } from 'zod';
import type { ToolDefinition } from '../tool.js';

const ID_RE = /^[A-Z]-\d{4,8}$/;

// --- request_refund --------------------------------------------------------

const RequestRefundInput = z.object({
  orderId: z.string().regex(ID_RE),
  amount: z.number().positive().max(1_000_000),
  reason: z.string().min(5).max(500),
}).strict();

const RefundRequestView = z.object({
  requestId: z.string(),
  status: z.enum(['pending_approval', 'approved', 'executed', 'rejected']),
}).strict();

export const requestRefundTool: ToolDefinition<z.infer<typeof RequestRefundInput>, z.infer<typeof RefundRequestView>> = {
  name: 'request_refund',
  description: 'Create a refund request. Funds only ever return to the original payment method; above threshold a finance approver must approve.',
  riskTier: 4,
  input: RequestRefundInput,
  output: RefundRequestView,
  requiredRoles: ['support_agent', 'support_manager'],
  sensitivity: 'financial',
  timeoutMs: 10_000,
  reversible: true, // a request can be voided before approval
  targets: (i) => ({ resourceType: 'order', resourceIds: [i.orderId] }),
  financialAmount: (i) => i.amount,
  async dryRun(input, ctx, backend) {
    const order = backend.getOrder(ctx, input.orderId);
    if (!order) throw new Error(`order ${input.orderId} not found`);
    if (input.amount > order.total - order.refundedAmount) {
      throw new Error(`refund ${input.amount} exceeds refundable balance ${order.total - order.refundedAmount}`);
    }
    return {
      preview: {
        action: 'request_refund',
        target: `Order ${order.id} (customer ${order.customerId})`,
        fieldsChanging: ['refundedAmount'],
        currentValues: { refundedAmount: order.refundedAmount },
        proposedValues: { refundedAmount: order.refundedAmount + input.amount },
        externalRecipients: [],
        financialImpact: `-${input.amount} to original payment method on file`,
        sideEffects: ['customer notified', 'finance ledger entry created'],
        reversible: true,
        affectedRecordCount: 1,
      },
      resourceVersions: {},
    };
  },
  async handler(input, ctx, backend, exec) {
    const req = backend.createRefundRequest(ctx, input.orderId, input.amount, exec.idempotencyKey);
    return { requestId: req.id, status: req.status };
  },
};

// --- export_customer_records (bulk) ---------------------------------------

const ExportInput = z.object({
  fields: z.array(z.enum(['id', 'name', 'email', 'phone', 'plan', 'active'])).min(1),
  filter: z.enum(['all', 'active', 'inactive']),
  format: z.enum(['csv', 'json']),
  /** Server-computed estimate confirmed via preview; capped by policy. */
  estimatedRecordCount: z.number().int().min(1).max(1_000_000),
}).strict();

const ExportJobView = z.object({
  jobId: z.string(),
  status: z.literal('queued'),
  delivery: z.literal('in_app_secure_download'),
}).strict();

export const exportCustomerRecordsTool: ToolDefinition<z.infer<typeof ExportInput>, z.infer<typeof ExportJobView>> = {
  name: 'export_customer_records',
  description: 'Async bulk export job. Rows never enter model context; delivery is watermarked in-app download only.',
  riskTier: 4,
  input: ExportInput,
  output: ExportJobView,
  requiredRoles: ['data_owner', 'support_manager'],
  sensitivity: 'pii',
  timeoutMs: 10_000,
  reversible: true, // the job can be cancelled; downloads are separately audited
  targets: () => ({ resourceType: 'tenant_dataset', resourceIds: ['customers'] }),
  affectedRecordCount: (i) => i.estimatedRecordCount,
  async dryRun(input, ctx) {
    return {
      preview: {
        action: 'export_customer_records',
        target: `all ${input.filter} customers (tenant: ${ctx.tenantId})`,
        fieldsChanging: [],
        currentValues: {},
        proposedValues: { fields: input.fields.join(','), format: input.format },
        externalRecipients: [],
        financialImpact: null,
        sideEffects: [
          `~${input.estimatedRecordCount} records exported`,
          'file watermarked with your user identity',
          'delivery: secure in-app download only',
        ],
        reversible: true,
        affectedRecordCount: input.estimatedRecordCount,
      },
      resourceVersions: {},
    };
  },
  async handler(input, _ctx, _backend, exec) {
    return { jobId: `EXP-${exec.idempotencyKey.slice(0, 8)}`, status: 'queued' as const, delivery: 'in_app_secure_download' as const };
  },
};
