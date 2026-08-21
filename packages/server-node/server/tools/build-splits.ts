import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVersioned } from '../schema.js';
import { SPLIT_NAMES, buildManifest } from '../corpus/splits.js';

/**
 * 切分 manifest CLI(data/README.md 执行路线第 3 步;OpenSpec 03 · tasks 3.3 拾取)
 *
 *   cd packages/server-node && npx tsx server/tools/build-splits.ts [--seed N]
 *
 * 从 data/normalized/*.jsonl 逐行 parseVersioned(消费者校验——坏行即失败,lineage 由
 * schema 把关)收集 gameId,种子化整组分配后写 data/splits/split-manifest.json。
 * 同 seed 同输入 → 逐字节相同输出;frozen/rolling 是 change 04 回归门禁的哨兵集。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const NORMALIZED_DIR = join(REPO_ROOT, 'data', 'normalized');
const SPLITS_DIR = join(REPO_ROOT, 'data', 'splits');

let seed = 1;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--seed') {
    seed = Number(argv[i + 1]);
    if (!Number.isInteger(seed)) {
      console.error('--seed 需要整数');
      process.exit(2);
    }
    i += 1;
  }
}

if (!existsSync(NORMALIZED_DIR)) {
  console.error(`缺少 ${NORMALIZED_DIR}——先运行 npm run data:import`);
  process.exit(1);
}

const jsonlFiles = readdirSync(NORMALIZED_DIR)
  .filter((f) => f.endsWith('.jsonl'))
  .sort();
if (jsonlFiles.length === 0) {
  console.error('data/normalized 下无 *.jsonl——先运行 npm run data:import');
  process.exit(1);
}

const gameIds: string[] = [];
const bySource = new Map<string, number>();
for (const file of jsonlFiles) {
  const lines = readFileSync(join(NORMALIZED_DIR, file), 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    // 消费者校验:信封版本/kind/schema 任一不符即失败,不让坏记录进切分
    const record = parseVersioned('datasetRecord', JSON.parse(line));
    gameIds.push(record.gameId);
  }
  bySource.set(file.replace(/\.jsonl$/, ''), lines.length);
}

const manifest = buildManifest(gameIds, seed);
mkdirSync(SPLITS_DIR, { recursive: true });
const outFile = join(SPLITS_DIR, 'split-manifest.json');
writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`输入:${[...bySource.entries()].map(([s, n]) => `${s}=${n} 局`).join(',')}(seed=${seed})`);
for (const name of SPLIT_NAMES) {
  const { gameIds: ids, note } = manifest.splits[name];
  console.log(`  ${name.padEnd(19)} ${String(ids.length).padStart(4)} 局${note ? `  — ${note}` : ''}`);
}
console.log(`→ ${outFile}`);
