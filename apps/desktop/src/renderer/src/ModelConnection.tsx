import { localizeLabel, tr } from "../../shared/localization.ts";
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { useLocale } from "./hooks/use-locale.ts";
import { type ModelCatalog, type Provider, thinkingSchema } from '../../shared/contracts.ts';
import { builtinConnection, CUSTOM_APIS, type ConnectionMode } from '../../shared/model-configuration.ts';
import { allowedThinkingLevels } from '../../shared/thinking.ts';
import { thinkingLabels } from './lib/labels.ts';
import { Button } from './components/primitives/button.tsx';
import { FieldRow } from './components/primitives/field-row.tsx';

const API_LABELS: Record<Provider['api'], string> = {
  get 'openai-completions'() { return tr("OpenAI 兼容（Chat Completions）"); },
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
  'google-generative-ai': 'Google Generative AI',
};

export function ModelConnection({ provider, mode, catalog, catalogError, credentials, onRetry, onModeChange, onChange, onConvert }: {
  provider: Provider;
  mode: ConnectionMode;
  catalog: ModelCatalog | null;
  catalogError: string;
  credentials?: ReactNode;
  onRetry(): void;
  onModeChange(mode: ConnectionMode): void;
  onChange(value: Partial<Provider>): void;
  onConvert(): void;
}) {
  useLocale();
  const group = catalog?.find(({ id }) => id === provider.provider);
  const model = group?.models.find(({ id }) => id === provider.model);
  const legacyOverride = mode === 'custom' && !provider.custom;
  const prefix = 'connection-' + provider.id;
  const supportsThinking = provider.custom ? provider.reasoning : model?.reasoning;
  const availableLevels = provider.custom ? thinkingSchema.options : model?.thinkingLevels ?? [];
  const selectedLevels = provider.thinkingLevels ?? model?.thinkingLevels ?? allowedThinkingLevels(provider);
  return (
    <div className="model-connection">
      <fieldset className="connection-modes">
        <legend>{tr("连接方式")}</legend>
        {([
          ['builtin', tr("内置供应商")],
          ['custom', tr("自定义接口")],
        ] as const).map(([value, title]) => (
          <label key={value} className="connection-mode" data-selected={mode === value}>
            <input type="radio" name={prefix + '-mode'} value={value} checked={mode === value}
              aria-label={title} onChange={() => onModeChange(value)} />
            <span>{title}</span>
          </label>
        ))}
      </fieldset>
      <p className="hint connection-mode-help">{mode === 'builtin' ? tr('从 Pi 目录选择模型，自动使用供应商端点。') : tr('填写接口地址，适用于中转服务和本地模型。')}</p>
      {mode === 'builtin' ? (
        <div className="field-stack">
          <FieldRow label={tr("供应商")} htmlFor={prefix + '-provider'} description={tr("Pi 内置目录的供应商标识，不是域名或网址")}>
            <select id={prefix + '-provider'} aria-label={tr("供应商")} value={provider.provider} disabled={!catalog?.length}
              onChange={(event) => onChange(builtinConnection(catalog ?? [], event.target.value))}>
              {!group && <option value={provider.provider}>{provider.provider || tr("请选择供应商")}{tr("（未收录）")}</option>}
              {catalog?.map(({ id }) => <option key={id} value={id}>{id}</option>)}
            </select>
          </FieldRow>
          <FieldRow label={tr("内置模型")} htmlFor={prefix + '-model'} description={tr("仅列出当前供应商可用的目录模型")}>
            <select id={prefix + '-model'} aria-label={tr("内置模型")} value={provider.model} disabled={!group}
              onChange={(event) => onChange(builtinConnection(catalog ?? [], provider.provider, event.target.value))}>
              {!model && <option value={provider.model}>{provider.model || tr("请选择模型")}{tr("（未收录）")}</option>}
              {group?.models.map(({ id, name }) => <option key={id} value={id}>{name === id ? name : name + ' · ' + id}</option>)}
            </select>
          </FieldRow>
          {catalog && !model && <p className="form-feedback" role="alert" data-error="true">{tr("当前模型不在内置目录中。请选择目录模型，或切换到自定义接口填写服务地址。")}</p>}
        </div>
      ) : (
        <div className="field-stack">
          {legacyOverride ? <div className="connection-notice">
            <p>{tr("此配置保留了旧版端点覆盖，继续使用原内置模型的协议和能力。地址与密钥可直接修改；更换模型前请转换为自定义接口。")}</p>
            <p className="hint">{tr("原模型：")}{provider.provider} / {provider.model}</p>
            <Button size="sm" onClick={onConvert}>{tr("转换为自定义模型")}</Button>
          </div> : <FieldRow label={tr("API 协议")} htmlFor={prefix + '-api'} description={tr("按接口文档选择协议，与供应商品牌无关")}>
            <select id={prefix + '-api'} aria-label={tr("API 协议")} value={provider.api}
              onChange={(event) => onChange({ api: event.target.value as Provider['api'] })}>
              {CUSTOM_APIS.map((api) => <option key={api} value={api}>{API_LABELS[api]}</option>)}
            </select>
          </FieldRow>}
          <FieldRow label="Base URL" htmlFor={prefix + '-url'} description={legacyOverride
            ? tr("填写原内置模型使用的替代端点，密钥要求保持不变")
            : tr("必填，包含服务要求的路径，例如 /v1；localhost 可不填 API Key")}>
            <input id={prefix + '-url'} aria-label="Base URL" type="url" required autoComplete="off" spellCheck={false}
              placeholder="https://api.example.com/v1" value={provider.baseUrl}
              onChange={(event) => onChange({ baseUrl: event.target.value })} />
          </FieldRow>
          {!legacyOverride && <>
            <FieldRow label={tr("模型 ID")} htmlFor={prefix + '-model'} description={tr("接口服务实际接受的模型名称，不查询 Pi 内置目录")}>
              <input id={prefix + '-model'} aria-label={tr("模型 ID")} required spellCheck={false} value={provider.model}
                placeholder={tr("填写服务方提供的模型 ID")} onChange={(event) => onChange({ model: event.target.value })} />
            </FieldRow>
          </>}
        </div>
      )}
      {credentials}
      {(model && mode === 'builtin' || provider.custom) && <details key={mode} className="connection-advanced">
              <summary>{tr("模型能力")}</summary>
              {mode === 'builtin' && model ? <>
                <p className="hint">{tr('由内置模型定义，无需手动配置')}</p>
                <FieldRow label={tr('接口协议')}><span className="model-metadata">{model.api}</span></FieldRow>
                <FieldRow label={tr('上下文窗口')}><span>{model.contextWindow.toLocaleString()} tokens</span></FieldRow>
                <FieldRow label={tr('最大输出 Token')}><span>{model.maxTokens.toLocaleString()}</span></FieldRow>
              </> : <>
              <p className="hint">{tr("按照服务方说明填写，用于上下文压缩和输出限制。")}</p>
              <FieldRow label={tr("上下文窗口")} htmlFor={prefix + '-context'}>
                <input id={prefix + '-context'} aria-label={tr("上下文窗口")} type="number" min={1024} max={10000000} step={1}
                  value={provider.contextWindow} onChange={(event) => onChange({ contextWindow: Number(event.target.value) })} />
              </FieldRow>
              <FieldRow label={tr("最大输出 Token")} htmlFor={prefix + '-max'}>
                <input id={prefix + '-max'} aria-label={tr("最大输出 Token")} type="number" min={256} max={1000000} step={1}
                  value={provider.maxTokens} onChange={(event) => onChange({ maxTokens: Number(event.target.value) })} />
              </FieldRow>
              <FieldRow label={tr("支持思考")} htmlFor={prefix + '-reasoning'} description={tr("仅在接口支持时启用推理强度选项")}>
                <input id={prefix + '-reasoning'} type="checkbox" checked={provider.reasoning}
                  onChange={(event) => onChange({ reasoning: event.target.checked })} />
              </FieldRow>
              </>}
            </details>}
      {supportsThinking && <fieldset className="thinking-levels" aria-describedby={prefix + '-thinking-help'}>
        <legend>{tr("允许的思考程度")}</legend>
        <p id={prefix + '-thinking-help'} className="hint">{provider.custom
          ? tr("仅勾选接口实际支持的程度；任务中的思考菜单只显示勾选项。")
          : tr("从内置模型支持的程度中选择；任务中的思考菜单只显示勾选项。")}</p>
        <div className="thinking-level-options">
          {availableLevels.map((level) => <label key={level} className="thinking-level-option">
            <input type="checkbox" value={level} checked={selectedLevels.includes(level)}
              onChange={(event) => onChange({ thinkingLevels: thinkingSchema.options.filter((candidate) =>
                candidate === level ? event.target.checked : selectedLevels.includes(candidate)) })} />
            <span><Check size={14} aria-hidden="true" />{thinkingLabels[level]}</span>
          </label>)}
        </div>
        {selectedLevels.length === 0 && <p className="form-feedback" role="alert" data-error="true">{tr("请至少选择一个允许的思考程度。")}</p>}
      </fieldset>}
      {(mode === 'builtin' || legacyOverride) && !catalog && (
        <div className="connection-notice">
          <p role={catalogError ? 'alert' : undefined}>{catalogError ? localizeLabel(catalogError) : tr("正在加载内置模型目录…")}</p>
          {catalogError && <Button size="sm" onClick={onRetry}>{tr("重新加载目录")}</Button>}
        </div>
      )}
    </div>
  );
}
