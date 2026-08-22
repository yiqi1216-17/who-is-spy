import type { GameModel } from '../model.js';
import type { AgentContext, GameReview, GameState, VoteTarget } from '../types.js';
import { similarity } from '../quality-policy.js';

/**
 * 军备竞赛模型(OpenSpec 04 · 阵营胜率军备竞赛的因果引擎)
 *
 * StrategyDrivenModel 让「描述质量」指标动起来,却对**胜负纹丝不动**——因为它的 vote 恒投首个
 * 合法目标,淘汰顺序与策略无关。本模型把缺失的那条因果链补上:**让投票由技能驱动**,于是
 * 「学到更强策略 → 某一方更容易赢」在 civilian_win_rate/undercover_win_rate 上真实可见。
 *
 * 机制(全部只读**公开信息 + 自己的身份**,绝不触碰他人 role/word,隔离不变量原样保持):
 *
 *  A. 描述(describe)——制造可被识别的「离群度」:
 *     每条描述 = 共享中性核(NEUTRAL,给平民之间的基础重叠,但压在引擎 0.72 同质门之下)
 *              + 角色风味段(FLAVOR)。
 *     - 平民:风味来自「平民词主题」——彼此相近(同主题)、与卧底相异。
 *     - 卧底:风味按 spyBlend 融入中性核——blend 越高,越用人人都认同的泛化措辞,离群度越低、
 *       越难被抓(技术高的卧底「说安全话」)。blend=0 时用自身词主题 → 明显离群、易被抓。
 *
 *  B. 投票(vote)——技能决定「抓得准不准」:
 *     - 平民:在公开描述上算每个候选的**离群度**(与其余描述的平均不相似度),以概率 civSkill
 *       投「最离群者」(抓真卧底);否则回落确定性首选(等价于陪跑基线,不带信号)。
 *       civMode='cumulative' 时按**跨轮累计**离群度排序——对单轮融入更鲁棒(平民的「精进」)。
 *     - 卧底:以概率 spyDeflect 把票投向某个**领先平民**(转移火力、消耗平民数),否则回落。
 *
 * determinism:技能门用 (voterId, round, 自己的词, 配置盐) 的确定性哈希取伪随机——无 Math.random、
 * 无墙钟。词对/卧底位逐局不同 → 技能门在批内产生分布(胜率落在 [0,1] 之间而非恒 0/1),
 * 且同 seed 同配置逐字节可复现。
 */

/** 一档技能配置 = 军备竞赛的一次「迭代」。 */
export interface SkillProfile {
  id: string;
  label: string;
  /** 平民按离群度投中真卧底的概率(否则回落确定性首选)。 */
  civSkill: number;
  /** 平民识别模式:单轮离群度 vs 跨轮累计离群度(后者对卧底融入更鲁棒)。 */
  civMode: 'round' | 'cumulative';
  /** 卧底描述融入中性核的程度(0=暴露自身词主题,1=完全泛化)。越高越难被抓。 */
  spyBlend: number;
  /** 卧底把票投向领先平民(转移火力)的概率;否则回落确定性首选。 */
  spyDeflect: number;
  /**
   * 诡辩/**稳态伪装**(人类高手手法):blend 决策**去掉轮次盐** → 全程一致的假故事,而非逐轮
   * 即兴。这样消除了 civMode='cumulative' 平民赖以识别的「露馅轮」——一次编好、轮轮咬定的谎言,
   * 比临时圆的谎更难被跨轮累计抓住。默认 undefined(=逐轮独立,保持既有档位逐字节不变)。
   */
  spyConsistent?: boolean;
  /**
   * 平民**确信阈值**(诡辩局的另一面):只有当「最离群者」比次离群者的离群度**领先 ≥ 该值**时,
   * 平民才敢锁定他;否则视作「场上人人相似、无从分辨」→ 退回非信号回落。稳态诡辩的卧底把自己
   * 的锚句与平民抹平,离群度差被压到阈值之下 → 平民的识别信号**结构性失灵**。这正是「诡辩让所有人
   * 看起来同样可信」的机制刻画。默认 undefined(=任意正差即锁定,保持既有档位逐字节不变)。
   */
  identifyGap?: number;
}

/**
 * 锚句池(**共享**,按密词取窗口):同一密词 → 同一段两句锚 → 全体平民共享这两句,聚成一簇;
 * 不同密词(卧底自己的词)→ 另一段锚 → 与平民簇无重叠、成离群点。均与 24 候选密词正交。
 */
const ANCHOR: readonly string[] = [
  '这个大家应该都不陌生', '平时也算常见的东西', '说起来还挺日常的', '给人的感觉比较平和',
  '不算特别稀奇的那种', '总体印象是温和好懂', '放在生活里很寻常', '接触起来没什么门槛',
  '属于随处可见的一类', '让人觉得亲切自然', '没有太强的距离感', '整体气质比较柔和',
];

/**
 * 尾句池(**按座次专属**,互不重叠):每个座次分到一段连续尾句,按轮次前进一格 → 同一玩家
 * 跨轮不自我重复(过引擎 0.8 自我重复门),不同座次尾句相异(平民彼此不撞 0.72 同质门)。
 */
const TAIL: readonly string[] = [
  '我个人会多留意它的细节', '习惯从用途上去想它', '也会看它在手里的分量',
  '更在意它给人的第一印象', '倾向按场景去联想它', '还会想到它出现的时机',
  '会关注它相处时的分寸', '喜欢从熟悉度上判断它', '也在意它的常见程度',
  '偏好看它是否顺手好用', '常从氛围上体会它', '还会留心它的存在感',
];

const ANCHOR_WINDOW = 2;
const TAIL_WINDOW = 2;

/**
 * 稳态伪装(诡辩档)的**固定中性掩护词**:当卧底选择伪装、但本轮尚无平民可借其锚时,退回这个
 * 恒定的中性主题(而非自身词主题)。全程恒定 → 不制造露馅轮,与「借邻座锚」同属一套自洽假故事。
 * 取一个与 24 候选密词正交的中性词,使其锚窗稳定落在人人都认同的泛化措辞上。
 */
const NEUTRAL_COVER = '寻常';
/** 每个座次在 TAIL 里的专属段长度(3 句,足够 3 轮各取 2 句且逐轮前进不重复)。 */
const TAIL_STRIDE = 3;

/** FNV-1a 32 位:稳定、无随机源;给技能门与主题偏移取确定性数值。 */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function seatNumber(playerId: string): number {
  return Number.parseInt(playerId.replace(/\D/g, ''), 10) || 0;
}

/** 密词 → 共享锚窗起点(同词恒同,聚簇;异词相隔,离群)。 */
function anchorStart(word: string): number {
  return hash32(word) % ANCHOR.length;
}

const SEP = '，';

/** 取 ANCHOR_WINDOW 个共享锚句(按词)。 */
function anchorPhrases(word: string): string[] {
  const start = anchorStart(word);
  const out: string[] = [];
  for (let i = 0; i < ANCHOR_WINDOW; i += 1) out.push(ANCHOR[(start + i) % ANCHOR.length]);
  return out;
}

/** 取该座次专属的 TAIL_WINDOW 个尾句,按轮次前进 → 跨轮不自我重复,跨座次相异。 */
function tailPhrases(seat: number, round: number): string[] {
  const segBase = (((seat - 1 + 4) % 4) * TAIL_STRIDE) % TAIL.length; // ai-1..4 各占一段;human→复用 ai-4 段
  const out: string[] = [];
  for (let i = 0; i < TAIL_WINDOW; i += 1) out.push(TAIL[(segBase + ((round - 1) + i) % TAIL_STRIDE) % TAIL.length]);
  return out;
}

export class ArmsRaceModel implements GameModel {
  readonly model: string;
  constructor(private readonly skill: SkillProfile) {
    this.model = `arms-race:${skill.id}`;
  }
  isConfigured(): boolean {
    return true;
  }

  async describe(context: AgentContext): Promise<string> {
    const seat = seatNumber(context.identity.playerId);
    const word = context.identity.word;
    const isSpy = context.identity.role === 'undercover';
    const tail = tailPhrases(seat, context.game.round);

    // 平民:共享锚(按自己的词)+ 座次专属尾 → 同词平民聚簇、彼此不撞同质门。
    if (!isSpy) return [...anchorPhrases(word), ...tail].join(SEP);

    // 卧底:默认用**自己词**的锚 → 与平民簇锚句不同 → 离群、易被抓。技术高的卧底会「融入」:
    // 以 spyBlend 概率借用**已公开的某位平民**的锚句(从公开描述学邻座措辞)→ 混进平民簇。
    // 关键:blend 掷骰**逐轮独立**——blend<1 的卧底会在某些轮「露馅」(用回自己的锚)。单轮平民
    // 可能错过那一轮,但**跨轮累计**(civMode='cumulative')会把露馅轮的离群度累进来 → 抓住不稳的融入。
    //
    // 诡辩/稳态伪装(spyConsistent):掷骰**去掉轮次盐** → 全程同一决策,不再有露馅轮。这正是
    // 人类高手对付「跨轮累计」的手法——编一个从头到尾自洽的假故事、轮轮咬定,而非临时圆谎。
    const blendSalt = this.skill.spyConsistent ? `${word}|${seat}|blend` : `${word}|${seat}|${context.game.round}|blend`;
    const blendBit = hash32(blendSalt) / 0xffffffff;
    if (blendBit < this.skill.spyBlend) {
      const peer = context.game.publicDescriptions.find(
        (d) => d.playerId !== context.identity.playerId && d.playerId !== 'human',
      );
      if (peer) {
        const borrowed = ANCHOR.filter((a) => peer.text.includes(a)).slice(0, ANCHOR_WINDOW);
        if (borrowed.length > 0) return [...borrowed, ...tail].join(SEP);
      }
      // 稳态伪装但本轮尚无平民可借(如首轮先发)→ 用**共享中性锚**兜底,仍不暴露自身词主题;
      // 逐轮档在这种情形回落自身词锚(见下),稳态档则坚持中性 → 跨轮一致、不制造露馅轮。
      if (this.skill.spyConsistent) return [...anchorPhrases(NEUTRAL_COVER), ...tail].join(SEP);
    }
    return [...anchorPhrases(word), ...tail].join(SEP);
  }

  async vote(
    context: AgentContext,
    allowed: VoteTarget[],
  ): Promise<{ targetId: string; reason: string }> {
    const voterId = context.identity.playerId;
    const round = context.game.round;
    const word = context.identity.word;
    const isSpy = context.identity.role === 'undercover';
    // 低技能回落:确定性伪随机地在合法目标里挑一个(而非恒取 allowed[0])——避免「全体低技能
    // 平民系统性投同一座位」这种结构性假信号,让 civSkill=0 时胜负接近随机基线。
    const fallbackPick = (salt: string): VoteTarget =>
      allowed[hash32(`${voterId}|${round}|${word}|${salt}|fb`) % allowed.length];

    const gate = (salt: string): number => hash32(`${voterId}|${round}|${word}|${salt}`) / 0xffffffff;

    // 候选的公开描述(按 civMode 取单轮或全部轮次)。
    const descs = context.game.publicDescriptions;
    const relevant = this.skill.civMode === 'cumulative' ? descs : descs.filter((d) => d.round === round);

    if (isSpy) {
      // 卧底:以概率 spyDeflect 投「离群度最低的领先平民」(最像平民、最无辜者——转移火力最划算)。
      if (gate('deflect') < this.skill.spyDeflect) {
        const target = this.leastDivergent(allowed, relevant);
        if (target) return { targetId: target, reason: '综合公开描述，这一位的说法我最认同' };
      }
      return { targetId: fallbackPick('spy').id, reason: '按场上顺序先表个态' };
    }

    // 平民:以概率 civSkill 投「最离群者」(疑似卧底);否则回落。
    if (gate('civ') < this.skill.civSkill) {
      const ranked = this.rankedDivergence(allowed, relevant);
      // 确信阈值:诡辩局要求「最离群者比次离群者领先足够多」才敢锁定。稳态诡辩把离群度抹平,
      // 领先差被压到阈值之下 → 平民「看谁都差不多」,识别信号失灵,退回非信号回落。
      const gapOk =
        this.skill.identifyGap === undefined ||
        (ranked.length >= 2 ? ranked[0].score - ranked[1].score >= this.skill.identifyGap : true);
      if (ranked.length > 0 && gapOk) {
        return { targetId: ranked[0].id, reason: '这一位的描述和大家的偏差最大，我怀疑他' };
      }
    }
    return { targetId: fallbackPick('civ').id, reason: '暂时先跟随场上多数的判断' };
  }

  /** 在 allowed 候选里选公开描述**离群度最高**者(与其余描述平均不相似度最大)。 */
  private mostDivergent(
    allowed: VoteTarget[],
    descs: ReadonlyArray<{ playerId: string; text: string }>,
  ): string | null {
    return this.rankByDivergence(allowed, descs, 'max');
  }
  /** 在 allowed 候选里选离群度**最低**者(最像大众)。 */
  private leastDivergent(
    allowed: VoteTarget[],
    descs: ReadonlyArray<{ playerId: string; text: string }>,
  ): string | null {
    return this.rankByDivergence(allowed, descs, 'min');
  }

  private rankByDivergence(
    allowed: VoteTarget[],
    descs: ReadonlyArray<{ playerId: string; text: string }>,
    pole: 'max' | 'min',
  ): string | null {
    const ranked = this.rankedDivergence(allowed, descs); // 降序:离群度高 → 低;同分按 allowed 原序
    if (ranked.length === 0) return null;
    if (pole === 'max') return ranked[0].id;
    // min:取最低分,同分保持 allowed 原序的**第一个**(与既有档位行为逐字节一致)。
    const min = ranked.reduce((a, b) => (b.score < a.score ? b : a));
    return ranked.find((r) => r.score === min.score)!.id;
  }

  /**
   * 给 allowed 候选按离群度**降序**打分(与其余 AI 描述的平均不相似度)。返回 `{id, score}[]`,
   * 供「最离群者 + 确信阈值(top1−top2 gap)」判定。同分时保持 allowed 顺序稳定(确定性)。
   *
   * 只在**AI 描述者**间比较:human 座位由确定性脚本陪跑(安全轮换句,与 AI 措辞天然无关),是
   * 识别噪声而非建模对象——纳入会让「最离群」恒指向 human。故候选与对照集都排除 human;卧底恰是
   * human 时该识别通道自然失效(靠陪跑身份逃脱)。
   */
  private rankedDivergence(
    allowed: VoteTarget[],
    descs: ReadonlyArray<{ playerId: string; text: string }>,
  ): Array<{ id: string; score: number }> {
    const byPlayer = new Map<string, string[]>();
    for (const d of descs) {
      if (d.playerId === 'human') continue;
      byPlayer.set(d.playerId, [...(byPlayer.get(d.playerId) ?? []), d.text]);
    }

    const scored: Array<{ id: string; score: number; order: number }> = [];
    allowed.forEach((cand, order) => {
      if (cand.isHuman) return;
      const own = byPlayer.get(cand.id);
      if (!own || own.length === 0) return;
      const others = [...byPlayer.entries()].filter(([id]) => id !== cand.id);
      if (others.length === 0) return;
      // 候选每条描述 vs 每个他人每条描述的平均相似度 → 不相似度 = 1 − 均值。
      let sum = 0;
      let n = 0;
      for (const mine of own) {
        for (const [, texts] of others) {
          for (const t of texts) {
            sum += similarity(mine, t);
            n += 1;
          }
        }
      }
      scored.push({ id: cand.id, score: n === 0 ? 0 : 1 - sum / n, order });
    });
    // 降序按 score;同分按 allowed 原序稳定(确定性,不引入隐藏偏置)。
    scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.order - b.order));
    return scored.map(({ id, score }) => ({ id, score }));
  }

  async review(game: GameState): Promise<GameReview> {
    return {
      headline: '技能高低决定了谁被识破',
      summary: '各方依自身技能档位行动：平民靠离群度锁定卧底，卧底靠融入与转移火力自保，胜负随之偏移。',
      turningPoints: ['首轮描述已拉开离群度差距。', '票型在关键轮向真正的偏差者（或被误导的目标）集中。'],
      playerInsights: game.players.map((p) => ({
        playerId: p.id,
        insight: `${p.name}按其技能档位做出了本局判断。`,
      })),
    };
  }
}
