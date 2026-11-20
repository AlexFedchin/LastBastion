// Bundles src/ into app/build/game.js with esbuild.
//   node scripts/build.mjs           -> production bundle (minified)
//   node scripts/build.mjs --watch   -> rebuild on change (dev)
//
// WebGPU branch: every bare `three` import (the game, GLTFLoader, the addons) goes to
// src/render/three-shim.js, which re-exports three's WebGPU build with the node materials
// under the classic material names.
import * as esbuild from 'esbuild';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const shim = path.resolve('src/render/three-shim.js');
const threeToWebGPU = {
  name: 'three-to-webgpu',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, (a) => (a.importer === shim ? undefined : { path: shim }));
  },
};

const options = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['chrome120'],
  outfile: 'app/build/game.js',
  minify: !watch && !process.env.DEV,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
  plugins: [threeToWebGPU],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[build] watching src/ for changes...');
} else {
  await esbuild.build(options);
}
