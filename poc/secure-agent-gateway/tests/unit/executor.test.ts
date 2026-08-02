import { describe, it, expect } from 'vitest';
import { testGateway, supportAgent } from '../helpers.js';

async function confirmAndExecute(gw: ReturnType<typeof testGateway>['gw'], proposal: { tool: string; params: unknown }) {
  const first = await gw.executor.execute(supportAgent, proposal, {
    correlationId: 'c1',
    influencedByUntrustedContent: false,
  });
  expect(first.status).toBe('confirmation_required');
  if (first.status !== 'confirmation_required') throw new Error('unreachable');
  return gw.executor.execute(supportAgent, proposal, {
    correlationId: 'c2',
    influencedByUntrustedContent: false,
    confirmationToken: first.confirmationToken,
  });
}

describe('executor pipeline', () => {
  it('tier-2 write executes without confirmation and is idempotent (S7)', async () => {
    const { gw } = testGateway();
    const proposal = { tool: 'add_note', params: { customerId: 'C-10422', note: 'called back' } };
    const r1 = await gw.executor.execute(supportAgent, proposal, { correlationId: 'c1', influencedByUntrustedContent: false });
    const r2 = await gw.executor.execute(supportAgent, proposal, { correlationId: 'c2', influencedByUntrustedContent: false });
    expect(r1.status).toBe('executed');
    expect(r2.status).toBe('executed');
    // Exactly one side effect despite two identical calls.
    const c = gw.backend.getCustomer(supportAgent, 'C-10422');
    expect(c?.notes).toEqual(['called back']);
  });

  it('tier-3 write runs preview -> confirm -> execute, exactly one side effect', async () => {
    const { gw } = testGateway();
    const proposal = { tool: 'update_contact_details', params: { customerId: 'C-10422', fields: { phone: '+97235550177' } } };
    const result = await confirmAndExecute(gw, proposal);
    expect(result.status).toBe('executed');
    expect(gw.backend.getCustomer(supportAgent, 'C-10422')?.phone).toBe('+97235550177');
  });

  it('optimistic locking: record changed between preview and confirm -> conflict, no write (S14)', async () => {
    const { gw } = testGateway();
    const proposal = { tool: 'update_contact_details', params: { customerId: 'C-10422', fields: { phone: '+97235550177' } } };
    const first = await gw.executor.execute(supportAgent, proposal, { correlationId: 'c1', influencedByUntrustedContent: false });
    expect(first.status).toBe('confirmation_required');
    if (first.status !== 'confirmation_required') return;

    // Concurrent change bumps the version after the preview was issued.
    gw.backend.updateCustomerFields(supportAgent, 'C-10422', { name: 'Dana L.' }, 17, 'other-write');

    const second = await gw.executor.execute(supportAgent, proposal, {
      correlationId: 'c2', influencedByUntrustedContent: false, confirmationToken: first.confirmationToken,
    });
    expect(second.status).toBe('conflict');
    expect(gw.backend.getCustomer(supportAgent, 'C-10422')?.phone).toBe('+97235550100'); // unchanged
  });

  it('audit chain covers the full flow and verifies (S25/audit)', async () => {
    const { gw } = testGateway();
    await confirmAndExecute(gw, { tool: 'update_contact_details', params: { customerId: 'C-10422', fields: { phone: '+97235550177' } } });
    const stages = gw.audit.all().map((e) => e.stage);
    for (const s of ['authorization', 'policy', 'confirmation_issued', 'confirmation_consumed', 'execution_attempt', 'execution_result']) {
      expect(stages).toContain(s);
    }
    expect(gw.audit.verifyChain()).toBe(true);
  });

  it('audit redacts sensitive parameter values at write time', async () => {
    const { gw } = testGateway();
    await confirmAndExecute(gw, { tool: 'update_contact_details', params: { customerId: 'C-10422', fields: { phone: '+97235550177' } } });
    const serialized = JSON.stringify(gw.audit.all());
    expect(serialized).not.toContain('+97235550177'); // masked everywhere
  });

  it('backend timeout -> unconfirmed_outcome, never a success claim (S17)', async () => {
    const { gw } = testGateway();
    // Simulate a stuck backend: a hanging tool with a tight timeout budget.
    const { ToolRegistry } = await import('../../src/tools/registry.js');
    const { Executor } = await import('../../src/execution/executor.js');
    const { addNoteTool } = await import('../../src/tools/definitions/write-tools.js');
    const registry = new ToolRegistry();
    registry.register({ ...addNoteTool, timeoutMs: 50, handler: () => new Promise(() => {}) });
    registry.freeze();
    const executor = new Executor(registry, gw.confirmations, gw.audit, gw.backend);
    const result = await executor.execute(
      supportAgent,
      { tool: 'add_note', params: { customerId: 'C-10422', note: 'x' } },
      { correlationId: 'c1', influencedByUntrustedContent: false }
    );
    expect(result.status).toBe('unconfirmed_outcome');
    const last = gw.audit.all().at(-1);
    expect(last?.executionState).toBe('failed');
    expect(last?.error).toMatch(/unconfirmed/);
  });
});
