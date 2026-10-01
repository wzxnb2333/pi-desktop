import type { ProjectEnvironment } from '../shared/project-environment.ts';

export function actionArguments(shell: ProjectEnvironment['shell'], command: string): string[] {
  if (shell === 'cmd') return ['/d', '/s', '/c', command];
  if (shell === 'git-bash') return ['--noprofile', '--norc', '-c', 'set -e\n' + command];
  const script = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n$OutputEncoding = [Console]::OutputEncoding\n$ErrorActionPreference = 'Stop'\n$global:LASTEXITCODE = 0\ntry {\n& {\n" + command +
    "\n}\nif (-not $?) { exit 1 }\nexit $global:LASTEXITCODE\n} catch {\nWrite-Error $_ -ErrorAction Continue\nexit 1\n}";
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}
