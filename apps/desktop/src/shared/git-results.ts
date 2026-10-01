export interface GitCommitResult {
  kind: 'git-commit';
  id: string;
  output: string;
  interrupted: boolean;
  warnings: Array<{ code: 'index-changed' | 'head-changed' | 'index-failed' | 'cleanup-failed'; detail?: string }>;
}

export function isGitCommitResult(value: unknown): value is GitCommitResult {
  return !!value && typeof value === 'object' && 'kind' in value && value.kind === 'git-commit'
    && 'id' in value && typeof value.id === 'string' && 'output' in value && typeof value.output === 'string'
    && 'interrupted' in value && typeof value.interrupted === 'boolean' && 'warnings' in value && Array.isArray(value.warnings)
    && value.warnings.every((warning: unknown) => !!warning && typeof warning === 'object' && 'code' in warning
      && typeof warning.code === 'string' && ['index-changed', 'head-changed', 'index-failed', 'cleanup-failed'].includes(warning.code)
      && (!('detail' in warning) || warning.detail === undefined || typeof warning.detail === 'string'));
}
