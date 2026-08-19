import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
const params = new URLSearchParams(window.location.search);

// 开发态场景驱动(OpenSpec 05-H · 任务 4.2/4.3):
// 仅当「开发构建 && ?scene=」同时成立才**动态**加载 harness;
// 生产构建里 import.meta.env.DEV 为 false,整个分支连同 ./scenes/* 被静态消除,
// 场景代码与 fixture 一个字节都不进产物(任务 4.3 的构建侧证明)。
if (import.meta.env.DEV && params.has('scene')) {
  void import('./scenes/harness').then(({ SceneHarness }) => {
    root.render(
      <StrictMode>
        <SceneHarness sceneId={params.get('scene') || 'role-reveal'} />
      </StrictMode>,
    );
  });
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
