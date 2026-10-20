import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const site = join(root, 'sites/frostline');
const dist = join(site, 'dist');
const files = ['combat-economy.js','enemy-ai.js','sortie-flow.js','mission-briefing.js','sortie-flow.css','ship-systems.js','playable-ships.js','naval-workshop.js',
  'maps.js', 'quality.js', 'map-scenery.js', 'icebergs.js', 'sea-ice.js', 'fa18-armament.js',
  'index.html', 'style.css', 'app.js', 'input.js', 'audio.js',
  'campaign.js', 'base-scene.js', 'vehicle-catalog.js', 'aircraft-systems.js', 'aircraft-stores.js', 'hangar-workshop.js', 'docs/aircraft-systems.md', 'destroyer.js', 'naval-models.js', 'ambient-fleet.js', 'ship-camera.js', 'simulation.js', 'flight-presentation.js', 'chase-camera.js', 'speed-effects.js', 'renderer.js', 'terrain.js',
  'aircraft.js', 'fa18.js', 'assets/models/fa18c.glb', 'assets/models/fa18c.metadata.json', 'assets/models/f18-source/F-A-18C-rebuilt-v2.blend',
  'imported-airframe.js', 'j16.js', 'assets/models/j16.glb', 'assets/models/j16.metadata.json', 'assets/models/j16-source/J-16.blend', 'assets/models/j16-source/COPYING',
  'missile-models.js', 'assets/models/missiles/missiles-game.glb', 'assets/models/missiles/missiles-game.metadata.json',
  'naval-assets.js', 'assets/models/fujian.glb', 'assets/models/fujian.metadata.json',
  'assets/models/enterprise.glb', 'assets/models/enterprise.metadata.json', 'assets/models/burke.glb', 'assets/models/burke.metadata.json',
  'assets/models/type052d.glb', 'assets/models/type052d.metadata.json', 'vendor/GLTFLoader.js', 'vendor/BufferGeometryUtils.js', 'atmosphere.js', 'water-reflection.js', 'world-math.js',
  'sw.js', 'manifest.webmanifest', 'vendor/three.module.js', 'vendor/LICENSE.txt',
  'assets/three-views/raw/burke_hero_a.png', 'assets/briefing.jpg', 'assets/sky-panorama.jpg', 'assets/rock-albedo.jpg', 'assets/icon.svg',
];
for (const file of files) {
  if (!statSync(join(root, file)).isFile()) throw new Error(`Missing runtime file: ${file}`);
}
// Refuse to remove unexpected files from a previously prepared directory.
function inspect(directory, prefix = '') {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) inspect(join(directory, entry.name), relative + '/');
    else if (!files.includes(relative)) throw new Error(`Unexpected Site output: ${relative}`);
  }
}
inspect(dist);
mkdirSync(dist, { recursive: true });
for (const file of files) {
  const destination = join(dist, file);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(root, file), destination);
}
const manifestPath = join(site, '.openai/hosting.json');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.static = { ...manifest.static, directory: 'dist' };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
writeFileSync(join(site, '.gitignore'), '.DS_Store\nnode_modules/\n.sites-runtime/\n');
console.log(JSON.stringify({ site, directory: dist, files: files.length, bytes: files.reduce((total, file) => total + statSync(join(dist, file)).size, 0) }));
