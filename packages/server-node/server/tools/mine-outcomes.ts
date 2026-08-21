import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mineOutcomes } from '../corpus/mine-outcomes.js';

/**
 * 胜负相关性挖掘 CLI(OpenSpec 04 · 阵营胜率军备竞赛的数据依据)
 *
 *   npm run data:outcomes           # 仓库根
 *   cd packages/server-node && npx tsx server/tools/mine-outcomes.ts
 *
 * 读 raw 的 Youtube split 局 + split-manifest 的 train 集合,产一个工件:
 * - data/normalized/outcome-correlation-report.json —— 逐话风簇获胜方占比 + 两阵营经验基线。
 * 只承载聚合占比与样本数(无逐局、无发言原文),故无泄漏面。
 * 无时间戳、无随机源:同 raw + 同 manifest → 逐字节相同输出(可复现、可 diff)。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const SPLIT_DIR = join(REPO_ROOT, 'data', 'raw', 'werewolf-among-us', 'Youtube', 'split');
const MANIFEST = join(REPO_ROOT, 'data', 'splits', 'split-manifest.json');
const REPORT = join(REPO_ROOT, 'data', 'normalized', 'outcome-correlation-report.json');

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

const report = mineOutcomes(games, trainIds);

writeFileSync(
  REPORT,
  `${JSON.stringify({ generatedBy: 'server/tools/mine-outcomes.ts', splitSeed: manifest.seed, ...report }, null, 2)}\n`,
);

console.log(`判定局 ${report.decidedGames},玩家样本 ${report.eligiblePlayers}`);
console.log(
  `经验基线:平民类比胜率 ${(report.baseline.civilianWinRate * 100).toFixed(1)}% · 卧底类比胜率 ${(report.baseline.undercoverWinRate * 100).toFixed(1)}%`,
);
for (const c of report.clusters) {
  console.log(`  ${c.persona.padEnd(6)} 样本 ${String(c.members).padStart(4)}  获胜方占比 ${(c.winRate * 100).toFixed(1)}%`);
}
console.log(`📄 已写入 ${REPORT}`);
