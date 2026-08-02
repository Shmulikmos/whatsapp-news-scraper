import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import { getCustomerTool } from '../../src/tools/definitions/read-tools.js';
import { executeSqlToolNEVER } from '../../src/tools/definitions/prohibited-example.js';
import { testGateway, supportAgent } from '../helpers.js';

describe('secure tool registry', () => {
  it('rejects categorically prohibited tools at registration time', () => {
    const reg = new ToolRegistry();
    expect(() => reg.register(executeSqlToolNEVER)).toThrowError(/categorically prohibited/);
  });

  it('refuses runtime registration after freeze', () => {
    const reg = new ToolRegistry();
    reg.freeze();
    expect(() => reg.register(getCustomerTool)).toThrowError(/frozen/);
  });

  it('uses exact-match lookup only — no fuzzy matching for near-miss names', () => {
    const reg = new ToolRegistry();
    reg.register(getCustomerTool);
    reg.freeze();
    expect(reg.get('get_customer')).toBeDefined();
    expect(reg.get('get_customers')).toBeUndefined();
    expect(reg.get('GET_CUSTOMER')).toBeUndefined();
    expect(reg.get('get customer')).toBeUndefined();
  });

  it('requires a dryRun (preview) for tier >= 3 tools', () => {
    const reg = new ToolRegistry();
    const { dryRun: _dryRun, ...noDryRun } = { ...getCustomerTool, name: 'sensitive_thing', riskTier: 3 as const };
    expect(() => reg.register(noDryRun)).toThrowError(/previews are mandatory/);
  });

  it('executor hard-rejects hallucinated tool names and audits them', async () => {
    const { gw } = testGateway();
    const result = await gw.executor.execute(
      supportAgent,
      { tool: 'delete_customer', params: {} },
      { correlationId: 'c1', influencedByUntrustedContent: false }
    );
    expect(result.status).toBe('denied');
    if (result.status === 'denied') expect(result.code).toBe('unknown_tool');
    expect(gw.audit.all().some((e) => e.stage === 'security_event' && /unknown tool/.test(e.reason ?? ''))).toBe(true);
  });
});
