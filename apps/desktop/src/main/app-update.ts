export const GITHUB_REPOSITORY = 'wzxnb2333/pi-desktop';
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPOSITORY}/releases/latest`;

export type AppUpdateResult = {
  status: 'available' | 'current' | 'unavailable';
  currentVersion: string;
  latestVersion?: string;
  url: string;
  message?: string;
};

const versionPattern = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/i;

export function compareVersions(left: string, right: string): number | undefined {
  const a = versionPattern.exec(left.trim());
  const b = versionPattern.exec(right.trim());
  if (!a || !b) return undefined;
  for (let index = 1; index <= 3; index++) {
    const difference = Number(a[index] ?? 0) - Number(b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

type ReleasePayload = { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown };

export async function checkGitHubUpdate(
  currentVersion: string,
  fetcher: typeof fetch = fetch,
): Promise<AppUpdateResult> {
  try {
    const response = await fetcher(`https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Pi-Desktop/${currentVersion}` },
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404) return { status: 'unavailable', currentVersion, url: GITHUB_RELEASES_URL, message: '暂无公开发行版' };
    if (!response.ok) return { status: 'unavailable', currentVersion, url: GITHUB_RELEASES_URL, message: '暂时无法检查更新' };
    const release = await response.json() as ReleasePayload;
    const latestVersion = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/i, '') : '';
    if (!latestVersion || release.draft === true || release.prerelease === true || compareVersions(latestVersion, currentVersion) === undefined)
      return { status: 'unavailable', currentVersion, url: GITHUB_RELEASES_URL, message: '发行版信息无效' };
    return {
      status: compareVersions(latestVersion, currentVersion)! > 0 ? 'available' : 'current',
      currentVersion,
      latestVersion,
      url: typeof release.html_url === 'string' && /^https:\/\/github\.com\/wzxnb2333\/pi-desktop\/releases\//.test(release.html_url)
        ? release.html_url : GITHUB_RELEASES_URL,
    };
  } catch {
    return { status: 'unavailable', currentVersion, url: GITHUB_RELEASES_URL, message: '暂时无法检查更新' };
  }
}
