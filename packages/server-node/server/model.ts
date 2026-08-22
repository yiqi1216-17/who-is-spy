import { z } from 'zod';
import type { AgentContext, GameReview, GameState, VoteTarget } from './types.js';

const descriptionSchema = z.object({
  description: z.string().trim().min(2).max(60),
  private_reasoning_summary: z.string().trim().min(1).max(120).optional(),
});

/** 上帝模式描述:除公开发言外，强制回传一句仅上帝可见的内心独白。 */
const godDescribeSchema = z.object({
  description: z.string().trim().min(2).max(60),
  inner_monologue: z.string().trim().min(1).max(60),
});

const voteSchema = z.object({
  targetId: z.string().min(1),
  reason: z.string().trim().min(2).max(80),
});

const reviewSchema = z.object({
  headline: z.string().trim().min(2).max(40),
  summary: z.string().trim().min(10).max(300),
  turningPoints: z.array(z.string().trim().min(2).max(120)).min(1).max(4),
  playerInsights: z.array(
    z.object({
      playerId: z.string(),
      insight: z.string().trim().min(2).max(120),
    }),
  ),
});

export class ModelError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ModelError';
  }
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface GameModel {
  readonly model: string;
  isConfigured(): boolean;
  describe(context: AgentContext): Promise<string>;
  vote(context: AgentContext, allowedTargets: VoteTarget[]): Promise<{ targetId: string; reason: string }>;
  review(game: GameState): Promise<GameReview>;
  /**
   * 上帝模式:在给出公开描述的同时,回传一句仅「上帝旁观者」可见的内心 OS(inner_monologue)。
   * **可选**——只有上帝模式需要;缺省实现可回退为 describe + 空 OS。OS 绝不进入任何 agent 的上下文,
   * 也绝不落盘(见 types.ts · GodGameState 的隔离说明)。
   */
  describeWithThought?(context: AgentContext): Promise<{ text: string; thought: string }>;
}

export class DeepSeekClient implements GameModel {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options?: { apiKey?: string; baseUrl?: string; model?: string }) {
    this.apiKey = options?.apiKey ?? process.env.DEEPSEEK_API_KEY ?? '';
    this.baseUrl = (options?.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');
    this.model = options?.model ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async describe(context: AgentContext): Promise<string> {
    const { strategy } = context;
    const hasPrior = context.game.publicDescriptions.some(
      (item) => item.round === context.game.round,
    );
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          '你正在玩“谁是卧底”。只依据收到的私有身份、自己的词和公开信息行动。绝不说出词语本身，不虚构其他玩家信息。' +
          '本轮是「描述轮」：公开描述必须是陈述句，正面描述你自己拿到的词，不得向其他玩家提问、反问或点名盘问——问句一律不合规。' +
          (hasPrior
            ? '【结构要求】你的发言 = 描述（必选）+ 回应（可选）：必须包含一条关于你自己的词的**新信息**（新角度/新细节，不与任何已公开描述雷同）；' +
              '可以另外用半句呼应或对比**至多一位**先发玩家的说法（如「不像谁说的那样…，我这个更…」），但回应绝不能替代描述——只评论他人、不给出自己词的新信息，一律不合规。'
            : '你是本轮先发之一：直接给出关于你自己的词的一条具体信息即可。') +
          '用自然、含蓄、像真人的中文描述，避免每轮重复角度。' +
          `请贴合你的策略人设“${strategy.persona}”：倾向手法为「${strategy.tactics.join('、')}」（其中质询、试探、施压等盘问倾向仅适用于投票/讨论环节，本描述轮不生效）；` +
          `具体度约 ${fmt(strategy.specificity)}（越高越贴近细节但绝不泄词）、` +
          `新颖度约 ${fmt(strategy.novelty)}（越高越换角度、越避免与已公开描述雷同）、` +
          `冒险度约 ${fmt(strategy.risk)}（越高越敢贴近，但仍不得说出词本身）。只输出 JSON。`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          task:
            '为本轮给出一句公开描述（陈述句，不得为问句/反问）。description 需为 2–60 个字符（约 28 个汉字以内），不能包含自己的词。' +
            (hasPrior ? '必须含你自己词的新信息；对先发的呼应可选、至多一位。' : ''),
          context,
          // 只要 description 一个字段:延迟正比于输出长度,砍掉不被消费的字段即等比提速。
          output: { description: 'string' },
        }),
      },
    ];

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        // 描述 ≤60 字,给足 JSON 包裹余量即封顶(160 ≈ 2.5× 正常长度):够长描述完整闭合 JSON,
        // 又杜绝模型跑长。太紧会把 JSON 截断→解析失败→触发重试反而更慢,故留足余量。
        const result = descriptionSchema.parse(await this.chatJson(messages, 0.8, 160));
        if (result.description.includes(context.identity.word)) {
          throw new Error('描述包含秘密词');
        }
        return result.description;
      } catch (error) {
        lastError = error;
      }
    }
    throw new ModelError(
      `AI 未能生成合规描述，已自动重试；请再试一次 [诊断:${String((lastError as Error)?.message ?? lastError).slice(0, 200)}]`,
      lastError,
    );
  }

  /**
   * 上帝模式描述:公开发言 + 一句只对上帝可见的内心独白。
   * 与 describe 同源、但独立 prompt(要求第一人称、可流露真实意图/伪装心理),
   * 因此不改动经契约验证的 describe 路径。OS 只回给引擎汇入上帝 DTO,绝不发给其他玩家。
   */
  async describeWithThought(context: AgentContext): Promise<{ text: string; thought: string }> {
    const { strategy } = context;
    const hasPrior = context.game.publicDescriptions.some(
      (item) => item.round === context.game.round,
    );
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          '你正在玩“谁是卧底”。只依据收到的私有身份、自己的词和公开信息行动。绝不说出词语本身，不虚构其他玩家信息。' +
          '本轮是「描述轮」：公开描述必须是陈述句，正面描述你自己拿到的词，不得向其他玩家提问、反问或点名盘问——问句一律不合规。' +
          (hasPrior
            ? '【结构要求】你的发言 = 描述（必选）+ 回应（可选）：必须包含一条关于你自己的词的**新信息**；' +
              '可另用半句呼应或对比至多一位先发玩家，但回应绝不能替代描述。'
            : '') +
          '用自然、含蓄、像真人的中文描述，避免每轮重复角度。' +
          `请贴合你的策略人设“${strategy.persona}”：倾向手法为「${strategy.tactics.join('、')}」（其中质询、试探、施压等盘问倾向仅适用于投票/讨论环节，本描述轮不生效）；` +
          `具体度约 ${fmt(strategy.specificity)}、新颖度约 ${fmt(strategy.novelty)}、冒险度约 ${fmt(strategy.risk)}。` +
          '除公开描述外，另给一句仅“上帝旁观者”可见的内心独白 inner_monologue：第一人称、不超过 30 个汉字，' +
          '可流露你此刻的真实意图与心理（卧底的伪装与试探 / 平民的怀疑对象与依据）。它绝不会发送给其他任何玩家。只输出 JSON。',
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: '给出本轮公开描述 description(陈述句、不得为问句/反问，2–60 字符，不能包含自己的词)，以及一句内心独白 inner_monologue(≤30 汉字)。',
          context,
          output: { description: 'string', inner_monologue: 'string' },
        }),
      },
    ];

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = godDescribeSchema.parse(await this.chatJson(messages, 0.8, 160));
        if (result.description.includes(context.identity.word)) {
          throw new Error('描述包含秘密词');
        }
        return { text: result.description, thought: result.inner_monologue };
      } catch (error) {
        lastError = error;
      }
    }
    throw new ModelError('AI 未能生成合规描述（上帝模式），已自动重试；请再试一次', lastError);
  }

  async vote(context: AgentContext, allowedTargets: VoteTarget[]): Promise<{ targetId: string; reason: string }> {
    const targetIds = allowedTargets.map((player) => player.id);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          '你正在玩“谁是卧底”。只依据自己的私有身份、词语与公开描述投票。不得读取或猜测系统未提供的隐藏字段。必须投给存活的其他玩家，并给出简短公开理由。只输出 JSON。',
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: '选择最可疑的一名玩家。',
          context,
          allowedTargets: allowedTargets.map(({ id, name }) => ({ id, name })),
          output: { targetId: '必须来自 allowedTargets.id', reason: '不超过 36 个汉字' },
        }),
      },
    ];

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = voteSchema.parse(await this.chatJson(messages, 0.8, 160));
        if (!targetIds.includes(result.targetId)) {
          throw new Error(`无效投票目标: ${result.targetId}`);
        }
        return result;
      } catch (error) {
        lastError = error;
      }
    }
    throw new ModelError('AI 未能生成有效选票，已自动重试；请再试一次', lastError);
  }

  async review(game: GameState): Promise<GameReview> {
    const publicRecord = {
      players: game.players.map(({ id, name, role, word, alive }) => ({ id, name, role, word, alive })),
      descriptions: game.descriptions,
      votes: game.votes,
      events: game.events,
      winner: game.winner,
    };
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: '你是“谁是卧底”的专业赛后分析师。根据完整赛局生成精炼、具体、有洞察的中文复盘。只输出 JSON。',
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: '指出关键转折、描述策略和投票逻辑。playerInsights 覆盖每名玩家。',
          record: publicRecord,
          output: {
            headline: 'string',
            summary: 'string',
            turningPoints: ['string'],
            playerInsights: [{ playerId: 'string', insight: 'string' }],
          },
        }),
      },
    ];
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return reviewSchema.parse(await this.chatJson(messages, 0.45));
      } catch (error) {
        lastError = error;
      }
    }
    throw new ModelError('AI 未能生成结构化复盘', lastError);
  }

  private async chatJson(
    messages: ChatMessage[],
    temperature = 0.8,
    maxTokens?: number,
  ): Promise<unknown> {
    if (!this.isConfigured()) {
      throw new ModelError('未配置 DEEPSEEK_API_KEY，请复制 .env.example 为 .env 后填写密钥');
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            temperature,
            response_format: { type: 'json_object' },
            ...(maxTokens ? { max_tokens: maxTokens } : {}),
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const detail = await response.text();
          throw new Error(`DeepSeek ${response.status}: ${detail.slice(0, 240)}`);
        }
        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = payload.choices?.[0]?.message?.content;
        if (!content) throw new Error('DeepSeek 返回了空内容');
        return JSON.parse(stripCodeFence(content));
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 600));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new ModelError('AI 服务暂时不可用，已自动重试；请稍后再试', lastError);
  }
}

/** 把 0–1 的连续量转成便于模型理解的百分比语言。 */
function fmt(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function stripCodeFence(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
}
