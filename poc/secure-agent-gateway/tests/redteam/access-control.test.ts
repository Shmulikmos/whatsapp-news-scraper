/**
 * Red-team: cross-tenant access (S2), privilege escalation (S9),
 * confirmation bypass (S8), bulk extraction (S10), destructive attempts (S11).
 */
import { describe, it, expect } from 'vitest';
import { testGateway, supportAgent, viewer, globexAgent, withStepUp } from '../helpers.js';

describe('cross-tenant isolation (S2)', () => {
  it('reading another tenant\'s customer is denied without existence disclosure', async () => {
    const { gw } = testGateway();
    // C-90001 belongs to tenant "globex"; caller is "acme".
    const res = await gw.executor.execute(
      supportAgent,
      { tool: 'get_customer', params: { customerId: 'C-90001' } },
      { correlationId: 'c1', influencedByUntrustedContent: false }
    );
    expect(res.status).toBe('denied');
    if (res.status === 'denied') expect(res.reason).toMatch(/not accessible/);
  });

  it('search is structurally scoped: globex agent sees zero acme orders', async () => {
    const { gw } = testGateway();
    const res = await gw.executor.execute(
      globexAgent,
      { tool: 'search_orders', params: { customerId: 'C-10422', limit: 50 } },
      { correlationId: 'c1', influencedByUntrustedContent: false }
    );
    // Object-level authz denies before the query even runs (no oracle).
    expect(res.status).toBe('denied');
  });

  it('cross-tenant write attempt cannot succeed even with a confirmation flow', async () => {
    const { gw } = testGateway();
    const res = await gw.executor.execute(
      globexAgent,
      { tool: 'update_contact_details', params: { customerId: 'C-10422', fields: { phone: '+97230000000' } } },
      { correlationId: 'c1', influencedByUntrustedContent: false }
    );
    expect(res.status).toBe('denied');
    expect(gw.backend.getCustomer(supportAgent, 'C-10422')?.phone).toBe('+97235550100');
  });
});

describe('privilege escalation (S9, S1)', () => {
  it('viewer role cannot invoke write tools', async () => {
    const { gw } = testGateway();
    for (const proposal of [
      { tool: 'add_note', params: { customerId: 'C-10422', note: 'hi' } },
      { tool: 'update_contact_details', params: { customerId: 'C-10422', fields: { phone: '+97230000000' } } },
      { tool: 'request_refund', params: { orderId: 'O-8817', amount: 10, reason: 'because I can' } },
    ]) {
      const res = await gw.executor.execute(viewer, proposal, { correlationId: 'c1', influencedByUntrustedContent: false });
      expect(res.status).toBe('denied');
      if (res.status === 'denied') expect(res.code).toBe('authz_denied');
    }
  });

  it('field-level: a tool cannot write outside its declared writable fields', async () => {
    const { gw } = testGateway();
    // "plan" is not a writable field of update_contact_details — schema rejects it
    // (strict), and even a schema hole would be caught by the field-level check.
    const res = await gw.executor.execute(
      supportAgent,
      { tool: 'update_contact_details', params: { customerId: 'C-10422', fields: { plan: 'enterprise' } } },
      { correlationId: 'c1', influencedByUntrustedContent: false }
    );
    expect(res.status).toBe('denied');
  });
});

describe('confirmation bypass (S8)', () => {
  const proposal = { tool: 'update_contact_details', params: { customerId: 'C-10422', fields: { phone: '+97235550177' } } };

  it('tier-3 without a token never executes', async () => {
    const { gw } = testGateway();
    const res = await gw.executor.execute(supportAgent, proposal, { correlationId: 'c1', influencedByUntrustedContent: false });
    expect(res.status).toBe('confirmation_required');
    expect(gw.backend.getCustomer(supportAgent, 'C-10422')?.phone).toBe('+97235550100');
  });

  it('a garbage/forged token is rejected', async () => {
    const { gw } = testGateway();
    const res = await gw.executor.execute(supportAgent, proposal, {
      correlationId: 'c1', influencedByUntrustedContent: false, confirmationToken: 'aaaa.bbbb',
    });
    expect(res.status).toBe('denied');
  });

  it('a token for action A cannot execute action B', async () => {
    const { gw } = testGateway();
    const first = await gw.executor.execute(supportAgent, proposal, { correlationId: 'c1', influencedByUntrustedContent: false });
    if (first.status !== 'confirmation_required') throw new Error('expected confirmation_required');
    const other = { tool: 'update_contact_details', params: { customerId: 'C-20011', fields: { phone: '+97235550999' } } };
    const res = await gw.executor.execute(supportAgent, other, {
      correlationId: 'c2', influencedByUntrustedContent: false, confirmationToken: first.confirmationToken,
    });
    expect(res.status).not.toBe('executed');
    expect(gw.backend.getCustomer(supportAgent, 'C-20011')?.phone).toBe('+97235550200');
  });

  it('double-submit of a confirmation produces exactly one side effect (S7)', async () => {
    const { gw } = testGateway();
    const first = await gw.executor.execute(supportAgent, proposal, { correlationId: 'c1', influencedByUntrustedContent: false });
    if (first.status !== 'confirmation_required') throw new Error('expected confirmation_required');
    const opts = { correlationId: 'c2', influencedByUntrustedContent: false, confirmationToken: first.confirmationToken };
    const r1 = await gw.executor.execute(supportAgent, proposal, opts);
    const r2 = await gw.executor.execute(supportAgent, proposal, opts);
    expect(r1.status).toBe('executed');
    // Second submit cannot execute: the single-use token was consumed and the
    // record version moved, so the action hash no longer matches (conflict).
    expect(r2.status).not.toBe('executed');
    expect(gw.backend.getCustomer(supportAgent, 'C-10422')?.version).toBe(18); // exactly one bump
  });
});

describe('bulk extraction & financial gates (S10)', () => {
  it('row caps hold regardless of requested limit', async () => {
    const { gw } = testGateway();
    const res = await gw.executor.execute(
      supportAgent,
      { tool: 'search_orders', params: { customerId: 'C-10422', limit: 999999 } },
      { correlationId: 'c1', influencedByUntrustedContent: false }
    );
    expect(res.status).toBe('denied'); // schema max(50) rejects outright
  });

  it('a $5,000 refund parks pending finance approval even after confirm + step-up', async () => {
    const { gw } = testGateway();
    const ctx = withStepUp(supportAgent, Date.now());
    const proposal = { tool: 'request_refund', params: { orderId: 'O-8817', amount: 5000, reason: 'defective goods batch' } };
    const first = await gw.executor.execute(ctx, proposal, { correlationId: 'c1', influencedByUntrustedContent: false });
    if (first.status !== 'confirmation_required') throw new Error(`expected confirmation, got ${first.status}`);
    const second = await gw.executor.execute(ctx, proposal, {
      correlationId: 'c2', influencedByUntrustedContent: false, confirmationToken: first.confirmationToken,
    });
    expect(second.status).toBe('pending_approval');
    if (second.status === 'pending_approval') expect(second.approverRole).toBe('finance_approver');
    // No money moved, no refund request executed.
    expect(gw.backend.refundRequests).toHaveLength(0);
  });

  it('refund exceeding refundable balance is refused at precondition', async () => {
    const { gw } = testGateway();
    const ctx = withStepUp(supportAgent, Date.now());
    const res = await gw.executor.execute(
      ctx,
      { tool: 'request_refund', params: { orderId: 'O-8810', amount: 400, reason: 'testing overdraw' } },
      { correlationId: 'c1', influencedByUntrustedContent: false }
    );
    expect(res.status).toBe('denied');
    if (res.status === 'denied') expect(res.reason).toMatch(/exceeds refundable/);
  });

  it('step-up is required for tier 4 even with valid confirmation (mfa is not enough)', async () => {
    const { gw } = testGateway();
    const proposal = { tool: 'request_refund', params: { orderId: 'O-8810', amount: 100, reason: 'goodwill credit' } };
    const first = await gw.executor.execute(supportAgent, proposal, { correlationId: 'c1', influencedByUntrustedContent: false });
    if (first.status !== 'confirmation_required') throw new Error('expected confirmation_required');
    const second = await gw.executor.execute(supportAgent, proposal, {
      correlationId: 'c2', influencedByUntrustedContent: false, confirmationToken: first.confirmationToken,
    });
    expect(second.status).toBe('step_up_required');
  });
});
