import manifest from '../package.json' with { type: 'json' };

export const registry = 'https://raw.githubusercontent.com/Linguage/pagestudio/main/registry/';
export const releases = manifest.homepage + '/releases';

function stableVersion(version) {
  return typeof version === 'string' && /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(version);
}

export function newerVersion(installed, available) {
  if (!stableVersion(installed) || !stableVersion(available)) return false;
  const current = installed.split('.').map(Number);
  const candidate = available.split('.').map(Number);
  const difference = candidate.findIndex((value, index) => value !== current[index]);
  return difference !== -1 && candidate[difference] > current[difference];
}

export function releaseInfo() {
  return { installed: manifest.version, packageName: manifest.name, registry, releases };
}

let lastCheck = 0;
let latest;
let pending;
export async function checkRelease() {
  if (Date.now() - lastCheck < 15 * 60 * 1000) return { ...releaseInfo(), latest };
  pending ??= (async () => {
    const response = await fetch(registry + manifest.name, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) throw Error('更新源暂不可用');
    const index = await response.json();
    const version = index['dist-tags']?.latest;
    if (!stableVersion(version) || index.versions?.[version]?.name !== manifest.name) throw Error('更新信息无效');
    latest = newerVersion(manifest.version, version) ? version : null;
    lastCheck = Date.now();
    return { ...releaseInfo(), latest };
  })().finally(() => { pending = undefined; });
  return pending;
}
