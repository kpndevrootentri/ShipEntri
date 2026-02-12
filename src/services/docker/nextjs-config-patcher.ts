/**
 * Patches Next.js config to skip ESLint and TypeScript errors during build,
 * so deploys don't fail due to lint/type issues.
 */

import * as fs from 'fs';
import * as path from 'path';

const CONFIG_FILES = [
  'next.config.ts',
  'next.config.mts',
  'next.config.mjs',
  'next.config.js',
];

export async function patchNextConfig(contextPath: string): Promise<void> {
  for (const file of CONFIG_FILES) {
    const filePath = path.join(contextPath, file);
    try {
      await fs.promises.access(filePath);
    } catch {
      continue;
    }

    let content = await fs.promises.readFile(filePath, 'utf8');
    if (content.includes('ignoreDuringBuilds')) {
      return; // already configured
    }

    // Append config overrides based on module format
    if (content.includes('module.exports')) {
      // CommonJS: reassign module.exports with merged config
      content +=
        '\nconst _ddCfg = module.exports;\n' +
        '_ddCfg.eslint = { ..._ddCfg.eslint, ignoreDuringBuilds: true };\n' +
        '_ddCfg.typescript = { ..._ddCfg.typescript, ignoreBuildErrors: true };\n' +
        'module.exports = _ddCfg;\n';
    } else {
      // ESM: cannot re-export, so modify the file to wrap the default export
      content = content.replace(
        /export\s+default\s+(\w+)/,
        '$1.eslint = { ...$1.eslint, ignoreDuringBuilds: true };\n' +
          '$1.typescript = { ...$1.typescript, ignoreBuildErrors: true };\n' +
          'export default $1'
      );
    }

    await fs.promises.writeFile(filePath, content, 'utf8');
    return;
  }

  // No next.config file found — create a minimal one
  await fs.promises.writeFile(
    path.join(contextPath, 'next.config.js'),
    '/** @type {import("next").NextConfig} */\n' +
      'module.exports = {\n' +
      '  eslint: { ignoreDuringBuilds: true },\n' +
      '  typescript: { ignoreBuildErrors: true },\n' +
      '};\n',
    'utf8'
  );
}
