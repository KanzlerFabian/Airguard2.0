const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const publicLibDir = path.join(rootDir, 'public', 'lib');
const assets = [
  {
    from: path.join(rootDir, 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js'),
    to: path.join(publicLibDir, 'chart.umd.min.js')
  },
  {
    from: path.join(rootDir, 'node_modules', 'chartjs-adapter-date-fns', 'dist', 'chartjs-adapter-date-fns.bundle.min.js'),
    to: path.join(publicLibDir, 'chartjs-adapter-date-fns.bundle.min.js')
  }
];

fs.mkdirSync(publicLibDir, { recursive: true });

for (const asset of assets) {
  if (!fs.existsSync(asset.from)) {
    throw new Error(`Vendor asset missing: ${path.relative(rootDir, asset.from)}`);
  }

  fs.copyFileSync(asset.from, asset.to);
  console.log(`Copied ${path.relative(rootDir, asset.from)} -> ${path.relative(rootDir, asset.to)}`);
}
