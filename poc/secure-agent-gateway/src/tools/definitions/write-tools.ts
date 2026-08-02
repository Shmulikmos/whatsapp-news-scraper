/**
 * Write tools across the tiers:
 *  - add_note                (Tier 2, reversible, auto-executes with notify)
 *  - update_contact_details  (Tier 3, preview + confirmation, optimistic lock)
 *  - send_approved_email     (Tier 3, template-only, verified recipients)
 */
import { z } from 'zod';
import type { ToolDefinition } from '../tool.js';
import { maskValue } from '../../security/redact.js';

const ID_RE = /^[A-Z]-\d{4,8}$/;

// --- add_note (Tier 2) -----------------------------------------------------

const AddNoteInput = z.object({
  customerId: z.string().regex(ID_RE),
  note: z.string().min(1).max(2000),
}).strict();

export const addNoteTool: ToolDefinition<z.infer<typeof AddNoteInput>, { noteCount: number }> = {
  name: 'add_note',
  description: 'Append a note to a customer record. Reversible (notes can be deleted).',
  riskTier: 2,
  input: AddNoteInput,
  output: z.object({ noteCount: z.number().int() }).strict(),
  requiredRoles: ['support_agent', 'support_manager'],
  sensitivity: 'internal',
  timeoutMs: 10_000,
  reversible: true,
  targets: (i) => ({ resourceType: 'customer', resourceIds: [i.customerId] }),
  // A dryRun lets policy escalate this auto-tier-2 tool to confirm-required
  // (e.g. under untrusted-content taint) and still show a real preview.
  async dryRun(input, ctx, backend) {
    const c = backend.getCustomer(ctx, input.customerId);
    if (!c) throw new Error(`customer ${input.customerId} not found`);
    return {
      preview: {
        action: 'add_note',
        target: `Customer ${c.id} — "${c.name}" (tenant: ${ctx.tenantId})`,
        fieldsChanging: ['notes'],
        currentValues: { noteCount: c.notes.length },
        proposedValues: { note: input.note },
        externalRecipients: [],
        financialImpact: null,
        sideEffects: ['note appended (reversible)'],
        reversible: true,
        affectedRecordCount: 1,
      },
      resourceVersions: { [c.id]: c.version },
    };
  },
  async handler(input, ctx, backend, exec) {
    const c = backend.addNote(ctx, input.customerId, input.note, exec.idempotencyKey);
    return { noteCount: c.notes.length };
  },
};

// --- update_contact_details (Tier 3) --------------------------------------

const UpdateContactInput = z.object({
  customerId: z.string().regex(ID_RE),
  fields: z.object({
    phone: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(), // E.164, validated deterministically
    email: z.string().email().max(254).optional(),
  }).strict().refine((f) => Object.keys(f).length > 0, { message: 'at least one field required' }),
}).strict();

export const updateContactDetailsTool: ToolDefinition<z.infer<typeof UpdateContactInput>, { version: number }> = {
  name: 'update_contact_details',
  description: 'Change a customer\'s phone/email. Requires preview + explicit confirmation.',
  riskTier: 3,
  input: UpdateContactInput,
  output: z.object({ version: z.number().int() }).strict(),
  requiredRoles: ['support_agent', 'support_manager'],
  sensitivity: 'pii',
  timeoutMs: 10_000,
  reversible: true, // prior values retained for restore
  writableFields: ['phone', 'email'],
  targets: (i) => ({ resourceType: 'customer', resourceIds: [i.customerId] }),
  async dryRun(input, ctx, backend) {
    const c = backend.getCustomer(ctx, input.customerId);
    if (!c) throw new Error(`customer ${input.customerId} not found`);
    const changing = Object.keys(input.fields);
    return {
      preview: {
        action: 'update_contact_details',
        target: `Customer ${c.id} — "${c.name}" (tenant: ${ctx.tenantId})`,
        fieldsChanging: changing,
        currentValues: Object.fromEntries(changing.map((f) => [f, maskValue(f, c[f as 'phone' | 'email'])])),
        proposedValues: Object.fromEntries(
          Object.entries(input.fields).map(([f, v]) => [f, maskValue(f, v)])
        ),
        externalRecipients: [],
        financialImpact: null,
        sideEffects: ['customer notified of contact change (standard policy)'],
        reversible: true,
        affectedRecordCount: 1,
      },
      resourceVersions: { [c.id]: c.version },
    };
  },
  async handler(input, ctx, backend, exec) {
    const expectedVersion = exec.resourceVersions[input.customerId];
    if (expectedVersion === undefined) throw new Error('missing resource version — preview required');
    const updated = backend.updateCustomerFields(ctx, input.customerId, input.fields, expectedVersion, exec.idempotencyKey);
    return { version: updated.version };
  },
};

// --- send_approved_email (Tier 3, escalates on bulk) -----------------------

const APPROVED_TEMPLATES = new Set(['contract_renewal_notice', 'password_reset_confirmation', 'shipping_update']);

const SendEmailInput = z.object({
  templateId: z.string().max(64),
  recipients: z.array(z.string().email().max(254)).min(1).max(500),
}).strict();

export const sendApprovedEmailTool: ToolDefinition<z.infer<typeof SendEmailInput>, { sent: number }> = {
  name: 'send_approved_email',
  description: 'Send a pre-approved template to VERIFIED recipients only. No free-form body.',
  riskTier: 3,
  input: SendEmailInput,
  output: z.object({ sent: z.number().int() }).strict(),
  requiredRoles: ['support_agent', 'support_manager'],
  sensitivity: 'pii',
  timeoutMs: 10_000,
  reversible: false, // an email cannot be unsent -> preview shows exact recipients
  targets: () => ({ resourceType: 'tenant_dataset', resourceIds: ['email_audience'] }),
  externalRecipients: (i) => i.recipients,
  affectedRecordCount: (i) => i.recipients.length,
  async dryRun(input, ctx, backend) {
    if (!APPROVED_TEMPLATES.has(input.templateId)) {
      throw new Error(`"${input.templateId}" is not an approved template`);
    }
    const verified = backend.verifiedRecipients(ctx);
    const unverified = input.recipients.filter((r) => !verified.has(r));
    if (unverified.length > 0) {
      // Hard precondition — an injected/hallucinated external address dies
      // here, before any preview or confirmation is even offered.
      throw new Error(`unverified recipient(s): ${unverified.join(', ')}`);
    }
    return {
      preview: {
        action: 'send_approved_email',
        target: `template "${input.templateId}" (tenant: ${ctx.tenantId})`,
        fieldsChanging: [],
        currentValues: {},
        proposedValues: { templateId: input.templateId },
        externalRecipients: input.recipients,
        financialImpact: null,
        sideEffects: [`${input.recipients.length} external email(s) will be sent`],
        reversible: false,
        affectedRecordCount: input.recipients.length,
      },
      resourceVersions: {},
    };
  },
  async handler(input, ctx, backend, exec) {
    // Preconditions re-checked at execution time — dry-run state can go stale.
    if (!APPROVED_TEMPLATES.has(input.templateId)) throw new Error('template not approved');
    const verified = backend.verifiedRecipients(ctx);
    if (input.recipients.some((r) => !verified.has(r))) throw new Error('unverified recipient');
    return backend.sendTemplatedEmail(ctx, input.templateId, input.recipients, exec.idempotencyKey);
  },
};
