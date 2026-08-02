import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { ConfirmationService, computeActionHash } from '../../src/confirmation/service.js';

const action = {
  tool: 'update_contact_details',
  params: { customerId: 'C-10422', fields: { phone: '+97235550177' } },
  resourceVersions: { 'C-10422': 17 },
  userId: 'u_991',
  tenantId: 'acme',
};

describe('confirmation tokens', () => {
  it('valid token verifies exactly once (single-use, replay-proof)', () => {
    const svc = new ConfirmationService(randomBytes(32));
    const hash = computeActionHash(action);
    const token = svc.issue(hash, 'u_991', 's_1');

    expect(svc.validateAndConsume(token, hash, 'u_991', 's_1').ok).toBe(true);
    const replay = svc.validateAndConsume(token, hash, 'u_991', 's_1');
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toBe('already_used');
  });

  it('rejects forged signatures (tampered payload)', () => {
    const svc = new ConfirmationService(randomBytes(32));
    const hash = computeActionHash(action);
    const token = svc.issue(hash, 'u_991', 's_1');
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString());
    payload.exp += 1_000_000; // attacker extends TTL
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${parts[1]}`;
    const check = svc.validateAndConsume(forged, hash, 'u_991', 's_1');
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('bad_signature');
  });

  it('rejects tokens signed with a different secret', () => {
    const svcA = new ConfirmationService(randomBytes(32));
    const svcB = new ConfirmationService(randomBytes(32));
    const hash = computeActionHash(action);
    const token = svcA.issue(hash, 'u_991', 's_1');
    expect(svcB.validateAndConsume(token, hash, 'u_991', 's_1').ok).toBe(false);
  });

  it('rejects expired tokens', () => {
    let t = 1_000_000;
    const svc = new ConfirmationService(randomBytes(32), 120_000, () => t);
    const hash = computeActionHash(action);
    const token = svc.issue(hash, 'u_991', 's_1');
    t += 120_001;
    const check = svc.validateAndConsume(token, hash, 'u_991', 's_1');
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('expired');
  });

  it('rejects tokens from another session or user', () => {
    const svc = new ConfirmationService(randomBytes(32));
    const hash = computeActionHash(action);
    const token = svc.issue(hash, 'u_991', 's_1');
    expect(svc.validateAndConsume(token, hash, 'u_991', 's_OTHER').ok).toBe(false);
    expect(svc.validateAndConsume(token, hash, 'u_OTHER', 's_1').ok).toBe(false);
  });

  it('binds to the exact action: changed params or resource version invalidates', () => {
    const svc = new ConfirmationService(randomBytes(32));
    const token = svc.issue(computeActionHash(action), 'u_991', 's_1');

    const differentParams = computeActionHash({ ...action, params: { customerId: 'C-10422', fields: { phone: '+97230000000' } } });
    const check1 = svc.validateAndConsume(token, differentParams, 'u_991', 's_1');
    expect(check1.ok).toBe(false);
    if (!check1.ok) expect(check1.reason).toBe('wrong_action');

    // Record edited since preview -> version changed -> token useless.
    const bumpedVersion = computeActionHash({ ...action, resourceVersions: { 'C-10422': 18 } });
    const token2 = svc.issue(computeActionHash(action), 'u_991', 's_1');
    const check2 = svc.validateAndConsume(token2, bumpedVersion, 'u_991', 's_1');
    expect(check2.ok).toBe(false);
    if (!check2.ok) expect(check2.reason).toBe('wrong_action');
  });
});
