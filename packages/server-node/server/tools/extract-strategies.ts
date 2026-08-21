import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractStrategies } from '../corpus/extract-strategies.js';

/**
 * 策略抽取 CLI(data/README.md 执行路线第 4 步;OpenSpec 03 · tasks 4.1/4.2 拾取)
 *
 *   cd packages/server-node && npx tsx server/tools/extract-strategies.ts
 *
 * 读 raw 的 Youtube split 局 + split-manifest 的 train 集合,产两个工件:
 * - server/strategies.data.ts —— 生成的策略数据文件(SEED_STRATEGIES 的数据源,进 Git);
 * - data/normalized/strategy-extraction-report.json —— 实测分布与簇计数(溯源证据,进 Git)。
 * 无时间戳、无随机源:同 raw + 同 manifest → 逐字节相同输出(可复现、可 diff)。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const SPLIT_DIR = join(REPO_ROOT, 'data', 'raw', 'werewolf-among-us', 'Youtube', 'split');
const MANIFEST = join(REPO_ROOT, 'data', 'splits', 'split-manifest.json');
const DATA_TS = join(HERE, '..', 'strategies.data.ts');
const REPORT = join(REPO_ROOT, 'data', 'normalized', 'strategy-extraction-report.json');

if (!existsSync(SPLIT_DIR)) {
  console.error(`缺少 ${SPLIT_DIR}——先运行 bash data/scripts/fetch.sh werewolf-among-us`);
  process.exit(1);
}
if (!existsSync(MANIFEST)) {
  console.error(`缺少 ${MANIFEST}——先运行 npm run data:import && npm run data:splits`);
  process.exit(1);
}

const games = readdirSync(SPLIT_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .flatMap((f) => JSON.parse(readFileSync(join(SPLIT_DIR, f), 'utf8')) as unknown[]);

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
  seed: number;
  splits: Record<string, { gameIds: string[] }>;
};
const trainIds = new Set(manifest.splits.train.gameIds);

const { strategies, report } = extractStrategies(games, trainIds);

const banner = `// 本文件由 server/tools/extract-strategies.ts 生成——勿手改。
// 重算:npm run data:strategies(输入:data/raw werewolf Youtube split + split-manifest seed=${manifest.seed})
// 实测分布与簇计数见 data/normalized/strategy-extraction-report.json。
import type { Strategy } from './schema.js';

/** transfer 策略原型:werewolf-among-us train split 句级说服策略标注的实测分布。 */
export const TRANSFER_STRATEGIES: readonly Strategy[] = ${JSON.stringify(strategies, null, 2)};
`;
writeFileSync(DATA_TS, banner);
writeFileSync(
  REPORT,
  `${JSON.stringify({ generatedBy: 'server/tools/extract-strategies.ts', splitSeed: manifest.seed, ...report }, null, 2)}\n`,
);

console.log(`train 局 ${report.trainGames},合格玩家样本 ${report.eligiblePlayers}`);
for (const c of report.clusters) {
  console.log(
    `  ${c.strategyId.padEnd(19)} ${c.persona}  成员 ${String(c.members).padStart(3)}  样本局 ${c.sampleIds.length}`,
  );
}
console.log(`→ ${DATA_TS}`);
console.log(`→ ${REPORT}`);
