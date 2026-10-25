import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = await build({
  entryPoints: [fileURLToPath(new URL('./presentation.test.ts', import.meta.url))],
  bundle: true,
  loader: { '.css': 'empty', '.module.css': 'empty' },
  define: { 'import.meta.env.MODE': '"test"' },
  platform: 'node',
  format: 'cjs',
  write: false,
  logLevel: 'warning',
});
const run = spawnSync(process.execPath, ['--input-type=commonjs'], {
  input: result.outputFiles[0].text,
  stdio: ['pipe', 'inherit', 'inherit'],
});
process.exit(run.status ?? 1);
