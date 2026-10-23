import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const buildTime = new Date().toISOString();
let sha = process.env.GITHUB_SHA?.slice(0, 7) || '';
if (!sha) { try { sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {} }
const buildId = (process.env.BUILD_ID ? process.env.BUILD_ID.slice(0, 12) : `${sha || "local"}-${Date.now().toString(36)}`);
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_TIME__: JSON.stringify(buildTime), __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: {
        name: 'Lunk',
        short_name: 'Lunk',
        description: 'Workouts, nutrition, supplements and dose calendar — all on your device.',
        id: '/grug-fit/', // absolute: a relative id resolves against the origin root (github.io/), not the app path
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f1115',
        theme_color: '#0f1115',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      injectManifest: { rollupFormat: 'iife', globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'], globIgnores: ['tesseract/**'] }
    })
  ]
});
