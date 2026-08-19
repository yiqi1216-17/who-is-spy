import type {
  FeedbackSubmission,
  GodGameState,
  HighlightReel,
  PublicGameState,
} from './types';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? '请求失败，请稍后重试');
  }
  return payload;
}

export const api = {
  health: () =>
    request<{ ok: boolean; model: string; configured: boolean }>('/api/health'),
  createGame: () =>
    request<PublicGameState>('/api/games', { method: 'POST' }),
  describe: (id: string, text: string) =>
    request<PublicGameState>(`/api/games/${id}/describe`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  vote: (id: string, targetId: string) =>
    request<PublicGameState>(`/api/games/${id}/vote`, {
      method: 'POST',
      body: JSON.stringify({ targetId }),
    }),
  continue: (id: string) =>
    request<PublicGameState>(`/api/games/${id}/continue`, { method: 'POST' }),
  // 只读公开事件流(SSE · 决策 3 · 任务 4.1):供 followGame 跟播;写路径仍走上面的命令端点。
  streamUrl: (id: string): string => `/api/games/${id}/stream`,
  // 高光时刻(任务 5.3/5.4):终局才 available;默认剧透安全,spoilers=true 才附身份/密词层。
  highlights: (id: string, spoilers = false) =>
    request<HighlightReel>(`/api/games/${id}/highlights${spoilers ? '?spoilers=1' : ''}`),
  // 上帝模式:一次性解算一桌全 AI 对局(耗时较长),回传含内心 OS 的上帝投影。
  createGodGame: () =>
    request<GodGameState>('/api/god-games', { method: 'POST' }),
  getGodGame: (id: string) =>
    request<GodGameState>(`/api/god-games/${id}`),
  // 知情反馈(任务 5.5):仅当用户点「提交」才调用——consent 恒 true。
  // 「不用了」在组件层直接 dismiss,压根不会走到这里(完整退出 = 零遥测)。
  submitFeedback: (submission: FeedbackSubmission) =>
    request<{ recorded: true }>('/api/feedback', {
      method: 'POST',
      body: JSON.stringify(submission),
    }),
};
