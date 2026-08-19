/**
 * 故障分类学(OpenSpec 04 · Task 4.1)
 *
 * **一套**确定性、模型无关的分类器,替代散落各处的嵌套 try/catch。把任意抛出的错误
 * 归入 9 个互斥类,并给出「是否可重试 / trace 记什么 outcome / 建议退避」的裁决。
 *
 * 设计要点:
 *  - **纯函数**:同一个 error 恒得同一分类,便于单测与确定性回放。
 *  - **不 import game-engine / quality-policy 运行时**(避免环依赖):规则错误按 `name`/`code`
 *    结构识别,质量码按值识别——两处若改名,`taxonomy.test.ts` 会立刻失败提醒。
 *  - **沿 `cause` 链下探**:真实 `DeepSeekClient` 把上游错误包进 `ModelError(msg, cause)`,
 *    HTTP 状态码藏在 `cause.message`(如「DeepSeek 503: ...」),需逐层解包再判定。
 */

/** 9 个互斥故障类。顺序无关,判定时按「先内容后基础设施」的优先级匹配。 */
export type FailureClass =
  | 'timeout' // 请求中止 / 超时(可重试)
  | 'rate_limit' // 429 限流(可重试,尊重 Retry-After)
  | 'upstream' // 5xx 上游故障(可重试)
  | 'malformed_json' // 响应非法 JSON / 空内容(可重试)
  | 'schema' // 结构校验失败(可重试 —— 触发决策纠正)
  | 'illegal_target' // 投票目标越界(可重试 —— 触发纠正)
  | 'policy' // 质量策略拦截(**不可重试**:引擎内已有界纠正后原子终止)
  | 'auth_config' // 鉴权 / 配置缺失(**不可重试**:等待无益,须人工修配置)
  | 'unknown'; // 兜底(可重试,但退避层会低配额封顶)

export interface Classification {
  failureClass: FailureClass;
  /** 是否值得重试。auth_config / policy 恒 false(等待/重发都无益)。 */
  retryable: boolean;
  /** trace 的 outcome:内容被拒 = 'rejected';基础设施故障 = 'error'。 */
  outcome: 'rejected' | 'error';
  /** 上游给出的建议退避(毫秒),仅 rate_limit/upstream 可能带。 */
  retryAfterMs?: number;
  /** 写入 trace.policyCode 的短码(policy 类给具体质量码,其余给 failureClass)。 */
  policyCode: string;
}

/** quality-policy.ts 的 `QualityCode`(去掉放行的 'ok')的运行时镜像。 */
const QUALITY_CODES: ReadonlySet<string> = new Set([
  'too_short',
  'exact_leak',
  'obfuscated_leak',
  'too_similar',
  'duplicate_self',
]);

interface Node {
  name: string;
  message: string;
  status?: number;
  code?: string;
  retryAfterMs?: number;
}

/** 沿 `cause` 链把每层错误摊平成可检视的节点(最多 6 层,防环)。 */
function walk(error: unknown): Node[] {
  const nodes: Node[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    if (typeof current === 'object') {
      const record = current as Record<string, unknown>;
      nodes.push({
        name: typeof record.name === 'string' ? record.name : '',
        message: typeof record.message === 'string' ? record.message : '',
        status: numeric(record.status) ?? numeric(record.statusCode),
        code: typeof record.code === 'string' ? record.code : undefined,
        retryAfterMs: numeric(record.retryAfterMs),
      });
      current = record.cause;
    } else {
      nodes.push({ name: '', message: String(current) });
      break;
    }
  }
  return nodes;
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 从节点链里提取 HTTP 状态码:先看数值属性,再从 message 里正则「DeepSeek 503」这类。 */
function extractStatus(nodes: Node[]): number | undefined {
  for (const node of nodes) {
    if (node.status !== undefined) return node.status;
    const match = node.message.match(/\b(4\d\d|5\d\d)\b/);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function extractRetryAfterMs(nodes: Node[]): number | undefined {
  for (const node of nodes) {
    if (node.retryAfterMs !== undefined) return node.retryAfterMs;
    const sec = node.message.match(/retry-?after[:\s]+(\d+)/i);
    if (sec) return Number(sec[1]) * 1000;
  }
  return undefined;
}

function anyMessage(nodes: Node[], needles: string[]): boolean {
  const haystack = nodes.map((n) => `${n.name} ${n.message}`).join(' ').toLowerCase();
  return needles.some((needle) => haystack.includes(needle.toLowerCase()));
}

function anyName(nodes: Node[], names: string[]): boolean {
  return nodes.some((n) => names.includes(n.name));
}

/**
 * 把任意错误归入 9 类之一。判定优先级:**内容语义**(policy / illegal_target / schema)
 * 先于**基础设施**(auth / rate / upstream / timeout),因为内容错误常被外层再包一层
 * 通用 `ModelError`,若先看 message 兜底会误判。
 */
export function classifyFailure(error: unknown): Classification {
  const nodes = walk(error);
  const status = extractStatus(nodes);

  // —— 内容语义(不可重试的 policy 优先,其次可纠正的 illegal/schema)——
  if (
    anyName(nodes, ['QualityExhaustedError']) ||
    nodes.some((n) => n.code !== undefined && QUALITY_CODES.has(n.code)) ||
    anyMessage(nodes, ['秘密词', '包含自己的词', '合规描述'])
  ) {
    const code = nodes.find((n) => n.code && QUALITY_CODES.has(n.code))?.code;
    return { failureClass: 'policy', retryable: false, outcome: 'rejected', policyCode: code ?? 'policy' };
  }
  if (anyMessage(nodes, ['无效投票目标', 'illegal target', 'allowedtargets', '越界'])) {
    return { failureClass: 'illegal_target', retryable: true, outcome: 'rejected', policyCode: 'illegal_target' };
  }
  if (anyName(nodes, ['ZodError']) ||
      anyMessage(nodes, ['invalid_type', 'expected string', 'expected number', 'invalid input', '校验'])) {
    return { failureClass: 'schema', retryable: true, outcome: 'rejected', policyCode: 'schema' };
  }

  // —— 鉴权 / 配置:等待无益,快速失败 ——
  if (status === 401 || status === 403 ||
      anyMessage(nodes, ['未配置', 'deepseek_api_key', 'ark_api_key', 'unauthorized', 'forbidden', 'api key', 'invalid api', 'configuration'])) {
    return { failureClass: 'auth_config', retryable: false, outcome: 'error', policyCode: 'auth_config' };
  }

  // —— 基础设施:按状态码优先,其次 message 启发 ——
  if (status === 429 || anyMessage(nodes, ['rate limit', 'too many requests', '限流'])) {
    return {
      failureClass: 'rate_limit',
      retryable: true,
      outcome: 'error',
      retryAfterMs: extractRetryAfterMs(nodes),
      policyCode: 'rate_limit',
    };
  }
  if ((status !== undefined && status >= 500) ||
      anyMessage(nodes, ['upstream', 'bad gateway', 'service unavailable', '服务暂时不可用', '服务不可用'])) {
    return {
      failureClass: 'upstream',
      retryable: true,
      outcome: 'error',
      retryAfterMs: extractRetryAfterMs(nodes),
      policyCode: 'upstream',
    };
  }
  if (anyName(nodes, ['SyntaxError']) ||
      anyMessage(nodes, ['unexpected token', 'unexpected end of json', 'in json', '空内容', 'not valid json'])) {
    return { failureClass: 'malformed_json', retryable: true, outcome: 'error', policyCode: 'malformed_json' };
  }
  if (anyName(nodes, ['AbortError', 'TimeoutError']) ||
      anyMessage(nodes, ['aborted', 'timed out', 'timeout', 'etimedout'])) {
    return { failureClass: 'timeout', retryable: true, outcome: 'error', policyCode: 'timeout' };
  }

  return { failureClass: 'unknown', retryable: true, outcome: 'error', policyCode: 'unknown' };
}
