/**
 * Patches Next.js config to skip ESLint and TypeScript errors during build,
 * so deploys don't fail due to lint/type issues.
 * For container builds: also clears basePath and output to avoid asset URL mismatches.
 * For static builds: also injects output: 'export' so Next.js generates the out/ dir.
 */

import * as fs from 'fs';
import * as path from 'path';

const CONFIG_FILES = [
  'next.config.ts',
  'next.config.mts',
  'next.config.mjs',
  'next.config.js',
];

export async function patchNextConfig(
  contextPath: string,
  options: { addStaticExport?: boolean } = {},
): Promise<void> {
  const { addStaticExport = false } = options;

  for (const file of CONFIG_FILES) {
    const filePath = path.join(contextPath, file);
    try {
      await fs.promises.access(filePath);
    } catch {
      continue;
    }

    let content = await fs.promises.readFile(filePath, 'utf8');
    if (content.includes('dropdeploy-patch') || content.includes('ignoreDuringBuilds')) return;

    if (content.includes('module.exports')) {
      content +=
        '\n// dropdeploy-patch\n' +
        'const _ddCfg = module.exports;\n' +
        '_ddCfg.eslint = { ..._ddCfg.eslint, ignoreDuringBuilds: true };\n' +
        '_ddCfg.typescript = { ..._ddCfg.typescript, ignoreBuildErrors: true };\n' +
        '_ddCfg.experimental = { ..._ddCfg.experimental, cpus: 1, workerThreads: false };\n';
      if (addStaticExport) {
        content += "_ddCfg.output = 'export';\n";
        content += '_ddCfg.basePath = "";\n';
      } else {
        content += '_ddCfg.output = undefined;\n';
        content += '_ddCfg.basePath = "";\n';
      }
      content += 'module.exports = _ddCfg;\n';
    } else {
      // ESM
      const extraLines = addStaticExport
        ? "$1.output = 'export';\n$1.basePath = \"\";\n"
        : '$1.output = undefined;\n$1.basePath = "";\n';
      content = content.replace(
        /export\s+default\s+(\w+)/,
        '$1.eslint = { ...$1.eslint, ignoreDuringBuilds: true };\n' +
          '$1.typescript = { ...$1.typescript, ignoreBuildErrors: true };\n' +
          '$1.experimental = { ...$1.experimental, cpus: 1, workerThreads: false };\n' +
          extraLines +
          '// dropdeploy-patch\nexport default $1'
      );
    }

    await fs.promises.writeFile(filePath, content, 'utf8');
    return;
  }

  // No next.config file found — create a minimal one
  const staticExportLine = addStaticExport ? "  output: 'export',\n" : '';
  await fs.promises.writeFile(
    path.join(contextPath, 'next.config.js'),
    '/** @type {import("next").NextConfig} */\n// dropdeploy-patch\n' +
      'module.exports = {\n' +
      '  eslint: { ignoreDuringBuilds: true },\n' +
      '  typescript: { ignoreBuildErrors: true },\n' +
      '  experimental: { cpus: 1, workerThreads: false },\n' +
      staticExportLine +
      '};\n',
    'utf8'
  );
}
