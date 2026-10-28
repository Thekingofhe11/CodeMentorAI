import { build } from 'esbuild';
import { readFile, mkdir, readdir, appendFile } from 'node:fs/promises';

const vendor = new URL('../frontend/vendor/liquid-glass/', import.meta.url);
const upstream = await readFile(new URL('container.upstream.js', vendor), 'utf8');
await mkdir(new URL('../extension/assets/', import.meta.url), { recursive: true });
const result = await build({
  entryPoints: ['frontend/visuals.jsx'],
  outfile: 'extension/assets/visuals.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome110'],
  minify: true,
  legalComments: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{
    name: 'liquid-glass-esm',
    setup(build) {
      build.onLoad({ filter: /container\.upstream\.js$/ }, () => ({
        contents: `${upstream}\nexport { Container };\n`, loader: 'js',
      }));
    },
  }],
  metafile: true,
  logLevel: 'info',
});
const inputs = Object.keys(result.metafile.inputs);
const three = inputs.filter((file) => /three\/build\/three/.test(file));
if (three.length !== 1) throw new Error(`Expected one Three.js runtime, found ${three.length}`);
if (Object.values(result.metafile.outputs).some((output) => output.imports.length)) {
  throw new Error('The visual bundle must not have external runtime imports');
}
const packages = new Set(inputs.map((path) => path.match(/^(node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean));
for (const path of packages) {
  const licenseFiles = (await readdir(path)).filter((name) => /^licen[cs]e(?:\.|$)/i.test(name));
  for (const name of licenseFiles) {
    await appendFile('extension/assets/visuals.js.LEGAL.txt', `\n\n${path}/${name}\n${await readFile(`${path}/${name}`, 'utf8')}`);
  }
}
for (const path of ['frontend/vendor/liquid-glass/LICENSE', 'frontend/vendor/licenses/shadergradient.LICENSE', 'frontend/vendor/licenses/react-three-fiber.LICENSE']) {
  await appendFile('extension/assets/visuals.js.LEGAL.txt', `\n\n${path}\n${await readFile(path, 'utf8')}`);
}
console.log(`Bundled ${inputs.length} modules with one Three.js runtime. No remote runtime imports.`);
