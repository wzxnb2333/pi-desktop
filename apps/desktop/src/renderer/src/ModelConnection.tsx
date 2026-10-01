import { localizeLabel, tr } from "../../shared/localization.ts";
import type { ReactNode } from 'react';
import { useLocale } from "./hooks/use-locale.ts";
import { type ModelApi, type ModelCatalog, type ModelProvider } from '../../shared/contracts.ts';
import { MODEL_APIS, catalogProvider } from '../../shared/model-configuration.ts';
import { Button } from './components/primitives/button.tsx';
import { FieldRow } from './components/primitives/field-row.tsx';

export const API_LABELS: Record<ModelApi, string> = {
  get 'openai-completions'() { return tr("OpenAI 兼容（Chat Completions）"); },
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
  'google-generative-ai': 'Google Generative AI',
};

/**
 * Connection fields of one provider. Models hang under the provider and share its key, so the
 * endpoint, protocol and credential live here and every capability lives on the model.
 */
export function ModelConnection({ provider, catalog, catalogError, credentials, onRetry, onChange }: {
  provider: ModelProvider;
  catalog: ModelCatalog | null;
  catalogError: string;
  credentials?: ReactNode;
  onRetry(): void;
  onChange(value: Partial<ModelProvider>): void;
}) {
  useLocale();
  const prefix = 'connection-' + provider.id;
  const known = !!catalogProvider(catalog, provider.namespace);
  return (
    <div className="model-connection">
      {provider.kind === 'builtin' ? (
        <div className="field-stack">
          <FieldRow label={tr("供应商")} htmlFor={prefix + '-namespace'} description={tr("Pi 内置目录的供应商标识，不是域名或网址")}>
            <select
              id={prefix + '-namespace'}
              aria-label={tr("供应商")}
              value={provider.namespace}
              disabled={!catalog?.length}
              onChange={(event) => onChange(provider.name === provider.namespace ? { namespace: event.target.value, name: event.target.value } : { namespace: event.target.value })}
            >
              {!known && <option value={provider.namespace}>{provider.namespace || tr("请选择供应商")}{tr("（未收录）")}</option>}
              {catalog?.map(({ id }) => <option key={id} value={id}>{id}</option>)}
            </select>
          </FieldRow>
          <details className="connection-advanced">
            <summary>{tr("端点覆盖")}</summary>
            <p className="hint">{tr("可选。填写后经由该地址访问此供应商（例如代理或网关）；留空使用供应商默认端点。")}</p>
            <FieldRow label="Base URL" htmlFor={prefix + '-url'} description={tr("HTTP(S) 地址，密钥请填入 API Key")}>
              <input id={prefix + '-url'} aria-label="Base URL" type="url" autoComplete="off" spellCheck={false}
                placeholder="https://gateway.example.com/v1" value={provider.baseUrl}
                onChange={(event) => onChange({ baseUrl: event.target.value })} />
            </FieldRow>
          </details>
          {!known && (
            <div className="connection-notice">
              <p role={catalogError ? 'alert' : undefined}>{catalogError ? localizeLabel(catalogError)
                : catalog ? tr("该供应商不在当前内置目录中，请重新选择供应商，或改用自定义提供商。") : tr("正在加载内置模型目录…")}</p>
              {catalogError && <Button size="sm" onClick={onRetry}>{tr("重新加载目录")}</Button>}
            </div>
          )}
        </div>
      ) : (
        <div className="field-stack">
          <FieldRow label={tr("API 协议")} htmlFor={prefix + '-api'} description={tr("按接口文档选择协议，与供应商品牌无关")}>
            <select id={prefix + '-api'} aria-label={tr("API 协议")} value={provider.api}
              onChange={(event) => onChange({ api: event.target.value as ModelApi })}>
              {MODEL_APIS.map((api) => <option key={api} value={api}>{API_LABELS[api]}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="Base URL" htmlFor={prefix + '-url'} description={tr("必填，包含服务要求的路径，例如 /v1；localhost 可不填 API Key")}>
            <input id={prefix + '-url'} aria-label="Base URL" type="url" required autoComplete="off" spellCheck={false}
              placeholder="https://api.example.com/v1" value={provider.baseUrl}
              onChange={(event) => onChange({ baseUrl: event.target.value })} />
          </FieldRow>
        </div>
      )}
      {credentials}
    </div>
  );
}
