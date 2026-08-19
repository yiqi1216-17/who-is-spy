import { defineConfig } from 'vitest/config';

// 前端可测逻辑一律为**纯函数、无 DOM**(表现层状态机、SSE 去重、高光选择器)。
// 故用 node 环境即可,不依赖 jsdom/happy-dom(离线环境未安装);React 组件仅由 tsc 把关。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
