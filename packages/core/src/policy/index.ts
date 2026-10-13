import type { ApprovalMode } from '../config/schema.js';
import type { Tool, ToolContext, ToolRiskDetail } from '../tools/types.js';
import { PIPE_TO_SHELL } from '../tools/terminal.js';

export type PolicyAction = 'allow' | 'ask' | 'deny';

export interface PolicyDecision {
  action: PolicyAction;
  /** Machine-readable reason (i18n key suffix) */
  reason:
    | 'forbidden'
    | 'yolo'
    | 'read'
    | 'network'
    | 'write-inside'
    | 'write-outside'
    | 'exec-allowlisted'
    | 'exec'
    | 'session-allowed'
    | 'pipe-to-shell';
  detail: ToolRiskDetail;
  summary: string;
}

export interface PolicyState {
  mode: ApprovalMode;
  allowlist: readonly string[];
  /** Tools the user approved "for this session" (tool name or `tool:program`). */
  sessionAllowed: Set<string>;
}

export function createPolicyState(
  mode: ApprovalMode,
  allowlist: readonly string[] = [],
): PolicyState {
  return { mode, allowlist, sessionAllowed: new Set() };
}

export function sessionKey(tool: Tool, detail: ToolRiskDetail): string {
  return detail.program ? `${tool.name}:${detail.program}` : tool.name;
}

export function decide(
  tool: Tool,
  args: unknown,
  ctx: ToolContext,
  state: PolicyState,
): PolicyDecision {
  const detail: ToolRiskDetail = tool.classify ? tool.classify(args, ctx) : { risk: tool.risk };
  const summary = tool.summarize ? tool.summarize(args as never) : tool.name;
  if (detail.forbidden) return { action: 'deny', reason: 'forbidden', detail, summary };
  if (state.mode === 'yolo') return { action: 'allow', reason: 'yolo', detail, summary };
  if (state.sessionAllowed.has(sessionKey(tool, detail)) || state.sessionAllowed.has(tool.name)) {
    return { action: 'allow', reason: 'session-allowed', detail, summary };
  }
  switch (detail.risk) {
    case 'read':
      return { action: 'allow', reason: 'read', detail, summary };
    case 'network':
      return { action: 'allow', reason: 'network', detail, summary };
    case 'write':
      return detail.outsideWorkspace
        ? { action: 'ask', reason: 'write-outside', detail, summary }
        : { action: 'allow', reason: 'write-inside', detail, summary };
    case 'exec': {
      const command = (args as { command?: string })?.command ?? '';
      if (PIPE_TO_SHELL.test(command))
        return { action: 'ask', reason: 'pipe-to-shell', detail, summary };
      if (
        state.mode === 'allowlist' &&
        detail.program &&
        state.allowlist.includes(detail.program)
      ) {
        return { action: 'allow', reason: 'exec-allowlisted', detail, summary };
      }
      return { action: 'ask', reason: 'exec', detail, summary };
    }
    default:
      return { action: 'ask', reason: 'exec', detail, summary };
  }
}
