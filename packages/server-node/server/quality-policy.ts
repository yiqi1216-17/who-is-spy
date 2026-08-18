/**
 * 共享描述质量策略(OpenSpec 03 · Task 5.5,反转 CH-3)
 *
 * 纯函数、确定性、模型无关:给定一条候选描述 + 秘密词 + 本轮已公开的他人描述 +
 * 该 Agent 既往轮次的自述,判定它是否合规。引擎据此在生成边界做"有界重试→穷尽即
 * 原子终止"(见 game-engine),从而拦下基线 CH-3 的两类病:
 *   - 泄题:直接说出密词(exact),或用分隔符/标点伪装后仍含密词(obfuscated)。
 *   - 同质:与本轮先发描述过于雷同(too_similar),或与自己上几轮几乎重复(duplicate_self)。
 *
 * 策略不接触模型、不产生副作用、不看任何私有身份——只对文本与公开上下文做判定,
 * 因此可被评测复用、可确定性回放,也不会把私有信息带出边界。
 */

/** 判定结果码;`ok` 表示放行,其余为拦截原因,可写入 trace 的 policyCode(脱敏)。 */
export type QualityCode =
  | 'ok'
  | 'too_short'
  | 'exact_leak'
  | 'obfuscated_leak'
  | 'too_similar'
  | 'duplicate_self';

export interface QualityInput {
  /** 候选描述原文。 */
  text: string;
  /** 该 Agent 自己的秘密词(仅用于本地泄题判定,不外泄)。 */
  secretWord: string;
  /** 本轮已公开的其他玩家描述(同质判定)。 */
  priorPublicTexts?: readonly string[];
  /** 该 Agent 在更早轮次的自述(自我重复判定)。 */
  ownPriorTexts?: readonly string[];
}

export interface QualityVerdict {
  ok: boolean;
  code: QualityCode;
  /** 命中相似判定时,与之最相近的既有描述(便于重试提示与复盘),不含私有信息。 */
  matched?: string;
}

/** 同轮同质阈值:字符二元组 Jaccard ≥ 此值即判雷同。低于四个假名换字(≈0.63)以上留足余量。 */
export const SIMILARITY_THRESHOLD = 0.72;
/** 自我重复阈值:与自己既往描述近乎重复才拦,阈值更严。 */
export const SELF_REPEAT_THRESHOLD = 0.8;
/** 归一化后最短可接受长度(字符)。 */
export const MIN_DESCRIPTION_CHARS = 2;

/**
 * 判定一条候选描述是否合规。纯函数:同一输入恒得同一结果。
 * 判定顺序:长度 → 直接泄题 → 伪装泄题 → 自我重复 → 同轮同质。
 */
export function evaluateDescription(input: QualityInput): QualityVerdict {
  const text = normalizeText(input.text);
  if (text.length < MIN_DESCRIPTION_CHARS) {
    return { ok: false, code: 'too_short' };
  }

  const secret = compact(input.secretWord);
  if (secret.length > 0) {
    if (compact(text).includes(secret) && text.includes(input.secretWord.trim())) {
      return { ok: false, code: 'exact_leak' };
    }
    // 去掉空格/标点/间隔符后仍能拼出密词 → 伪装泄题。
    if (compact(text).includes(secret)) {
      return { ok: false, code: 'obfuscated_leak' };
    }
  }

  for (const prior of input.ownPriorTexts ?? []) {
    if (similarity(text, normalizeText(prior)) >= SELF_REPEAT_THRESHOLD) {
      return { ok: false, code: 'duplicate_self', matched: prior };
    }
  }

  for (const other of input.priorPublicTexts ?? []) {
    if (similarity(text, normalizeText(other)) >= SIMILARITY_THRESHOLD) {
      return { ok: false, code: 'too_similar', matched: other };
    }
  }

  return { ok: true, code: 'ok' };
}

/** 折叠空白;两端裁剪。 */
function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** 只保留 CJK 与字母数字,用于泄题的"伪装无关"比较。 */
function compact(text: string): string {
  return text.replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '');
}

/**
 * 字符二元组(bigram)Jaccard 相似度,确定性、语言无关。
 * 归一化后先剥非实义字符;短于两字时退化为完全相等判定。
 */
export function similarity(a: string, b: string): number {
  const ca = compact(a);
  const cb = compact(b);
  if (ca.length === 0 || cb.length === 0) return ca === cb ? 1 : 0;
  if (ca.length < 2 || cb.length < 2) return ca === cb ? 1 : 0;
  const sa = bigrams(ca);
  const sb = bigrams(cb);
  let intersection = 0;
  for (const gram of sa) if (sb.has(gram)) intersection += 1;
  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function bigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i < text.length - 1; i += 1) grams.add(text.slice(i, i + 2));
  return grams;
}
