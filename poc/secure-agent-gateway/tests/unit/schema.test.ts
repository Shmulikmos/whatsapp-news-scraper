import { describe, it, expect } from 'vitest';
import { testGateway, supportAgent } from '../helpers.js';

describe('strict input-schema validation (S5/S6)', () => {
  it('rejects unknown extra fields instead of silently stripping them', async () => {
    const { gw } = testGateway();
    const result = await gw.executor.execute(
      supportAgent,
      { tool: 'get_customer', params: { customerId: 'C-10422', includeSsn: true } },
      { correlationId: 'c1', influencedByUntrustedContent: false }
    );
    expect(result.status).toBe('denied');
    if (result.status === 'denied') expect(result.code).toBe('schema_violation');
  });

  it('rejects wrong types and out-of-bounds values', async () => {
    const { gw } = testGateway();
    for (const params of [
      { customerId: 42 },
      { customerId: 'C-10422', limit: 1e9 }, // over row cap
      { customerId: 'C-10422', limit: -1 },
      { customerId: "C-10422' OR 1=1 --" }, // id-format violation
    ]) {
      const result = await gw.executor.execute(
        supportAgent,
        { tool: 'search_orders', params },
        { correlationId: 'c1', influencedByUntrustedContent: false }
      );
      expect(result.status).toBe('denied');
    }
  });

  it('strips gateway-owned fields the model tries to set, and logs the attempt', async () => {
    const { gw } = testGateway();
    const result = await gw.executor.execute(
      supportAgent,
      // A "model" trying to self-authorize: fake tenant, fake tier, fake confirmed flag.
      { tool: 'get_customer', params: { customerId: 'C-10422', tenantId: 'globex', riskTier: 0, confirmed: true } },
      { correlationId: 'c1', influencedByUntrustedContent: false }
    );
    // After stripping, the call is a valid same-tenant read — it executes,
    // scoped to the SESSION tenant (acme), not the claimed one.
    expect(result.status).toBe('executed');
    const stripEvent = gw.audit.all().find((e) => e.decision === 'stripped_params');
    expect(stripEvent?.reason).toMatch(/tenantId/);
    expect(stripEvent?.reason).toMatch(/riskTier/);
    expect(stripEvent?.reason).toMatch(/confirmed/);
  });

  it('rejects negative refund amounts', async () => {
    const { gw } = testGateway();
    const result = await gw.executor.execute(
      supportAgent,
      { tool: 'request_refund', params: { orderId: 'O-8817', amount: -5000, reason: 'refund abuse' } },
      { correlationId: 'c1', influencedByUntrustedContent: false }
    );
    expect(result.status).toBe('denied');
  });

  it('field-level filtering: read output contains no ssn and masks contact fields', async () => {
    const { gw } = testGateway();
    const result = await gw.executor.execute(
      supportAgent,
      { tool: 'get_customer', params: { customerId: 'C-10422' } },
      { correlationId: 'c1', influencedByUntrustedContent: false }
    );
    expect(result.status).toBe('executed');
    if (result.status === 'executed') {
      const out = result.output as Record<string, unknown>;
      expect(out).not.toHaveProperty('ssn');
      expect(out).not.toHaveProperty('tenantId');
      expect(String(out['phone'])).toMatch(/^\*+\d{4}$/);
    }
  });
});
