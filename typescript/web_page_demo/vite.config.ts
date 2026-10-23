import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { liveData } from './server/live';

/** `--mode static`: put the script and styles inside index.html so the page opens on its own. */
function singleFile(): Plugin {
  const tag = (name: string, attr: 'src' | 'href') =>
    new RegExp(`<(script|link)[^>]*${attr}="[^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>(</script>)?`);
  return {
    name: 'single-file',
    enforce: 'post',
    generateBundle(_, bundle) {
      const html = bundle['index.html'];
      if (html?.type !== 'asset') return;
      let source = String(html.source);
      for (const [name, item] of Object.entries(bundle)) {
        if (item.type === 'chunk') {
          const code = item.code.replace(/<\/script/gi, '<\\/script');
          source = source.replace(tag(name, 'src'), () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (name.endsWith('.css')) {
          source = source.replace(tag(name, 'href'), () => `<style>${String(item.source)}</style>`);
          delete bundle[name];
        }
      }
      html.source = source;
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    liveData({ ...loadEnv(mode, resolve(process.cwd(), '../..'), ''), ...process.env } as Record<string, string>),
    mode === 'static' && singleFile(),
  ],
  build: mode === 'static' ? { outDir: 'dist-static', modulePreload: false } : undefined,
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
