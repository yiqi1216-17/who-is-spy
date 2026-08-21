import type { GameModel } from '../model.js';
import type { AgentContext, GameReview, GameState, VoteTarget } from '../types.js';

/**
 * 策略敏感的确定性模型(OpenSpec 04 · 迭代对比评测的因果引擎)
 *
 * 为什么需要它:`FakeGameModel` 的描述只由「座次×轮次」选句,**完全忽略 strategy**——
 * 用它跑 v1(synthetic)vs v2(transfer)会得到**零差异**,对比就是空转。要让「策略差异化」
 * 这件事在指标上**真实可见**,模型的措辞必须**真的读 strategy**:persona 决定用哪套词库,
 * specificity/novelty 决定在词库里怎么取词。于是——
 *   - 四个**可区分 persona** → 四套不同词库 → 跨 AI 描述相似度低 → 过多样度门、可区分率高;
 *   - **坍缩成同一 persona**(collapsed 基线)→ 同一套词库 → 描述高度雷同 → 撞 0.72 同质门 →
 *     质量门反复重试 → 穷尽则整回合原子终止(completion↓、retries↑)。
 * 这条因果链把 CH-2(人设无效→有效)直接映成指标 diff,且**不含任何密词**(词库与密词正交)。
 *
 * determinism:输出只由 (persona, specificity 档, novelty 档, round, seat) 决定,无随机源、无墙钟,
 * 故同 seed 同配置**逐字节可复现**(与 eval/self-play 的 byte-stable 口径一致)。
 */

/** 每个 persona 一套**互不重叠**的意象词库,保证不同 persona 的描述天然低相似。
 *  每套 ≥6 句,配合「按轮次轮转」保证同一 AI 跨轮不自我重复(过 0.8 自我重复门)。 */
const PERSONA_LEXICONS: Record<string, readonly string[]> = {
  质询试探: ['我想先问问大家的第一反应', '这里我更想追问一句细节', '有个疑点值得摊开来聊', '不妨顺着刚才的话头再探一层', '我倒想反问一句为什么', '追着这条线索再挖一挖'],
  稳守辩护: ['我的立场一向稳妥不冒进', '先把自己的理由讲清楚免得误解', '守住基本盘再谈其他', '我倾向保留判断多看两轮', '别急着下结论稳一稳', '为自己辩白几句以正视听'],
  直接施压: ['我直接点名心里那个可疑对象', '别绕弯子局势已经很明显', '现在就该集中火力压上去', '拖下去只会让对方更从容', '我把矛头对准最扎眼的那位', '施加压力逼他露出破绽'],
  举证定调: ['我用前面的公开线索来定调', '把已知的证据摆出来对照', '依据摆在台面上结论自清', '让事实替我说话不掺情绪', '援引方才那句作为佐证', '据实梳理这条证据链'],
  // v1(synthetic)四 persona:
  谨慎观察: ['我先给一个上位的大方向', '暂不抢先定性留点余地', '从整体轮廓上先做铺垫', '稳一点先看清场面再说', '按兵不动多观望一轮', '含蓄地勾一笔不点破'],
  直觉敏锐: ['凭直觉这里有种微妙氛围', '第一感觉顺着场上语气走', '有股说不清的味道值得留意', '跟着感觉抓那点不协调', '灵光一现捕到一丝异样', '嗅到一点若隐若现的偏差'],
  逻辑派: ['我按功能和用途做结构归类', '把各方措辞对齐来比对', '从逻辑链条上拆开来看', '一条条对应着往下推演', '归纳出几类再逐项排除', '演绎地推导最可能的解'],
  出其不意: ['换一个没人想到的新角度', '故意制造一点反差感', '偏要绕开前面雷同的说法', '来个出人意料的切入', '反其道行之打乱节奏', '抛出一记意料之外的联想'],
};

/** collapsed 基线用的单一 persona——所有座位共用,制造高度雷同。 */
const COLLAPSED_KEY = '质询试探';

/** persona 未登记时的兜底词库(仍不含密词)。 */
const FALLBACK = ['我先说说自己的一点浅见', '大致是这样一个印象', '我谈谈初步的看法', '先给个粗略的判断'];

export class StrategyDrivenModel implements GameModel {
  readonly model: string;
  /** collapsed=true 时忽略 persona 差异,全部座位取同一词库(制造同质,供基线对照)。 */
  constructor(private readonly collapsed = false, label = 'strategy-driven-fixture') {
    this.model = label;
  }
  isConfigured(): boolean {
    return true;
  }

  async describe(context: AgentContext): Promise<string> {
    const persona = this.collapsed ? COLLAPSED_KEY : context.strategy.persona;
    const lexicon = PERSONA_LEXICONS[persona] ?? FALLBACK;
    const seat = seatNumber(context.identity.playerId);
    const round = context.game.round;
    // 起点(offset)由 persona 的 specificity/novelty + 座次决定 → 不同 persona/座位起句不同;
    // 「+round」让同一 AI 每轮沿词库前进一格 → 跨轮不自我重复(过 0.8 门)。
    // collapsed 时忽略 persona/座次差异,全体同起点同步进 → 同轮描述高度雷同(撞 0.72 同质门)。
    const spec = Math.round(context.strategy.specificity * (lexicon.length - 1));
    const nov = Math.round(context.strategy.novelty * (lexicon.length - 1));
    const base = this.collapsed ? 0 : spec + nov + (seat - 1);
    return lexicon[(base + (round - 1)) % lexicon.length];
  }

  async vote(
    _context: AgentContext,
    allowed: VoteTarget[],
  ): Promise<{ targetId: string; reason: string }> {
    // 投票不是本对比的信号面(引擎已裁决合法性),取首个合法目标即可,理由不含密词。
    const target = allowed.find((p) => p.isHuman) ?? allowed[0];
    return { targetId: target.id, reason: '综合公开描述，这一位与我的判断偏差最大' };
  }

  async review(game: GameState): Promise<GameReview> {
    return {
      headline: '措辞的分野决定了终局',
      summary: '各人依自己的策略取向给出描述，公开信息逐步收敛出阵营分野。',
      turningPoints: ['首轮描述已显出策略差异。', '票型在终局向真正的偏差者集中。'],
      playerInsights: game.players.map((p) => ({
        playerId: p.id,
        insight: `${p.name}保持了与自身取向一致的判断。`,
      })),
    };
  }
}

function seatNumber(playerId: string): number {
  return Number.parseInt(playerId.replace(/\D/g, ''), 10) || 1;
}
