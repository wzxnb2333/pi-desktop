import type { Settings, Thread } from '../shared/contracts.ts';
import { mcpToolPolicySchema } from '../shared/mcp-tool-policy.ts';
import { resourceUri } from '../shared/tool-results.ts';
import { mcpConfigurationKey } from '../worker/mcp.ts';

/** Renderer selects a stored block; it cannot supply a URI, server or credentials. */
export function mcpResourceTarget(thread: Thread, settings: Settings, trusted: boolean, itemId: string, index: number) {
  if (!thread.projectId || thread.deletedAt || !trusted || thread.planMode || thread.policy === 'deny' || thread.review || thread.sidechat)
    throw new Error('当前任务权限禁止连接 MCP 资源');
  const item = thread.items.find(item => item.id === itemId && item.role === 'tool');
  const origin = item?.toolResult?.origin;
  const uri = resourceUri(item?.toolResult?.result.content[index]);
  if (!origin || !uri) throw new Error('资源不属于此工具结果');
  const config = settings.mcpServers.find(server => server.enabled && server.id === origin.serverId);
  if (!config || mcpConfigurationKey(config) !== origin.configuration) throw new Error('资源服务配置已变化，请重新运行工具');
  const policy = mcpToolPolicySchema.parse(settings.mcpToolPolicies[config.id]?.[origin.toolName] ?? {});
  if (!policy.enabled || policy.approval === 'deny') throw new Error('当前工具策略禁止调用');
  return { config, uri, timeout: policy.timeoutMs };
}
