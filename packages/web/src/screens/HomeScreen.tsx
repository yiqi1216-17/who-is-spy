import { ArrowRight, CircleAlert, Eye, Fingerprint, LoaderCircle, MessageCircleMore, Vote } from 'lucide-react';
import { CHARACTERS } from '../characters';
import { Portrait } from '../art/portraits';
import { Brand, InlineError } from '../components/ui';

/**
 * 首屏(OpenSpec 05-H · 任务 2.1/3.1)
 *
 * 立绘先声夺人:五张原创肖像浮于顶部,第一人称居中前置。
 * 一句留白式主张 + 抽身份 CTA + 三步玩法。竖屏优先、暖纸剧场底。
 */
export function HomeScreen({
  configured,
  model,
  busy,
  error,
  onStart,
}: {
  configured: boolean | null;
  model: string;
  busy: boolean;
  error: string;
  onStart: () => void;
}) {
  const status =
    configured === null ? '确认模型中…' : configured ? `${model} 已就席` : '待配置密钥';

  return (
    <div className="screen home">
      <div className="home-top">
        <Brand />
        <span className="chip">
          <span className={`status-dot ${configured ? 'online' : ''}`} />
          {status}
        </span>
      </div>

      <div className="home-portraits" aria-hidden="true">
        {CHARACTERS.map((character, index) => (
          <Portrait key={character.id} character={character} className={`pt pt-${index}`} emblem={index === 0} />
        ))}
      </div>

      <div className="home-hero">
        <div className="eyebrow">
          <span>01</span>
          五人入局 · 一词之差
        </div>
        <h1>
          别说出答案。
          <br />
          <em>也别暴露自己。</em>
        </h1>
        <p className="home-lede">
          你与四位独立思考的 AI 同桌落座。每个人只看得到自己的密词，
          真相就藏在那些看似普通的描述里。
        </p>

        <div className="home-actions">
          <button className="btn btn-rust btn-block" onClick={onStart} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={18} /> : <Fingerprint size={18} />}
            抽取身份，进入牌局
            <ArrowRight size={18} />
          </button>
          <span className="duration">一局约 5–8 分钟 · 竖屏沉浸</span>
        </div>

        {configured === false && (
          <div className="setup-warning">
            <CircleAlert size={16} />
            <span>
              未检测到 <code>DEEPSEEK_API_KEY</code>。可以先抽身份，但 AI 行动前需在
              <code>.env</code> 配置密钥。
            </span>
          </div>
        )}
        {error && <InlineError message={error} />}
      </div>

      <div className="how-row">
        <div className="how-card">
          <MessageCircleMore size={22} />
          <div>
            <b>01 / 描述</b>
            <strong>绕着密词说</strong>
            <p>太直白会帮到卧底，太含糊又会让自己成为目标。</p>
          </div>
        </div>
        <div className="how-card">
          <Vote size={22} />
          <div>
            <b>02 / 投票</b>
            <strong>读懂弦外之音</strong>
            <p>每位 AI 依据自己的词与公开发言，独立作出判断。</p>
          </div>
        </div>
        <div className="how-card">
          <Eye size={22} />
          <div>
            <b>03 / 复盘</b>
            <strong>真相全部翻开</strong>
            <p>终局揭晓身份与密词，AI 重走关键转折与票型。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
