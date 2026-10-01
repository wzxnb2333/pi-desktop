import type { McpConfig } from './contracts.ts';

export type McpConfigurationErrors = Partial<Record<'name' | 'command' | 'url' | 'secret', string>>;

export function mcpConfigurationErrors(config: McpConfig, connecting = false): McpConfigurationErrors {
  const errors: McpConfigurationErrors = {};
  if (!config.name.trim()) errors.name = '请填写服务名称';
  if (config.enabled || connecting) {
    if (config.transport === 'stdio') {
      if (!config.command.trim()) errors.command = '请填写启动命令';
    } else {
      try {
        const url = new URL(config.url.trim());
        if (!['http:', 'https:'].includes(url.protocol)) errors.url = 'MCP URL 必须使用 HTTP(S)';
      } catch { errors.url = '请填写完整的 HTTP(S) 端点地址'; }
    }
  }
  return errors;
}

export function validateMcpConfiguration(config: McpConfig, connecting = false): void {
  const errors = Object.values(mcpConfigurationErrors(config, connecting));
  if (errors.length) throw new Error(errors.join('；'));
}

export function parseMcpSecrets(text: string): Record<string, string> | undefined {
  if (!text.trim()) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(item => typeof item === 'string'))
      return value as Record<string, string>;
  } catch { /* Report the expected format without echoing secret input. */ }
  throw new Error('加密环境变量需为字符串值的 JSON 对象');
}

export function mcpSecretEntries(entries: Array<[string, string]>, transport: McpConfig['transport']): Record<string, string> {
  if (entries.length > 100) throw new Error('连接凭据最多 100 项');
  const names = new Set<string>();
  return Object.fromEntries(entries.map(([source, value]) => {
    const name = source.trim();
    const valid = transport === 'stdio' ? /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) : /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name);
    if (!valid || name.length > 256) throw new Error('请填写有效的凭据名称');
    if (names.has(name.toLowerCase())) throw new Error('凭据名称不能重复');
    if (value.length > 16000 || value.includes('\0') || (transport === 'http' && /[\r\n]/.test(value))) throw new Error('凭据值格式无效或超过 16000 字符');
    names.add(name.toLowerCase()); return [name, value];
  }));
}
