import { createHash } from 'node:crypto';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { Type } from 'typebox';
import type { McpConfig, Thread } from '../shared/contracts.ts';
import { validateMcpConfiguration } from '../shared/mcp-configuration.ts';
import { mcpToolPolicySchema, type McpToolPolicy } from '../shared/mcp-tool-policy.ts';
import { mcpResultSchema, mcpResourceResultSchema, modelResultContent, validateResultSize } from '../shared/tool-results.ts';

export type McpTokenProvider = (config: McpConfig, rejectedToken?: string) => Promise<string>;
export function mcpConfigurationKey(config: McpConfig): string {
  return createHash('sha256').update(JSON.stringify([config.id, config.transport, config.command, config.args, config.url, config.oauth ?? null])).digest('hex');
}

export class McpConnection {
  readonly discovered: NonNullable<Thread['mcp']>[number]['tools'] = [];
  readonly policies = new Map<string, McpToolPolicy>();
  readonly client = new Client({ name: 'pi-desktop', version: '0.1.0' });
  private readonly outputValidator = new AjvJsonSchemaValidator();
  private closing?: Promise<void>;
  private transportClosing?: Promise<void>;
  private detachAbort?: () => void;
  async connect(config: McpConfig, secrets: Record<string, string>, cwd: string, tokenProvider?: McpTokenProvider, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.closing = undefined;
    this.transportClosing = undefined;
    if (signal) {
      const abort = () => { void this.close().catch(() => {}); };
      signal.addEventListener('abort', abort, { once: true });
      this.detachAbort = () => signal.removeEventListener('abort', abort);
    }
    validateMcpConfiguration(config, true);
    if (config.transport === 'stdio') {
      if (!config.command.trim()) throw new Error(`${config.name} 缺少启动命令`);
      const transport = new StdioClientTransport({
          command: config.command,
          args: config.args,
          cwd,
          env: { ...(process.env as Record<string, string>), ...secrets },
          stderr: 'pipe',
        });
      // Consume stderr without persisting credentials a third-party process might print.
      // Leaving a piped stream unread can block the server before the MCP handshake.
      transport.stderr?.on('data', () => {});
      await this.connectTransport(transport, signal);
    } else {
      const url = new URL(config.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('MCP URL 必须使用 HTTP(S)');
      const authorizedFetch: typeof fetch | undefined = config.oauth ? async (input, init) => {
        if (!tokenProvider) throw new Error('请先在 MCP 设置中登录 OAuth');
        const target = new URL(input instanceof Request ? input.url : String(input));
        if (target.origin !== url.origin) throw new Error('OAuth request origin mismatch');
        const token = await tokenProvider(config);
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)); headers.set('Authorization', 'Bearer ' + token);
        const response = await fetch(input, { ...init, headers, redirect: 'error' });
        if (response.status !== 401) return response;
        await response.body?.cancel(); headers.set('Authorization', 'Bearer ' + await tokenProvider(config, token));
        return fetch(input, { ...init, headers, redirect: 'error' });
      } : undefined;
      await this.connectTransport(
        new StreamableHTTPClientTransport(url, { requestInit: { headers: secrets }, ...(authorizedFetch ? { fetch: authorizedFetch } : {}) }),
        signal,
      );
    }
    signal?.throwIfAborted();
  }
  async tools(config: McpConfig, policies: Record<string, McpToolPolicy> = {}, signal?: AbortSignal): Promise<ToolDefinition[]> {
    this.discovered.length = 0; this.policies.clear();
    const definitions: ToolDefinition[] = [];
    const cursors = new Set<string>();
    const names = new Set<string>();
    let cursor: string | undefined;
    do {
      signal?.throwIfAborted();
      const page = await this.client.listTools(cursor ? { cursor } : undefined, { signal });
      signal?.throwIfAborted();
      for (const tool of page.tools) {
        if (names.has(tool.name)) throw new Error('MCP 工具列表包含重复名称：' + tool.name);
        names.add(tool.name);
        const name = 'mcp_' + createHash('sha256').update(config.id + ':' + tool.name).digest('hex').slice(0, 12) + '_' + tool.name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 42);
        const policy = mcpToolPolicySchema.parse(policies[tool.name] ?? {}); this.policies.set(name, policy);
        this.discovered.push({ name, sourceName: tool.name, label: config.name + ' · ' + tool.name, description: tool.description || tool.name });
        if (!policy.enabled) continue;
        const validateOutput = tool.outputSchema ? this.outputValidator.getValidator(tool.outputSchema) : undefined;
        definitions.push({
          name,
          label: `${config.name} · ${tool.name}`,
          description: tool.description || tool.name,
          parameters: Type.Unsafe(tool.inputSchema),
          execute: async (_id, parameters, signal) => {
            if (!policy.enabled || policy.approval === 'deny') throw new Error('当前工具策略禁止调用');
            const result = mcpResultSchema.parse(await this.client.request(
              { method: 'tools/call', params: { name: tool.name, arguments: parameters as Record<string, unknown> } },
              ResultSchema,
              { signal, timeout: policy.timeoutMs, resetTimeoutOnProgress: false, maxTotalTimeout: policy.timeoutMs },
            ));
            validateResultSize(result);
            if (validateOutput && !result.isError && !result.structuredContent) throw new Error('工具未返回声明的结构化结果');
            if (validateOutput && result.structuredContent && !validateOutput(result.structuredContent).valid) throw new Error('工具结构化结果不符合声明的格式');
            return { content: modelResultContent(result), details: { toolResult: {
              origin: { serverId: config.id, toolName: tool.name, configuration: mcpConfigurationKey(config) }, result,
            } } };
          },
        });
      }
      cursor = page.nextCursor;
      if (cursor) {
        if (cursors.has(cursor)) throw new Error('MCP 工具列表返回重复分页标识，无法完成加载');
        cursors.add(cursor);
      }
    } while (cursor);
    return definitions;
  }
  async close(): Promise<void> {
    this.detachAbort?.(); this.detachAbort = undefined;
    // All owners await the same shutdown, including the SDK's unawaited close on failure.
    this.closing ??= this.client.close();
    await this.closing;
    await this.transportClosing;
  }
  private async connectTransport(transport: Transport, signal?: AbortSignal): Promise<void> {
    const close = transport.close.bind(transport);
    transport.close = () => this.transportClosing ??= close();
    await this.client.connect(transport, { signal });
  }
  async readResource(uri: string, signal: AbortSignal, timeout: number) {
    const result = mcpResourceResultSchema.parse(await this.client.request({ method: 'resources/read', params: { uri } }, ResultSchema,
      { signal, timeout, resetTimeoutOnProgress: false, maxTotalTimeout: timeout }));
    validateResultSize(result);
    return { result: { ...result, content: result.contents.map(resource => ({ type: 'resource', resource })) } };
  }
}
