/**
 * Composition root: builds a fully-wired gateway (registry frozen, executor,
 * confirmation service, audit log, orchestrator) over the fake backend.
 */
import { randomBytes } from 'node:crypto';
import { ToolRegistry } from './tools/registry.js';
import { getCustomerTool, searchOrdersTool } from './tools/definitions/read-tools.js';
import { addNoteTool, updateContactDetailsTool, sendApprovedEmailTool } from './tools/definitions/write-tools.js';
import { requestRefundTool, exportCustomerRecordsTool } from './tools/definitions/high-impact-tools.js';
import { ConfirmationService } from './confirmation/service.js';
import { AuditLog } from './audit/audit.js';
import { Executor } from './execution/executor.js';
import { Orchestrator, type LLMClient } from './agent/orchestrator.js';
import { seededBackend, type FakeBackend } from './backend/fake-backend.js';

export interface Gateway {
  registry: ToolRegistry;
  confirmations: ConfirmationService;
  audit: AuditLog;
  executor: Executor;
  orchestrator: Orchestrator;
  backend: FakeBackend;
}

export function buildGateway(llm: LLMClient, opts: { now?: () => number; confirmationTtlMs?: number } = {}): Gateway {
  const now = opts.now ?? Date.now;
  const registry = new ToolRegistry();
  registry.register(getCustomerTool);
  registry.register(searchOrdersTool);
  registry.register(addNoteTool);
  registry.register(updateContactDetailsTool);
  registry.register(sendApprovedEmailTool);
  registry.register(requestRefundTool);
  registry.register(exportCustomerRecordsTool);
  registry.freeze(); // nothing can add capabilities after startup

  const backend = seededBackend();
  const audit = new AuditLog(now);
  const confirmations = new ConfirmationService(randomBytes(32), opts.confirmationTtlMs ?? 120_000, now);
  const executor = new Executor(registry, confirmations, audit, backend, now);
  const orchestrator = new Orchestrator(llm, executor, registry, audit);
  return { registry, confirmations, audit, executor, orchestrator, backend };
}
