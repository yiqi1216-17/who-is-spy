import type { Strategy } from '../schema.js';
import { werewolfGameId } from './normalize.js';

/**
 * 策略抽取(data/README.md 执行路线第 4 步;OpenSpec 03 · tasks 4.1/4.2 拾取)
 *
 * 输入:werewolf-among-us Youtube 子集原始局 + train split 的 gameId 集合(来自
 * data/splits/split-manifest.json)。**只有 train 局进入拟合**——frozen/rolling/holdout
 * 在入口即被过滤,这是 splits 泄漏隔离在"策略拟合"面的兑现。
 *
 * 方法(可解释、确定性,无随机源):
 * 1. 玩家级向量:每个 (局, 玩家) 统计 6 类说服策略标注(≥ MIN_UTTERANCES 句才纳入);
 * 2. 按主导标签分桶到四个簇(Evidence / Identity Declaration / Call for Action 三类
 *    "信息投放"动作合并为 informer 簇——单独成簇的样本量不足);
 * 3. 簇内聚合 → 三个连续量(公式见下)+ top3 标签经固定词典生成 tactics
 *    (**选择与排序由数据决定,表述由词典固定**);
 * 4. sampleIds = 簇内发言最多成员所在的局(去重前 5,全部 ⊆ train)。
 *
 * 连续量公式(占比 ∈ [0,1],直接采用簇内实测占比、不做拉伸——诚实呈现):
 * - specificity ← (Evidence + Identity Declaration) / 策略动作总数:愿意给出可核查细节;
 * - novelty     ← (Interrogation + Call for Action) / 总数:主动开辟新信息、推动局面;
 * - risk        ← (Accusation + Identity Declaration) / 总数:树敌与自曝的高风险动作。
 *
 * 已知近似(写给未来的自己):狼人杀→谁是卧底是跨游戏迁移(provenance=transfer),
 * 英文语料→中文对局的语言差、以及 train 实测"civilian 与 undercover 的策略分布几乎
 * 相同"(个体差异 >> 阵营差异)是 role:'any' 的数据依据——均记录于抽取报告。
 */

export const PERSUASION_TAGS = [
  'Interrogation',
  'Accusation',
  'Defense',
  'Evidence',
  'Identity Declaration',
  'Call for Action',
] as const;
export type PersuasionTag = (typeof PERSUASION_TAGS)[number];

/** 标签 → 中文操作性话术(prompt 渲染用;固定词典,选择由簇分布决定)。 */
export const TAG_TACTIC: Record<PersuasionTag, string> = {
  Interrogation: '多用提问收集信息、试探他人反应',
  Accusation: '直接点名怀疑对象并施压',
  Defense: '被怀疑时正面回应、澄清自身',
  Evidence: '引用场上可核查的细节作依据',
  'Identity Declaration': '主动亮明立场为局面定调',
  'Call for Action': '号召大家统一行动或投票',
};

/** 主导标签 → 簇。 */
const CLUSTER_OF: Record<PersuasionTag, ClusterId> = {
  Interrogation: 'interrogator',
  Accusation: 'accuser',
  Defense: 'defender',
  Evidence: 'informer',
  'Identity Declaration': 'informer',
  'Call for Action': 'informer',
};

type ClusterId = 'interrogator' | 'accuser' | 'defender' | 'informer';

const CLUSTER_META: Record<ClusterId, { strategyId: string; persona: string }> = {
  interrogator: { strategyId: 'interrogator-probe', persona: '质询试探' },
  accuser: { strategyId: 'accuser-pressure', persona: '直接施压' },
  defender: { strategyId: 'defender-guard', persona: '稳守辩护' },
  informer: { strategyId: 'informer-anchor', persona: '举证定调' },
};

/** 玩家至少说满这么多句才作为一个风格样本(过滤噪声)。 */
const MIN_UTTERANCES = 5;

export interface ClusterReport {
  id: ClusterId;
  strategyId: string;
  persona: string;
  members: number;
  utterances: number;
  actions: number;
  distribution: Record<PersuasionTag, number>;
  sampleIds: string[];
}

export interface ExtractionReport {
  method: string;
  trainGames: number;
  eligiblePlayers: number;
  clusters: ClusterReport[];
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

interface PlayerVector {
  gameId: string;
  counts: Map<PersuasionTag, number>;
  utterances: number;
}

export function extractStrategies(
  games: unknown[],
  trainIds: ReadonlySet<string>,
): { strategies: Strategy[]; report: ExtractionReport } {
  // 1. 只吃 train 局(泄漏隔离);玩家级统计
  const vectors: PlayerVector[] = [];
  let trainGames = 0;
  for (const raw of games) {
    const gameId = werewolfGameId(raw);
    if (!trainIds.has(gameId)) continue;
    trainGames += 1;
    const game = raw as Record<string, unknown>;
    const playerNames = new Set((game.playerNames as string[]) ?? []);
    const perPlayer = new Map<string, PlayerVector>();
    for (const d of (game.Dialogue as Array<Record<string, unknown>>) ?? []) {
      const speaker = d.speaker as string;
      if (!playerNames.has(speaker)) continue; // 主持人/旁观不是玩家行为
      let vec = perPlayer.get(speaker);
      if (!vec) {
        vec = { gameId, counts: new Map(), utterances: 0 };
        perPlayer.set(speaker, vec);
      }
      vec.utterances += 1;
      for (const tag of (d.annotation as string[]) ?? []) {
        if ((PERSUASION_TAGS as readonly string[]).includes(tag)) {
          vec.counts.set(tag as PersuasionTag, (vec.counts.get(tag as PersuasionTag) ?? 0) + 1);
        }
      }
    }
    for (const vec of perPlayer.values()) {
      if (vec.utterances >= MIN_UTTERANCES && vec.counts.size > 0) vectors.push(vec);
    }
  }

  // 2. 主导标签分桶(tie-break:PERSUASION_TAGS 固定顺序,确定性)
  const clusters = new Map<ClusterId, PlayerVector[]>();
  for (const vec of vectors) {
    let dominant: PersuasionTag = PERSUASION_TAGS[0];
    let best = -1;
    for (const tag of PERSUASION_TAGS) {
      const n = vec.counts.get(tag) ?? 0;
      if (n > best) {
        best = n;
        dominant = tag;
      }
    }
    const cluster = CLUSTER_OF[dominant];
    clusters.set(cluster, [...(clusters.get(cluster) ?? []), vec]);
  }

  // 3. 簇聚合 → 原型
  const clusterIds = Object.keys(CLUSTER_META) as ClusterId[];
  const reports: ClusterReport[] = [];
  for (const id of clusterIds) {
    const members = clusters.get(id) ?? [];
    if (members.length === 0) {
      throw new Error(`语料不足:簇 ${id} 无成员(≥${MIN_UTTERANCES} 句的玩家),无法支撑 4 原型`);
    }
    const agg = new Map<PersuasionTag, number>();
    let actions = 0;
    let utterances = 0;
    for (const vec of members) {
      utterances += vec.utterances;
      for (const tag of PERSUASION_TAGS) {
        const n = vec.counts.get(tag) ?? 0;
        agg.set(tag, (agg.get(tag) ?? 0) + n);
        actions += n;
      }
    }
    const share = (tag: PersuasionTag): number => (agg.get(tag) ?? 0) / actions;
    const distribution = Object.fromEntries(
      PERSUASION_TAGS.map((t) => [t, round3(share(t))]),
    ) as Record<PersuasionTag, number>;
    // sampleIds:发言最多成员所在局,去重前 5;tie-break gameId 字典序
    const sampleIds: string[] = [];
    for (const vec of [...members].sort(
      (a, b) => b.utterances - a.utterances || a.gameId.localeCompare(b.gameId),
    )) {
      if (!sampleIds.includes(vec.gameId)) sampleIds.push(vec.gameId);
      if (sampleIds.length === 5) break;
    }
    reports.push({
      id,
      strategyId: CLUSTER_META[id].strategyId,
      persona: CLUSTER_META[id].persona,
      members: members.length,
      utterances,
      actions,
      distribution,
      sampleIds,
    });
  }

  // 4. 按簇规模降序排列(最常见风格在前;座次 ai-1..4 依此取),tie-break 簇名
  reports.sort((a, b) => b.members - a.members || a.id.localeCompare(b.id));

  const strategies: Strategy[] = reports.map((c) => {
    const top3 = [...PERSUASION_TAGS]
      .sort((a, b) => c.distribution[b] - c.distribution[a] || PERSUASION_TAGS.indexOf(a) - PERSUASION_TAGS.indexOf(b))
      .slice(0, 3);
    return {
      id: c.strategyId,
      version: 2, // v1 = synthetic 手写种子;v2 = transfer 实测分布回填
      role: 'any', // 数据依据:train 上 civilian 与 undercover 的策略分布几乎相同
      persona: c.persona,
      tactics: top3.map((t) => TAG_TACTIC[t]),
      specificity: round3(c.distribution.Evidence + c.distribution['Identity Declaration']),
      novelty: round3(c.distribution.Interrogation + c.distribution['Call for Action']),
      risk: round3(c.distribution.Accusation + c.distribution['Identity Declaration']),
      provenance: { kind: 'transfer', sampleIds: c.sampleIds },
    };
  });

  return {
    strategies,
    report: {
      method:
        '玩家级主导标签分桶;specificity=Evidence+IdentityDeclaration, novelty=Interrogation+CallForAction, risk=Accusation+IdentityDeclaration(簇内占比)',
      trainGames,
      eligiblePlayers: vectors.length,
      clusters: reports,
    },
  };
}
