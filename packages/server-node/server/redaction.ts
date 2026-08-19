import { WORD_PAIRS } from './words.js';

/**
 * 机密哨兵词表 —— 跨边界工件里绝不该出现的字面量(OpenSpec 04 · §2.3 / §3.1)
 *
 * = 全部候选**密词** + 各家 API 凭据前缀。评测报告(`eval/report.ts`)与可观测
 * trace(`obs/tracer.ts`)、数据记录共用**同一把尺**,单一事实源在此,避免各处漏配。
 *
 * 注意**不**含 'undercover'/'civilian'/'role'/'word' 等角色词——它们是公开词汇,
 * 合法出现在指标 key(如 `undercover_win_rate`)与 schema 里;真正的机密只有
 * 密词字面量与凭据本身。
 */
export const SECRET_SENTINELS: readonly string[] = [
  ...new Set(WORD_PAIRS.flat()),
  'DEEPSEEK_API_KEY',
  'sk-',
  'ARK_API_KEY',
  'ark-', // Volcengine 文生图凭据前缀
];

/** 序列化工件里命中的机密字面量列表(空数组 = 干净)。 */
export function scanSecrets(serialized: string): string[] {
  return SECRET_SENTINELS.filter((sentinel) => serialized.includes(sentinel));
}

/**
 * 被拒私有候选的**不可逆指纹**(OpenSpec 04 · design.md §5 / §3.3)
 *
 * FNV-1a 32-bit → 8 位十六进制短哈希 + 字符(码点)长度。用途只有两个:向复盘证明
 * 「同一边界的重试确实产生了**不同**候选」「长度是否异常(过短/暴涨)」——而**绝不保留原文**。
 * 哈希单向不可逆,长度是单个整数、信息量远不足以重建文本,故即便候选里含密词,
 * 指纹(8-hex + 数字)里也不会出现任何密词字面量,可安全落入 trace / 复盘工件。
 */
export function safeDigest(text: string): { hash: string; length: number } {
  let h = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0; // 乘 FNV prime,保持 32 位无符号
  }
  return { hash: h.toString(16).padStart(8, '0'), length: [...text].length };
}
