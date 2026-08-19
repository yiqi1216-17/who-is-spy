import { CircleAlert } from 'lucide-react';

/** 品牌印记(暖纸/深墨两版由父级配色决定)。 */
export function Brand({ suffix }: { suffix?: string }) {
  return (
    <div className="brand">
      <span className="brand-seal">潜</span>
      <span>潜词局{suffix ? ` · ${suffix}` : ''}</span>
    </div>
  );
}

/** 内联错误条(规则/校验类错误;网络类由 net-overlay 承载)。 */
export function InlineError({ message }: { message: string }) {
  return (
    <div className="inline-error" role="alert">
      <CircleAlert size={16} />
      <span>{message}</span>
    </div>
  );
}
