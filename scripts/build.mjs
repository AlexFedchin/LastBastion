// Bundles src/ into app/build/game.js with esbuild.
//   node scripts/build.mjs           -> production bundle (minified)
//   node scripts/build.mjs --watch   -> rebuild on change (dev)
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['chrome120'],
  outfile: 'app/build/game.js',
  minify: !watch,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[build] watching src/ for changes...');
} else {
  await esbuild.build(options);
}
