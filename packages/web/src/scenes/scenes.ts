import type {
  GameEvent,
  HighlightReel,
  PublicGameState,
  PublicPlayer,
  Role,
} from '../types';

/**
 * 开发态场景库(OpenSpec 05-H · 任务 4.2)
 *
 * 每个场景都是一份**用生产类型构造**的确定性快照(PublicGameState / HighlightReel)——
 * 类型即 schema,tsc 逐字段校验其合法性。场景覆盖题面点名的关键呈现态:
 *   role-reveal / speech / vote / tie / elimination / failure / reconnect / finale / highlight / replay。
 *
 * 纯数据、无副作用、**不引用 api**:场景只喂给本地呈现层渲染,结构上无法改动任何真实对局(任务 4.3)。
 * 这些 fixture 同时是「表现层转场/幂等」测试与竖屏场景矩阵截图(任务 1.2 / 4.4)的确定性输入。
 */

/** UI 叠层:与剧场正交的网络轴(失败/重连),null 表示正常。 */
export type SceneOverlay = 'failure' | 'reconnect' | null;

export interface SceneFixture {
  readonly id: string;
  /** 中文场景名(开发者切换器可读)。 */
  readonly title: string;
  /** 一句话说明这个场景要定格的呈现态。 */
  readonly note: string;
  readonly snapshot: PublicGameState;
  /** 仅 highlight 场景附:终局高光 reel(默认剧透安全)。 */
  readonly highlights?: HighlightReel;
  /** 网络叠层(failure/reconnect 场景用)。 */
  readonly overlay?: SceneOverlay;
  /** replay 场景:提示 harness 以逐拍回放模式播放 beats。 */
  readonly replay?: boolean;
}

const SEAT_META: ReadonlyArray<{ id: string; name: string; avatar: string }> = [
  { id: 'human', name: '你', avatar: '🎭' },
  { id: 'ai-1', name: '阿序', avatar: '🧭' },
  { id: 'ai-2', name: '弥生', avatar: '🌾' },
  { id: 'ai-3', name: '老墨', avatar: '🖋️' },
  { id: 'ai-4', name: '小满', avatar: '🌱' },
];

function seat(id: string, over: Partial<PublicPlayer> = {}): PublicPlayer {
  const meta = SEAT_META.find((m) => m.id === id)!;
  return {
    id: meta.id,
    name: meta.name,
    avatar: meta.avatar,
    isHuman: id === 'human',
    alive: true,
    ...over,
  };
}

let eventCounter = 0;
function ev(type: GameEvent['type'], text: string, round: number, playerId?: string): GameEvent {
  eventCounter += 1;
  return { id: `ev-${eventCounter}`, type, text, round, ...(playerId ? { playerId } : {}) };
}

/** 基线:第 1 轮描述期,五席均在,human 为平民、密词「火锅」。 */
function baseState(over: Partial<PublicGameState> = {}): PublicGameState {
  return {
    id: 'scene',
    phase: 'describing',
    round: 1,
    ballot: 1,
    players: SEAT_META.map((m) => seat(m.id)),
    descriptions: [],
    votes: [],
    events: [ev('system', '游戏开始,请依次描述你拿到的词。', 1)],
    eligibleTargetIds: null,
    winner: null,
    review: null,
    human: { playerId: 'human', role: 'civilian', word: '火锅' },
    model: 'scene-fixture',
  };
}

// —— 各场景 ——

/** 1. 身份揭晓:开局私密展示 role/word,尚无任何描述。 */
function roleReveal(): PublicGameState {
  return baseState();
}

/** 2. 证词:已有两名 AI 先发言,轮到人类。 */
function speech(): PublicGameState {
  const state = baseState();
  return {
    ...state,
    descriptions: [
      { playerId: 'ai-1', text: '一种需要围坐分享的热食。', round: 1 },
      { playerId: 'ai-2', text: '天冷时最抚慰人心的选择。', round: 1 },
    ],
    events: [
      ...state.events,
      ev('description', '阿序:一种需要围坐分享的热食。', 1, 'ai-1'),
      ev('description', '弥生:天冷时最抚慰人心的选择。', 1, 'ai-2'),
    ],
  };
}

/** 3. 投票:全员描述完毕,进入投票,人类可投的目标已给出。 */
function vote(): PublicGameState {
  const spoken = speech();
  return {
    ...spoken,
    phase: 'voting',
    descriptions: [
      ...spoken.descriptions,
      { playerId: 'ai-3', text: '讲究一锅百味的仪式感。', round: 1 },
      { playerId: 'ai-4', text: '和朋友一起才够味的东西。', round: 1 },
      { playerId: 'human', text: '围着热气聊天的一餐。', round: 1 },
    ],
    eligibleTargetIds: ['ai-1', 'ai-2', 'ai-3', 'ai-4'],
    events: [...spoken.events, ev('system', '描述结束,请投票选出你认为的卧底。', 1)],
  };
}

/** 4. 平票:首轮投票打平,进入复投(ballot=2)。 */
function tie(): PublicGameState {
  const v = vote();
  return {
    ...v,
    ballot: 2,
    votes: [
      { voterId: 'human', targetId: 'ai-3', reason: '措辞太笼统', round: 1, ballot: 1 },
      { voterId: 'ai-1', targetId: 'ai-3', reason: '像在描述别的词', round: 1, ballot: 1 },
      { voterId: 'ai-2', targetId: 'ai-1', reason: '过于官方', round: 1, ballot: 1 },
      { voterId: 'ai-3', targetId: 'ai-1', reason: '回避细节', round: 1, ballot: 1 },
      { voterId: 'ai-4', targetId: 'ai-3', reason: '气质不符', round: 1, ballot: 1 },
    ],
    events: [...v.events, ev('vote_result', '阿序与老墨平票,需重新投票。', 1)],
  };
}

/** 5. 出局:某席被票出,公布出局(尚未终局)。 */
function elimination(): PublicGameState {
  const v = vote();
  return {
    ...v,
    phase: 'describing',
    round: 2,
    players: v.players.map((p) => (p.id === 'ai-3' ? { ...p, alive: false } : p)),
    votes: [
      { voterId: 'human', targetId: 'ai-3', reason: '措辞太笼统', round: 1, ballot: 1 },
      { voterId: 'ai-1', targetId: 'ai-3', reason: '像在描述别的词', round: 1, ballot: 1 },
      { voterId: 'ai-2', targetId: 'ai-3', reason: '细节最空', round: 1, ballot: 1 },
      { voterId: 'ai-4', targetId: 'ai-3', reason: '气质不符', round: 1, ballot: 1 },
    ],
    eligibleTargetIds: null,
    events: [...v.events, ev('elimination', '老墨被票出,离开了牌桌。', 1, 'ai-3')],
  };
}

/** 6/7. 失败 / 重连:剧场镜头照旧,只在其上盖网络叠层(正交轴)。 */
function midStage(): PublicGameState {
  return speech();
}

/** 8. 终局:全员身份/密词揭晓,平民阵营胜出,附 AI 复盘。 */
function finale(): PublicGameState {
  const state = elimination();
  const reveal = (id: string, role: Role, word: string) =>
    seat(id, { alive: id !== 'ai-3', revealedRole: role, revealedWord: word });
  return {
    ...state,
    phase: 'finished',
    winner: 'civilian',
    players: [
      reveal('human', 'civilian', '火锅'),
      reveal('ai-1', 'civilian', '火锅'),
      reveal('ai-2', 'civilian', '火锅'),
      reveal('ai-3', 'undercover', '麻辣烫'),
      reveal('ai-4', 'civilian', '火锅'),
    ],
    review: {
      headline: '一次干净的收网',
      summary: '卧底老墨的「一锅百味」露出了破绽,牌桌在第一轮就锁定了偏差。',
      turningPoints: ['老墨的描述回避了「围坐分享」这一核心意象。', '全员在复投前形成共识。'],
      playerInsights: [
        { playerId: 'ai-1', insight: ' 最先点出笼统措辞的人。' },
        { playerId: 'ai-3', insight: ' 伪装稳,但细节密度终究不足。' },
      ],
    },
  };
}

/** 8b. 高光:终局 + 一束证据接地的高光卡(默认剧透安全,结构上无 role/word)。 */
const HIGHLIGHT_REEL: HighlightReel = {
  available: true,
  cards: [
    {
      id: 'decisive_vote-1',
      type: 'decisive_vote',
      round: 1,
      title: '一锤定音',
      caption: '四票集中,老墨被决定性票出。',
      citedEventIds: ['ev-1'],
      citedVotes: [{ voterId: 'human', targetId: 'ai-3', round: 1, ballot: 1 }],
      quotes: [{ playerId: 'ai-3', round: 1, text: '讲究一锅百味的仪式感。' }],
      measures: [{ label: '得票', value: 4 }],
    },
    {
      id: 'lone_correct_read-1',
      type: 'lone_correct_read',
      round: 1,
      title: '独醒者',
      caption: '阿序第一轮就锁定了正确目标。',
      citedEventIds: ['ev-1'],
      citedVotes: [{ voterId: 'ai-1', targetId: 'ai-3', round: 1, ballot: 1 }],
      quotes: [{ playerId: 'ai-1', round: 1, text: '一种需要围坐分享的热食。' }],
      measures: [],
    },
  ],
};

export const SCENES: readonly SceneFixture[] = [
  { id: 'role-reveal', title: '身份揭晓', note: '开局私密展示身份与密词', snapshot: roleReveal() },
  { id: 'speech', title: '证词', note: '轮流描述,聚光当前发言', snapshot: speech() },
  { id: 'vote', title: '投票', note: '描述结束,选出嫌疑', snapshot: vote() },
  { id: 'tie', title: '平票复投', note: '打平后进入第二轮票选', snapshot: tie() },
  { id: 'elimination', title: '出局', note: '某席被票出,渐显灰度', snapshot: elimination() },
  { id: 'failure', title: '供应商故障', note: '剧场照旧,盖失败叠层', snapshot: midStage(), overlay: 'failure' },
  { id: 'reconnect', title: '断线重连', note: '剧场照旧,盖重连叠层', snapshot: midStage(), overlay: 'reconnect' },
  { id: 'finale', title: '终局揭晓', note: '身份/密词/胜负/复盘', snapshot: finale() },
  { id: 'highlight', title: '高光时刻', note: '证据接地的高光卡', snapshot: finale(), highlights: HIGHLIGHT_REEL },
  { id: 'replay', title: '逐拍回放', note: '从开局逐拍重放到终局', snapshot: finale(), replay: true },
];

export function sceneById(id: string): SceneFixture | null {
  return SCENES.find((scene) => scene.id === id) ?? null;
}
