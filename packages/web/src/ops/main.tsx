import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OpsConsole } from './OpsConsole';
import './ops.css';

/**
 * 观测台入口(仅 `ops.html` 引用;该页不在 vite 构建入口,生产 bundle 结构上不含本目录)。
 * 再加一道 DEV 断言兜底:即使有人手动把本入口拉进构建,非 DEV 也只渲染拒绝页。
 */
const root = createRoot(document.getElementById('ops-root')!);

if (import.meta.env.DEV) {
  root.render(
    <StrictMode>
      <OpsConsole />
    </StrictMode>,
  );
} else {
  root.render(
    <p style={{ color: '#b8b0a2', fontFamily: 'sans-serif', padding: '2rem' }}>
      观测台仅在开发环境可用(生产构建不包含故障注入与 trace 视图)。
    </p>,
  );
}
