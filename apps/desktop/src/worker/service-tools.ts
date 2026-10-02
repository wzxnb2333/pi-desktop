import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { browserDataToolSchema, mcpToolSchema, prToolSchema, resourceToolSchema } from '../shared/service-tools.ts';
import { modelResultContent } from '../shared/tool-results.ts';
import type { DesktopToolRunner } from './browser-tool.ts';

/**
 * Wave 4c service families. Reads are free; anything that starts a process, writes a file outside the task or
 * is visible to other people (a pull request) needs the `ask` policy's approval in the main process. Site
 * policies, data clearing and credentials are not part of these tools at all.
 */
export function browserDataTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_browser_data', label: '管理浏览器数据',
    description: 'Read the Browser panel\'s own data and act on it: recent history (query, paging), the download list, cancel or reveal one download, find text in the tab this chat opened, or read/remove/attach an existing annotation. It cannot change site permissions, clear browsing data or open new origins — those stay user decisions.',
    parameters: Type.Object({
      action: Type.Union(['browser.history', 'browser.downloads', 'browser.download', 'browser.find', 'browser.annotation'].map(value => Type.Literal(value))),
      query: Type.Optional(Type.String({ maxLength: 1000 })),
      text: Type.Optional(Type.String({ maxLength: 1000 })), forward: Type.Optional(Type.Boolean()),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
      tabId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      downloadId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      annotationId: Type.Optional(Type.String({ format: 'uuid' })),
      operation: Type.Optional(Type.Union(['cancel', 'reveal', 'read', 'remove', 'attach'].map(value => Type.Literal(value)))),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(browserDataToolSchema.parse(args), signal ?? AbortSignal.timeout(30000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}

export function prTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_pr', label: '管理拉取请求',
    description: 'Read the pull-request status of the current task, or open the PR view (`view`) or create a PR (`create` needs a title; draft defaults to true). Creating a PR is visible to other people and needs approval under the ask policy; it never pushes branches or changes credentials by itself.',
    parameters: Type.Object({
      action: Type.Union(['pr.status', 'pr.start'].map(value => Type.Literal(value))),
      operation: Type.Optional(Type.Union(['view', 'create'].map(value => Type.Literal(value)))),
      selector: Type.Optional(Type.String({ maxLength: 2000 })),
      title: Type.Optional(Type.String({ maxLength: 1000 })), body: Type.Optional(Type.String({ maxLength: 50000 })),
      base: Type.Optional(Type.String({ maxLength: 300 })), draft: Type.Optional(Type.Boolean()),
      directoryId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(prToolSchema.parse(args), signal ?? AbortSignal.timeout(120000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}

export function resourceTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_resources', label: '管理技能与扩展',
    description: 'Inspect the discovered skills and extensions with their load diagnostics, rescan them, or open one in the editor / reveal it in the file manager. Rescanning re-reads local code and needs approval under the ask policy. Enabling, installing or importing resources is not available here.',
    parameters: Type.Object({
      action: Type.Union(['resources.inspect', 'resources.refresh', 'resources.open'].map(value => Type.Literal(value))),
      resourceId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      reveal: Type.Optional(Type.Boolean()),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(resourceToolSchema.parse(args), signal ?? AbortSignal.timeout(60000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}

export function mcpTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_mcp', label: '管理 MCP 连接',
    description: 'List the MCP servers attached to this chat with their connection state and whether they expose tools, resources or prompts; test one server\'s connection (spawns a process, needs approval under the ask policy), cancel a running test, retry this chat\'s disconnected servers, or read one advertised resource by index. Secrets and OAuth logins are never reachable.',
    parameters: Type.Object({
      action: Type.Union(['mcp.list', 'mcp.test', 'mcp.testCancel', 'mcp.retry', 'mcp.resource'].map(value => Type.Literal(value))),
      serverId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      itemId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      index: Type.Optional(Type.Integer({ minimum: 0, maximum: 255 })),
      requestId: Type.Optional(Type.String({ format: 'uuid' })),
    }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const result = await run(mcpToolSchema.parse(args), signal ?? AbortSignal.timeout(60000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}
