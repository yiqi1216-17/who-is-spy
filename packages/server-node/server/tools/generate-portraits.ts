import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 离线角色立绘生成器(OpenSpec 05-H · 决策 4 / 任务 2.2)
 *
 * 用火山方舟 doubao-seedream 文生图为四位 AI + 人类席生成**统一画风**的原创立绘,
 * 落到 `packages/web/public/portraits/` 作为前端展示的**增强层**(原创 SVG 立绘为保底)。
 *
 * 纪律:
 *  - ARK_API_KEY **只在服务端 `.env`**,本工具从 `process.env` 读取,**绝不打印**、绝不下发浏览器。
 *  - 每张独立 try/catch:部分失败不影响其余,也不阻断构建(纯离线增强,非运行时依赖)。
 *  - 每次生成写入 `manifest.json`(prompt + 版权来源),供角色圣经引用。
 *
 * 运行:`cd packages/server-node && npx tsx server/tools/generate-portraits.ts`
 */

interface PortraitSpec {
  id: string;
  label: string;
  size: string;
  prompt: string;
}

// 统一美术方向:东方水墨 × 现代极简肖像,暖纸底、朱砂/靛青点缀、半身居中、无文字无水印。
// 每位角色的气质/配色由其**实测策略轴**(specificity/novelty/risk)派生,而非刻板标签。
const STYLE =
  'modern minimal ink-wash character portrait, warm cream paper texture, subtle risograph grain, ' +
  'flat shapes with fine confident linework, limited earthy palette, centered head-and-shoulders bust, ' +
  'soft studio spotlight, calm negative space background, tasteful editorial illustration, ' +
  'no text, no letters, no watermark, no logo, high-end poster art';

const SPECS: PortraitSpec[] = [
  {
    id: 'ai-1',
    label: '阿序 · 谨慎观察',
    size: '1024x1024',
    prompt:
      `A composed young East-Asian scholar, calm watchful eyes, subtle guarded half-turn posture, ` +
      `sage-green and slate robe, restrained and precise. Evokes cautious observation and low risk. ${STYLE}`,
  },
  {
    id: 'ai-2',
    label: '弥生 · 直觉敏锐',
    size: '1024x1024',
    prompt:
      `A perceptive youth with bright alert eyes and wind-swept hair, warm coral and amber tones, ` +
      `an intuitive spark, leaning slightly forward as if catching a hidden signal. ${STYLE}`,
  },
  {
    id: 'ai-3',
    label: '老墨 · 逻辑派',
    size: '1024x1024',
    prompt:
      `A steady analytical figure with thin round glasses and neat features, deep indigo and ink-blue, ` +
      `geometric and methodical, quietly confident logician. Evokes high specificity. ${STYLE}`,
  },
  {
    id: 'ai-4',
    label: '小满 · 出其不意',
    size: '1024x1024',
    prompt:
      `A playful trickster with an asymmetric sly half-smile and mischievous eyes, violet and magenta accents, ` +
      `unpredictable and inventive, one eyebrow raised. Evokes novelty and daring. ${STYLE}`,
  },
  {
    id: 'human',
    label: '你 · 第一人称',
    size: '1024x1024',
    prompt:
      `A quiet everyperson seen from behind and slightly to the side, faceless and universal, ` +
      `warm terracotta and rust tones, a single empty chair feeling, first-person protagonist. ${STYLE}`,
  },
  {
    id: 'stage',
    label: '圆桌剧场 · 背景',
    size: '1024x1536',
    prompt:
      `An empty theatrical round table under a single warm overhead spotlight, deep ink stage, ` +
      `five faint empty seats in a circle, dramatic chiaroscuro, warm dust motes, cinematic emptiness, ` +
      `vertical composition. ${STYLE}`,
  },
];

async function generateOne(baseUrl: string, apiKey: string, model: string, spec: PortraitSpec): Promise<
  { id: string; ok: true; bytes: number; prompt: string } | { id: string; ok: false; error: string }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        prompt: spec.prompt,
        size: spec.size,
        response_format: 'url',
        watermark: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text();
      // 只回传状态码 + 截断的服务端消息,绝不含我们的密钥。
      return { id: spec.id, ok: false, error: `HTTP ${response.status}: ${detail.slice(0, 200)}` };
    }
    const payload = (await response.json()) as {
      data?: Array<{ url?: string; b64_json?: string }>;
    };
    const item = payload.data?.[0];
    if (!item) return { id: spec.id, ok: false, error: '响应缺少 data[0]' };

    let bytes: Buffer;
    if (item.b64_json) {
      bytes = Buffer.from(item.b64_json, 'base64');
    } else if (item.url) {
      const image = await fetch(item.url, { signal: controller.signal });
      if (!image.ok) return { id: spec.id, ok: false, error: `下载图片失败 HTTP ${image.status}` };
      bytes = Buffer.from(await image.arrayBuffer());
    } else {
      return { id: spec.id, ok: false, error: '响应既无 url 也无 b64_json' };
    }

    const outputDirectory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../web/public/portraits',
    );
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(path.join(outputDirectory, `${spec.id}.png`), bytes);
    return { id: spec.id, ok: true, bytes: bytes.length, prompt: spec.prompt };
  } catch (error) {
    return { id: spec.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.ARK_API_KEY ?? '';
  const baseUrl = (process.env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
  const model = process.env.ARK_IMAGE_MODEL ?? 'doubao-seedream-5-0-pro-260628';
  if (!apiKey) {
    console.error('未配置 ARK_API_KEY(仅需服务端 .env);跳过立绘生成,前端将使用原创 SVG 保底。');
    process.exit(2);
  }
  console.log(`开始生成 ${SPECS.length} 张立绘,模型 ${model}(密钥已隐藏)…`);

  const results: Array<Awaited<ReturnType<typeof generateOne>>> = [];
  for (const spec of SPECS) {
    process.stdout.write(`  · ${spec.label} … `);
    const result = await generateOne(baseUrl, apiKey, model, spec);
    results.push(result);
    console.log(result.ok ? `OK(${(result.bytes / 1024).toFixed(0)} KB)` : `失败:${result.error}`);
  }

  const outputDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../web/public/portraits',
  );
  await mkdir(outputDirectory, { recursive: true });
  const manifest = {
    generatedWith: model,
    provider: 'Volcengine Ark (doubao-seedream)',
    rights: '本项目生成的原创美术资产,服务端离线生成,用于前端展示;不含第三方受版权游戏美术。',
    styleDirection: STYLE,
    portraits: results.map((result) =>
      result.ok
        ? { id: result.id, status: 'generated', file: `portraits/${result.id}.png`, prompt: result.prompt }
        : { id: result.id, status: 'failed', error: result.error },
    ),
  };
  await writeFile(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const ok = results.filter((result) => result.ok).length;
  console.log(`完成:${ok}/${results.length} 成功。manifest 已写入 web/public/portraits/manifest.json`);
  if (ok === 0) process.exit(1);
}

void main();
