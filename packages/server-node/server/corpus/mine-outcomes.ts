import {
  CLUSTER_META,
  CLUSTER_OF,
  PERSUASION_TAGS,
  type ClusterId,
  type PersuasionTag,
} from './extract-strategies.js';
import { werewolfGameId } from './normalize.js';

/**
 * 胜负相关性挖掘(OpenSpec 04 · 阵营胜率军备竞赛的**数据依据**)
 *
 * 回答一个 extract-strategies 不回答的问题:**哪种说服话风更常出现在获胜的一方?**
 * extract-strategies 只统计「人们怎么说」(风格频率),丢掉了 raw 里的 votingOutcome/endRoles;
 * 本模块把两者 join 起来,产出**按话风簇的获胜方占比**,以及两阵营的经验基线胜率。
 * 这些数值用来**标定**(而非硬套)军备竞赛三段迭代的技能档位——让「学到更强策略→某方
 * 胜率上升」这件事有一条可追溯的语料出处,而不是凭空捏的数字。
 *
 * 诚实边界(与 extract-strategies 同源,必须随报告呈现):
 * - 迁移:werewolf(One-Night-Ultimate-Werewolf 类)≠ 谁是卧底。狼阵营(Werewolf/Minion)
 *   →「卧底」类比,村民阵营 →「平民」类比。这是跨游戏迁移信号,不作直接谁是卧底证据。
 * - 胜负判定用 ONUW 的**简化规则**(见 decideWinner 注释),对第三方(Tanner)等边角做了
 *   近似;需要精细裁决请直读 raw。判定口径写进报告,读者可复核。
 * - 只吃 train split(泄漏隔离),与策略抽取同一套 gameId 过滤。
 * - 确定性、无随机源、无墙钟:同 raw + 同 manifest → 逐字节相同输出。
 */

/** 阵营:沿用归一化的二值映射(狼阵营→undercover 类比,其余→civilian 类比)。 */
export type Side = 'civilian' | 'undercover';

/** 一个话风簇的胜负统计。 */
export interface ClusterOutcome {
  id: ClusterId;
  persona: string;
  /** 该簇纳入统计的玩家样本数(跨局累加)。 */
  members: number;
  /** 其中所属阵营最终获胜的样本数。 */
  wins: number;
  /** wins / members —— 「这种话风的人有多常在获胜方」。 */
  winRate: number;
}

/** 挖掘报告:阵营经验基线 + 逐簇获胜方占比。 */
export interface OutcomeReport {
  method: string;
  /** 判定出明确胜负、且存在「卧底」类比方的局数。 */
  decidedGames: number;
  /** 纳入统计的玩家样本总数(≥MIN_UTTERANCES 且能定阵营)。 */
  eligiblePlayers: number;
  /** 经验基线:这些局里平民类比方 / 卧底类比方各自的获胜局占比。 */
  baseline: { civilianWinRate: number; undercoverWinRate: number };
  clusters: ClusterOutcome[];
}

/** 玩家至少说满这么多句才作为一个风格样本(与 extract-strategies 一致)。 */
const MIN_UTTERANCES = 5;

const round4 = (x: number): number => Math.round(x * 10000) / 10000;

/** endRole → 阵营(与 normalize.ts 同口径:狼阵营为 undercover 类比)。 */
function sideOfRole(role: string): Side {
  return /werewolf|wolf|minion/i.test(role) ? 'undercover' : 'civilian';
}

/**
 * ONUW 简化胜负判定(诚实近似):
 * - 得票最多者被处决(平票则并列处决;全 'N/A' 弃权 → 无人处决)。
 * - 存在狼阵营时:只要**至少一名狼阵营被处决** → 村民(civilian 类比)胜;否则狼(undercover 类比)胜。
 * - 不存在狼阵营的局:无「卧底」类比方,退出统计(返回 null)——这类局不能给卧底动态提供信号。
 * 这是标准 ONUW「处决到狼即村民赢」的收敛简化,省略了 Tanner 自胜、猎人连带等第三方细则。
 */
export function decideWinner(votingOutcome: unknown[], sides: Side[]): Side | null {
  const hasUndercover = sides.includes('undercover');
  if (!hasUndercover) return null;

  const counts = new Map<number, number>();
  for (const target of votingOutcome) {
    if (typeof target !== 'number' || !Number.isInteger(target)) continue;
    if (target < 0 || target >= sides.length) continue;
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  if (counts.size === 0) return 'undercover'; // 全弃权 → 无人被处决 → 狼存活胜

  const maxVotes = Math.max(...counts.values());
  const executed = [...counts.entries()].filter(([, n]) => n === maxVotes).map(([i]) => i);
  const caughtUndercover = executed.some((i) => sides[i] === 'undercover');
  return caughtUndercover ? 'civilian' : 'undercover';
}

interface PlayerStat {
  cluster: ClusterId;
  side: Side;
  won: boolean;
}

/**
 * 把 raw werewolf 局(仅 train)挖成胜负相关性报告。
 * 每个 (局, 玩家):统计其主导说服标签 → 簇;由 endRoles 定阵营;由 decideWinner 定该局胜方;
 * won = (玩家阵营 === 胜方)。再按簇聚合获胜占比,并给出两阵营经验基线。
 */
export function mineOutcomes(games: unknown[], trainIds: ReadonlySet<string>): OutcomeReport {
  const stats: PlayerStat[] = [];
  let decidedGames = 0;
  let civilianWinGames = 0;
  let undercoverWinGames = 0;

  for (const raw of games) {
    const gameId = werewolfGameId(raw);
    if (!trainIds.has(gameId)) continue;
    const game = raw as Record<string, unknown>;
    const playerNames = (game.playerNames as string[]) ?? [];
    const endRoles = (game.endRoles as string[]) ?? (game.startRoles as string[]) ?? [];
    if (playerNames.length === 0 || endRoles.length < playerNames.length) continue;

    const sides = playerNames.map((_, i) => sideOfRole(endRoles[i] ?? ''));
    const winner = decideWinner((game.votingOutcome as unknown[]) ?? [], sides);
    if (!winner) continue; // 无卧底类比方的局不进统计
    decidedGames += 1;
    if (winner === 'civilian') civilianWinGames += 1;
    else undercoverWinGames += 1;

    // 玩家级主导标签(与 extract-strategies 同法:固定顺序 tie-break)
    const nameSet = new Set(playerNames);
    const perPlayer = new Map<string, { counts: Map<PersuasionTag, number>; utterances: number }>();
    for (const d of (game.Dialogue as Array<Record<string, unknown>>) ?? []) {
      const speaker = d.speaker as string;
      if (!nameSet.has(speaker)) continue;
      let vec = perPlayer.get(speaker);
      if (!vec) {
        vec = { counts: new Map(), utterances: 0 };
        perPlayer.set(speaker, vec);
      }
      vec.utterances += 1;
      for (const tag of (d.annotation as string[]) ?? []) {
        if ((PERSUASION_TAGS as readonly string[]).includes(tag)) {
          vec.counts.set(tag as PersuasionTag, (vec.counts.get(tag as PersuasionTag) ?? 0) + 1);
        }
      }
    }

    for (const [name, vec] of perPlayer) {
      if (vec.utterances < MIN_UTTERANCES || vec.counts.size === 0) continue;
      const seat = playerNames.indexOf(name);
      if (seat < 0) continue;
      let dominant: PersuasionTag = PERSUASION_TAGS[0];
      let best = -1;
      for (const tag of PERSUASION_TAGS) {
        const n = vec.counts.get(tag) ?? 0;
        if (n > best) {
          best = n;
          dominant = tag;
        }
      }
      const side = sides[seat];
      stats.push({ cluster: CLUSTER_OF[dominant], side, won: side === winner });
    }
  }

  const clusterIds = Object.keys(CLUSTER_META) as ClusterId[];
  const clusters: ClusterOutcome[] = clusterIds.map((id) => {
    const members = stats.filter((s) => s.cluster === id);
    const wins = members.filter((s) => s.won).length;
    return {
      id,
      persona: CLUSTER_META[id].persona,
      members: members.length,
      wins,
      winRate: members.length === 0 ? 0 : round4(wins / members.length),
    };
  });

  return {
    method:
      '玩家级主导说服标签→簇;endRoles→阵营(狼阵营=undercover 类比);ONUW 简化处决判定定胜方;' +
      'winRate=该簇玩家所属阵营获胜的样本占比。只统计 train split、存在卧底类比方的局。',
    decidedGames,
    eligiblePlayers: stats.length,
    baseline: {
      civilianWinRate: decidedGames === 0 ? 0 : round4(civilianWinGames / decidedGames),
      undercoverWinRate: decidedGames === 0 ? 0 : round4(undercoverWinGames / decidedGames),
    },
    clusters,
  };
}
