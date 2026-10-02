import assert from 'node:assert/strict';
import test from 'node:test';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { browserTool } from '../src/worker/browser-tool.ts';
import { manageCommentsTool, manageFilesTool, manageGitTool, managePreviewTool, manageReviewTool, manageTerminalTool, manageWindowsTool, manageWorktreesTool } from '../src/worker/workbench-tools.ts';
import { manageMessagesTool, manageProjectsTool, manageSessionsTool, manageUiTool, readSessionsTool, sendToSessionTool } from '../src/worker/desktop-session-tools.ts';
import { browserDataTool, mcpTool, prTool, resourceTool } from '../src/worker/service-tools.ts';
import { manageSettingsTool } from '../src/worker/settings-tool.ts';
import { allowedSettingsKeys } from '../src/shared/settings-tools.ts';

/**
 * The tool parameters reach the provider as JSON Schema with every request. A construct the provider's schema
 * validator rejects does not fail one call: it fails *every* message with a bodyless 400, which is exactly what
 * `Type.Record(Type.String(), Type.Unknown())` caused (it renders as `patternProperties: {"^.*$": {}}`). This
 * test walks every tool definition we send and refuses the shapes that are known to break a strict gateway.
 */

const runner = (async () => ({ result: { content: [] } })) as never;

const tools: ToolDefinition[] = [
  browserTool(runner), readSessionsTool(runner), manageSessionsTool(runner), sendToSessionTool(runner), manageProjectsTool(runner), manageUiTool(runner),
  manageMessagesTool(runner), manageReviewTool(runner), manageGitTool(runner), manageWorktreesTool(runner), manageTerminalTool(runner),
  manageFilesTool(runner), manageCommentsTool(runner), manageSettingsTool(runner), browserDataTool(runner), prTool(runner), resourceTool(runner), mcpTool(runner),
  manageWindowsTool(runner), managePreviewTool(runner),
];

interface Unsafe { path: string; reason: string }

/** Positions whose value must itself be a schema (object or boolean), never a bare string or number. */
const schemaArrays = ['anyOf', 'oneOf', 'allOf', 'prefixItems'];
const schemaSingles = ['items', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'additionalItems'];
const schemaMaps = ['properties', 'patternProperties', '$defs', 'definitions'];

/**
 * Validates the JSON Schema shape we actually send, without pulling in a validator dependency. It exists
 * because `Type.Union(['user', 'assistant'])` (bare strings instead of `Type.Literal`) renders as
 * `{"anyOf":["user","assistant"]}`, which is not a schema at all: a gateway that checks tool definitions
 * answers every request with a bodyless 400, and the parameter looks harmless at the call site.
 */
function unsafeSchemas(schema: unknown, path = 'schema'): Unsafe[] {
  const found: Unsafe[] = [];
  if (typeof schema === 'boolean') return found;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [{ path, reason: 'not a schema: ' + JSON.stringify(schema)?.slice(0, 60) }];
  const node = schema as Record<string, unknown>;
  if (Object.keys(node).length === 0) found.push({ path, reason: 'empty schema {}' });
  else if (node.patternProperties) found.push({ path, reason: 'patternProperties' });
  else if (node.additionalProperties === true) found.push({ path, reason: 'additionalProperties: true' });
  else if (node.type === undefined && !node.anyOf && !node.oneOf && !node.allOf && !node.$ref && !node.const && !node.enum)
    found.push({ path, reason: 'type-less schema ' + JSON.stringify(node).slice(0, 80) });
  for (const [key, value] of Object.entries(node)) {
    // `required`/`enum`/`examples`/`type` hold plain data, not subschemas.
    if (['required', 'enum', 'examples', 'type', 'default', 'const', 'dependencies'].includes(key)) continue;
    if (schemaMaps.includes(key)) {
      for (const [name, sub] of Object.entries(value as Record<string, unknown>))
        found.push(...unsafeSchemas(key === 'patternProperties' ? {} : sub, `${path}.${key}.${name}`));
      continue;
    }
    if (schemaArrays.includes(key)) {
      if (!Array.isArray(value)) found.push({ path: `${path}.${key}`, reason: 'must be an array' });
      else value.forEach((entry, index) => found.push(...unsafeSchemas(entry, `${path}.${key}[${index}]`)));
      continue;
    }
    if (schemaSingles.includes(key)) {
      found.push(...unsafeSchemas(value, `${path}.${key}`));
      continue;
    }
    if (key === 'additionalProperties') {
      if (value && typeof value === 'object') found.push(...unsafeSchemas(value, `${path}.${key}`));
      continue;
    }
    if (Array.isArray(value)) value.forEach((entry, index) => found.push(...unsafeSchemas(entry, `${path}.${key}[${index}]`)));
    else if (value && typeof value === 'object') found.push(...unsafeSchemas(value, `${path}.${key}`));
  }
  return found;
}

test('every desktop tool parameter schema survives a strict provider validator', () => {
  assert.ok(tools.length >= 20, 'the surface should be wired');
  for (const tool of tools) {
    const schema = tool.parameters;
    assert.ok(schema && typeof schema === 'object', `${tool.name} needs parameters`);
    const unsafe = unsafeSchemas(schema);
    assert.deepEqual(unsafe, [], `${tool.name} sends an unusable schema: ${JSON.stringify(unsafe)}`);
    // Names and descriptions are part of the request too; keep them plain and non-empty.
    assert.match(tool.name, /^[a-z][a-z0-9_]*$/, `${tool.name} must be a plain tool name`);
    assert.ok(tool.description.length > 20 && tool.description.length < 4000, `${tool.name} needs a bounded description`);
  }
});

test('the walker itself catches the shapes that broke every request', () => {
  // This is what Type.Record(Type.String(), Type.Unknown()) rendered as; the guard must never lose sight of it.
  assert.ok(unsafeSchemas({ type: 'object', patternProperties: { '^.*$': {} } }).some(entry => entry.reason === 'patternProperties'));
  assert.ok(unsafeSchemas({ type: 'object', properties: { a: {} } }).some(entry => entry.reason === 'empty schema {}'));
  assert.ok(unsafeSchemas({ type: 'object', additionalProperties: true }).some(entry => entry.reason === 'additionalProperties: true'));
  // And this is what Type.Union(['user', 'assistant']) rendered as: strings where a schema must be.
  const bareStrings = unsafeSchemas({ type: 'array', items: { anyOf: ['user', 'assistant'] } });
  assert.equal(bareStrings.length, 2);
  assert.match(bareStrings[0].reason, /not a schema/);
  assert.deepEqual(unsafeSchemas({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }), []);
});

test('the settings patch advertises exactly the writable keys and no others', () => {  const settings = tools.find(tool => tool.name === 'manage_settings')!;
  const parameters = settings.parameters as { properties?: { patch?: { properties?: Record<string, unknown>; additionalProperties?: unknown } } };
  const patch = parameters.properties?.patch;
  assert.ok(patch?.properties, 'patch must be an explicit object');
  assert.deepEqual(Object.keys(patch.properties).sort(), [...allowedSettingsKeys].sort());
  assert.equal(patch.additionalProperties, false, 'the provider should refuse unknown keys before we do');
});
