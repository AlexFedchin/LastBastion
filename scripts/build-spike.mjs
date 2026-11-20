// WebGPU spike bundle: src/spike/webgpu.js -> app/build/spike.js, opened by app/spike.html.
// Every bare `three` import (the game's world code, GLTFLoader) goes to the WebGPU build
// through src/spike/three-shim.js; the game's own bundle (scripts/build.mjs) is untouched.
import * as esbuild from 'esbuild';
import path from 'node:path';

const shim = path.resolve('src/spike/three-shim.js');
const threeToWebGPU = {
  name: 'three-to-webgpu',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, (a) => (a.importer === shim ? undefined : { path: shim }));
  },
};

await esbuild.build({
  entryPoints: ['src/spike/webgpu.js'],
  bundle: true,
  format: 'iife',
  target: ['chrome120'],
  outfile: 'app/build/spike.js',
  minify: false,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
  plugins: [threeToWebGPU],
});
