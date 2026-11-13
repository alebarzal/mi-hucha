import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Commit con el que se compila: la app lo compara con el último APK publicado en GitHub.
function buildSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execSync('git rev-parse HEAD').toString().trim(); } catch { return ''; }
}

export default defineConfig({
  base: './',
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version.replace(/\.0$/, '')),
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  worker: { format: 'iife' },
});
