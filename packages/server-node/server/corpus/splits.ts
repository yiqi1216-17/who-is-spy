import { safeDigest } from '../redaction.js';

/**
 * 切分 manifest + 检索资格(data/README.md 执行路线第 3 步;OpenSpec 03 · tasks 3.3 拾取)
 *
 * 泄漏隔离的单位是**组**,不是单局:
 * - ck-arena → 词对(gameId basename 剥离时间戳后缀):同词对的所有对局整组分配,
 *   frozen 词对的描述不会以训练样本身份出现在检索里;
 * - werewolf-among-us → cohort(YT_ID + 视频指纹 = 同一视频、同一批玩家):同场玩家
 *   的多局整组分配。已知限制:人名已匿名化,跨视频的同一玩家无法对齐,cohort 隔离
 *   只到"视频"粒度——这是隐私设计(不留人名)换来的诚实边界。
 *
 * 分配是**种子化确定性 hash**(FNV-1a,复用 redaction.safeDigest),无随机源:
 * 同 seed 同输入 → 逐字节相同的 manifest,回归可比对。
 *
 * preference-holdout 诚实为空:人类偏好数据尚未采集(tasks 3.4 延后),结构先行。
 */

export const SPLIT_NAMES = [
  'train',
  'validation',
  'frozen-core',
  'rolling-challenge',
  'preference-holdout',
] as const;
export type SplitName = (typeof SPLIT_NAMES)[number];

/** hash 桶(0–99)→ split 的固定映射:70/10/10/10;preference 不参与 hash 分配。 */
const BUCKETS: Array<{ upper: number; split: SplitName }> = [
  { upper: 70, split: 'train' },
  { upper: 80, split: 'validation' },
  { upper: 90, split: 'frozen-core' },
  { upper: 100, split: 'rolling-challenge' },
];

/** gameId → 泄漏隔离组键。未知来源前缀按整个 gameId 独立成组(保守,不合并)。 */
export function groupKeyFor(gameId: string): string {
  if (gameId.startsWith('ck-arena:')) {
    const stem = gameId.slice('ck-arena:'.length);
    const base = stem.split('/').pop() ?? stem;
    // 剥离 `_YYYYMMDD-HHMMSS…` 时间戳及其后缀,余下即词对(如 football_basketball)
    const pair = base.replace(/_\d{8}-\d{6}.*$/, '');
    return `ck-arena:${pair}`;
  }
  if (gameId.startsWith('werewolf-among-us:')) {
    // werewolf-among-us:<YT_ID>:<Game_ID>:<videoTag> → cohort = YT_ID + videoTag
    const parts = gameId.split(':');
    if (parts.length === 4) return `werewolf-among-us:${parts[1]}:${parts[3]}`;
  }
  return gameId;
}

export type SplitAssignment = Record<SplitName, string[]>;

/** 整组种子化分配:同组游戏永不跨 split。输出各 split 内按 gameId 排序(确定性)。 */
export function assignSplits(gameIds: string[], seed: number): SplitAssignment {
  const result: SplitAssignment = {
    train: [],
    validation: [],
    'frozen-core': [],
    'rolling-challenge': [],
    'preference-holdout': [],
  };
  for (const gameId of gameIds) {
    const bucket = parseInt(safeDigest(`${seed}:${groupKeyFor(gameId)}`).hash, 16) % 100;
    const target = BUCKETS.find((b) => bucket < b.upper) as { split: SplitName };
    result[target.split].push(gameId);
  }
  for (const name of SPLIT_NAMES) result[name].sort();
  return result;
}

export interface SplitManifest {
  manifestVersion: number;
  seed: number;
  policy: {
    grouping: string;
    buckets: string;
  };
  splits: Record<SplitName, { gameIds: string[]; note?: string }>;
}

export function buildManifest(gameIds: string[], seed: number): SplitManifest {
  const assignment = assignSplits(gameIds, seed);
  return {
    manifestVersion: 1,
    seed,
    policy: {
      grouping:
        'ck-arena 按词对整组;werewolf-among-us 按视频 cohort(YT_ID+视频指纹)整组;同组永不跨 split',
      buckets: 'FNV-1a(seed:groupKey) % 100 → train<70 / validation<80 / frozen-core<90 / rolling-challenge<100',
    },
    splits: {
      train: { gameIds: assignment.train },
      validation: { gameIds: assignment.validation },
      'frozen-core': {
        gameIds: assignment['frozen-core'],
        note: '回归门禁哨兵集(change 04):检索与策略拟合一律拒绝',
      },
      'rolling-challenge': {
        gameIds: assignment['rolling-challenge'],
        note: '滚动挑战集:检索与策略拟合一律拒绝',
      },
      'preference-holdout': {
        gameIds: [],
        note: '人类偏好数据未采集(tasks 3.4 延后),结构先行、诚实为空',
      },
    },
  };
}

/** 可检索的 split 白名单;其余(含 manifest 未登记的 gameId)一律拒绝。 */
const RETRIEVABLE: ReadonlySet<SplitName> = new Set(['train', 'validation']);

/**
 * 检索资格 denial(spec「Retrieval attempts to use a holdout example」):
 * 只有出现在 train/validation 的 gameId 可作为示范检索;frozen-core、rolling-challenge、
 * preference-holdout 与**未登记** gameId 一律不可——安全默认是拒绝,不是放行。
 */
export function isRetrievalEligible(gameId: string, manifest: SplitManifest): boolean {
  for (const name of SPLIT_NAMES) {
    if (manifest.splits[name].gameIds.includes(gameId)) return RETRIEVABLE.has(name);
  }
  return false;
}
