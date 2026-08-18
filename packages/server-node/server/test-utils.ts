import type { AgentContext, GameReview, GameState, Player } from './types.js';
import type { GameModel } from './model.js';

/** 八句互相区分、均不含密词的假描述,供质量门在正常路径下恒放行。 */
const FAKE_DESCRIBE_LINES = [
  '这东西在生活里很常见，几乎天天都会碰到',
  '第一反应是一个和温度有关的画面',
  '偏向实用，形状让人印象比较深',
  '让我想起某个特定季节才有的氛围',
  '它更像是一种需要动手才能体会的乐趣',
  '感觉常出现在朋友聚会的场合里',
  '它有点低调，但少了会很不方便',
  '想到的是一个安静又专注的时刻',
] as const;

export class FakeGameModel implements GameModel {
  readonly model = 'deepseek-v4-flash-test-double';
  readonly descriptionContexts: AgentContext[] = [];
  readonly voteContexts: AgentContext[] = [];

  isConfigured(): boolean {
    return true;
  }

  async describe(context: AgentContext): Promise<string> {
    this.descriptionContexts.push(structuredClone(context));
    // 座次 + 轮次共同选句:同轮四座次互不雷同(过同质门),同座次跨轮不重复(过自我重复门),
    // 且均不含任何密词。使质量门在正常路径下恒放行。
    const seat = Number(context.identity.playerId.replace(/\D/g, '')) || 1;
    const index = (seat - 1 + (context.game.round - 1)) % FAKE_DESCRIBE_LINES.length;
    return FAKE_DESCRIBE_LINES[index];
  }

  async vote(
    context: AgentContext,
    allowedTargets: Player[],
  ): Promise<{ targetId: string; reason: string }> {
    this.voteContexts.push(structuredClone(context));
    const human = allowedTargets.find((player) => player.isHuman);
    const target = human ?? allowedTargets[0];
    return {
      targetId: target.id,
      reason: human ? '真人的描述与我的理解有细微偏差' : '这位玩家的措辞最可疑',
    };
  }

  async review(game: GameState): Promise<GameReview> {
    return {
      headline: '细微的语义偏差决定了终局',
      summary: '玩家们围绕相近概念谨慎描述，最终通过公开措辞和集中票型找到了不同阵营。',
      turningPoints: ['首轮描述形成了清晰的判断分歧。', '多数票在终局集中到真正的卧底。'],
      playerInsights: game.players.map((player) => ({
        playerId: player.id,
        insight: `${player.name}围绕自己的词给出了独立判断。`,
      })),
    };
  }
}
