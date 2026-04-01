import { resolve } from 'node:path';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
function copyStaticAssets(): Plugin {
  return {
    name: 'copy-static-assets',
    apply: 'build',
    closeBundle() {
      const root = __dirname;
      const dist = resolve(root, 'dist');
      mkdirSync(dist, { recursive: true });

      // manifest.json
      copyFileSync(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'));

      // _locales/<lang>/messages.json
      for (const lang of ['en', 'tr']) {
        const srcDir = resolve(root, 'src/_locales', lang);
        const outDir = resolve(dist, '_locales', lang);
        mkdirSync(outDir, { recursive: true });
        const srcFile = resolve(srcDir, 'messages.json');
        if (existsSync(srcFile)) {
          copyFileSync(srcFile, resolve(outDir, 'messages.json'));
        }
      }

      // icons
      const iconsOut = resolve(dist, 'icons');
      mkdirSync(iconsOut, { recursive: true });
      for (const icon of ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png']) {
        const srcIcon = resolve(root, 'src/ui/icons', icon);
        if (existsSync(srcIcon)) {
          copyFileSync(srcIcon, resolve(iconsOut, icon));
        }
      }
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@content': resolve(__dirname, 'src/content'),
      '@features': resolve(__dirname, 'src/features'),
      '@ui': resolve(__dirname, 'src/ui'),
      '@background': resolve(__dirname, 'src/background'),
    },
  },
  plugins: [copyStaticAssets()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2023',
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      input: {
        'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        popup: resolve(__dirname, 'src/popup/popup.html'),
        options: resolve(__dirname, 'src/options/options.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
