/**
 * Authorization enforcement (PEP). Runs for EVERY tool call, at execution
 * time, against the authenticated session — never against anything the model
 * said. Checks: action-level (RBAC), tenant/object-level, field-level.
 */
import type { AuthContext, ResourceTarget } from '../types.js';
import type { AnyTool } from '../tools/tool.js';
import type { FakeBackend } from '../backend/fake-backend.js';

export interface AuthzDecision {
  readonly result: 'allow' | 'deny';
  readonly checks: string[];
  readonly reason?: string;
}

export function authorize(
  ctx: AuthContext,
  tool: AnyTool,
  target: ResourceTarget,
  requestedWriteFields: readonly string[],
  backend: FakeBackend
): AuthzDecision {
  const checks: string[] = [];

  // Action-level: may this role invoke this tool at all?
  checks.push('rbac');
  if (!tool.requiredRoles.some((r) => ctx.roles.includes(r))) {
    return { result: 'deny', checks, reason: `role(s) [${ctx.roles.join(',')}] may not invoke ${tool.name}` };
  }

  // Tenant / object-level: every referenced resource must exist INSIDE the
  // caller's tenant. The backend read is itself tenant-scoped (RLS analog),
  // so a cross-tenant ID is indistinguishable from a nonexistent one — we
  // deny without confirming existence (no oracle).
  checks.push('tenant', 'object');
  for (const id of target.resourceIds) {
    const visible =
      target.resourceType === 'customer'
        ? backend.getCustomer(ctx, id) !== undefined
        : target.resourceType === 'order'
          ? backend.getOrder(ctx, id) !== undefined
          : target.resourceType === 'tenant_dataset' // aggregate targets (exports, bulk email)
            ? true
            : false;
    if (!visible) {
      return { result: 'deny', checks, reason: `resource ${target.resourceType}/${id} not accessible` };
    }
  }

  // Field-level: a write tool may only touch its declared writable fields.
  checks.push('field');
  if (requestedWriteFields.length > 0) {
    const allowed = new Set(tool.writableFields ?? []);
    const violation = requestedWriteFields.find((f) => !allowed.has(f));
    if (violation !== undefined) {
      return { result: 'deny', checks, reason: `field "${violation}" is not writable via ${tool.name}` };
    }
  }

  return { result: 'allow', checks };
}
