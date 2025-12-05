import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));

function getEntryPoints(pkg: any): string[] {
  const entry = ['src/index.ts'];
  if (pkg.exports) {
    for (const key in pkg.exports) {
      if (Object.prototype.hasOwnProperty.call(pkg.exports, key)) {
        const exportEntry = pkg.exports[key];
        const importFile = typeof exportEntry === 'string' ? exportEntry : exportEntry.import;
        
        if (importFile && typeof importFile === 'string') {
          // Map ./lib/foo.mjs -> ./src/foo.ts
          const sourceFile = importFile
            .replace('./lib', './src')
            .replace('.mjs', '.ts')
            .replace('.js', '.ts');
          entry.push(sourceFile);
        }
      }
    }
  }
  return [...new Set(entry)];
}

export default defineConfig({
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  shims: true,
  outDir: 'lib',
  entry: getEntryPoints(packageJson),
  bundle: false,
  treeshake: false,
});
