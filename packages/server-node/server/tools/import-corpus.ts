import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_POLICY, importSource, type ImportOutcome } from '../corpus/normalize.js';

/**
 * 语料导入 CLI(data/README.md 执行路线第 2 步;OpenSpec 03 · tasks 3.1/3.2 拾取)
 *
 *   cd packages/server-node && npx tsx server/tools/import-corpus.ts [--source ID] [--json]
 *
 * 读 data/raw/<source>,经 corpus/normalize 的来源处置表归一化为 datasetRecord 信封,
 * 逐行写 data/normalized/<source>.jsonl;拒绝来源与坏文件 diagnostic 汇总写
 * data/normalized/import-report.json。文件按路径排序处理,同 raw 同输出(可复现)。
 * raw 缺失是正常状态(未跑 fetch.sh),报告后跳过;有文件却零入库才以非 0 退出。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..'); // server/tools → server-node → packages → 根
const RAW_DIR = join(REPO_ROOT, 'data', 'raw');
const OUT_DIR = join(REPO_ROOT, 'data', 'normalized');

type RawFile = { name: string; json: unknown };

/** 递归收集 .json 文件路径(排序保证确定性)。 */
function jsonFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d).sort()) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.json')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** 各接受来源的文件发现与展开逻辑(拒绝来源不需要——importSource 直接给 diagnostic)。 */
const DISCOVERY: Record<string, (rawRoot: string) => RawFile[]> = {
  // 对局日志一文件一局;logs/en 与 logs/raw 结构同为 { game_record: … }
  'ck-arena': (root) => {
    const logs = join(root, 'ck-arena', 'logs');
    if (!existsSync(logs)) return [];
    return jsonFilesUnder(logs).map((f) => ({
      name: relative(logs, f),
      json: JSON.parse(readFileSync(f, 'utf8')) as unknown,
    }));
  },
  // Youtube/split/*.json 一文件多局(数组),展开为“<split>#<序号>”伪文件;
  // Ego4D 子集无角色信息,不参与归一化(标注留 raw/ 供第 4 步直读)
  'werewolf-among-us': (root) => {
    const splitDir = join(root, 'werewolf-among-us', 'Youtube', 'split');
    if (!existsSync(splitDir)) return [];
    return readdirSync(splitDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .flatMap((f) => {
        const games = JSON.parse(readFileSync(join(splitDir, f), 'utf8')) as unknown[];
        return games.map((game, i) => ({ name: `${f}#${i}`, json: game }));
      });
  },
};

interface CliOptions {
  source: string | null;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { source: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source') {
      opts.source = argv[i + 1] ?? null;
      i += 1;
    } else if (argv[i] === '--json') {
      opts.json = true;
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const sources = opts.source ? [opts.source] : Object.keys(SOURCE_POLICY);

mkdirSync(OUT_DIR, { recursive: true });

interface SourceReport {
  source: string;
  status: ImportOutcome['status'] | 'raw-missing';
  imported: number;
  diagnostics: string[];
  reason?: string;
  outFile?: string;
}

const reports: SourceReport[] = [];
const seenGameIds = new Set<string>();

for (const source of sources) {
  const discover = DISCOVERY[source];
  const policy = SOURCE_POLICY[source];
  const accepted = policy !== undefined && 'provenance' in policy;

  // 拒绝来源与未登记来源:不读文件,直接让处置表说话
  if (!accepted || !discover) {
    const outcome = importSource(source, []);
    reports.push({
      source,
      status: outcome.status,
      imported: 0,
      diagnostics: [],
      reason: outcome.status === 'rejected' ? outcome.reason : undefined,
    });
    continue;
  }

  const files = discover(RAW_DIR);
  if (files.length === 0) {
    reports.push({
      source,
      status: 'raw-missing',
      imported: 0,
      diagnostics: [`data/raw/${source} 无输入文件——先运行 bash data/scripts/fetch.sh ${source}`],
    });
    continue;
  }

  const outcome = importSource(source, files);
  if (outcome.status !== 'imported') {
    reports.push({ source, status: outcome.status, imported: 0, diagnostics: [], reason: outcome.reason });
    continue;
  }

  // 跨文件 gameId 去重(确定性:排序处理,首见保留)
  const lines: string[] = [];
  const diagnostics = [...outcome.diagnostics];
  for (const env of outcome.records) {
    const { gameId } = env.data;
    if (seenGameIds.has(gameId)) {
      diagnostics.push(`重复 gameId 跳过:${gameId}`);
      continue;
    }
    seenGameIds.add(gameId);
    lines.push(JSON.stringify(env));
  }

  const outFile = join(OUT_DIR, `${source}.jsonl`);
  writeFileSync(outFile, lines.length > 0 ? `${lines.join('\n')}\n` : '');
  reports.push({
    source,
    status: 'imported',
    imported: lines.length,
    diagnostics,
    outFile: relative(REPO_ROOT, outFile),
  });
}

const report = {
  generatedBy: 'server/tools/import-corpus.ts',
  schemaTarget: 'datasetRecord v1',
  sources: reports,
};
writeFileSync(join(OUT_DIR, 'import-report.json'), `${JSON.stringify(report, null, 2)}\n`);

if (opts.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const r of reports) {
    if (r.status === 'imported') {
      console.log(`✓ ${r.source}: 入库 ${r.imported} 局 → ${r.outFile}(diagnostic ${r.diagnostics.length} 条)`);
    } else if (r.status === 'rejected') {
      console.log(`✗ ${r.source}: 拒绝 — ${r.reason}`);
    } else {
      console.log(`- ${r.source}: ${r.diagnostics[0]}`);
    }
    for (const d of r.diagnostics.slice(0, 5)) console.log(`    · ${d}`);
    if (r.diagnostics.length > 5) console.log(`    · …共 ${r.diagnostics.length} 条,详见 import-report.json`);
  }
}

// 有输入文件却零入库 → 解析面写错了,必须红
const broken = reports.some((r) => r.status === 'imported' && r.imported === 0);
process.exit(broken ? 1 : 0);
