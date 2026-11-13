'use client';

import { useEffect, useRef, useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { manualRoot } from './manual';
import { Icon } from './Icon';
import { useToast } from './Toast';

type DemoMessage =
  | { id: string; role: 'user' | 'assistant'; text: string }
  | { id: string; role: 'tool'; name: string; command: string; result: string };

const initialMessages: DemoMessage[] = [
  { id: 'initial-user', role: 'user', text: '继续完善 Website 主页，优先检查移动端布局。' },
  { id: 'initial-assistant', role: 'assistant', text: '我会先完成首屏与功能分区，再检查小屏幕下的排版和交互。' },
  { id: 'initial-tool', role: 'tool', name: '运行页面检查', command: 'npm run check', result: '✓ 已通过' },
  { id: 'initial-progress', role: 'assistant', text: '首屏已完成。正在验证导航、会话演示和远程审批在移动端的显示效果。' },
];

const suggestions = ['检查一下移动端布局', '继续完成剩余检查'];

export function Hero() {
  const [messages, setMessages] = useState<DemoMessage[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('桌面在线 · 流式接收中');
  const timer = useRef<number | null>(null);
  const nextId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const notify = useToast();

  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, sending]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  function sendMessage() {
    if (sending) return;
    const text = draft.trim();
    if (!text) {
      inputRef.current?.focus();
      notify('先输入一条演示指令');
      return;
    }

    nextId.current += 1;
    const userId = `demo-user-${nextId.current}`;
    setMessages(current => [...current, { id: userId, role: 'user', text }]);
    setDraft('');
    setSending(true);
    setStatus('DSH 已接受 · 模拟执行中');
    timer.current = window.setTimeout(() => {
      nextId.current += 1;
      const answerId = `demo-answer-${nextId.current}`;
      setMessages(current => [...current, {
        id: answerId,
        role: 'assistant',
        text: '收到。我会继续检查移动端布局，并验证导航、会话和审批交互。此处展示的是模拟回复。',
      }]);
      setSending(false);
      setStatus('演示回复完成 · 模拟数据');
      timer.current = null;
      inputRef.current?.focus();
    }, 900);
  }

  function resetDemo() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setMessages(initialMessages);
    setDraft('');
    setSending(false);
    setStatus('桌面在线 · 流式接收中');
    notify('会话演示已重置');
  }

  return (
    <section className="hero" id="top">
      <div className="hero-grid" /><div className="hero-orb" />
      <div className="container hero-layout">
        <div className="hero-copy">
          <div className="eyebrow"><span className="pulse-dot" />为 DeepSeek Harness 打造</div>
          <h1>离开桌面，<br />继续把<span className="gradient-text">想法做成。</span></h1>
          <p className="hero-description">
            DSH Connect 将桌面 DSH 会话安全延伸到手机。查看实时进展、发送下一条指令、处理关键审批——
            <strong>不必远程控制整块屏幕，也能让任务继续向前。</strong>
          </p>
          <div className="hero-actions">
            <a className="btn btn-primary" href={manualRoot}>
              开始使用<Icon name="arrowUp" />
            </a>
            <a className="btn btn-ghost" href="#workflow">看看它如何工作<Icon name="arrow" /></a>
          </div>
          <div className="hero-assurance"><Icon name="lock" size={15} />桌面明确授权 · 手机分权访问 · Apache 2.0 开源</div>
        </div>
        <div className="hero-stage" aria-label="DSH Connect 移动端交互演示">
          <div className="stage-glow" /><div className="connection-ring" />
          <div className="float-card desktop-float">
            <div className="float-top">
              <span className="float-icon"><Icon name="monitor" size={17} /></span>
              <div><div className="float-title">MacBook Pro</div><div className="float-sub">Connector 已连接</div></div>
              <span className="online-dot" />
            </div>
            <div className="float-meta"><span>授权工作区 <strong>2 个</strong></span><span>桌面在线</span></div>
          </div>
          <div className="phone">
            <div className="phone-screen">
              <div className="phone-status"><span>9:41</span><span className="phone-notch" /><span className="phone-status-icons">5G <i /></span></div>
              <div className="phone-appbar">
                <BrandLogo className="phone-mini-logo" eager />
                <div><div className="phone-app-title">完善 Website 响应式布局</div><div className="phone-app-sub"><span className="online-dot" /><span>{status}</span></div></div>
                <Icon name="menu" className="phone-menu" />
              </div>
              <div className="phone-workspace"><Icon name="folder" size={13} /><strong>dsh-connect</strong><span>/ apps / website</span></div>
              <div className="phone-messages" ref={messagesRef} aria-live="polite">
                <div className="demo-day">今天 21:58 · 模拟会话</div>
                {messages.map(message => {
                  if (message.role === 'tool') {
                    return (
                      <div className="demo-tool" key={message.id}>
                        <div className="demo-tool-head"><Icon name="command" size={12} />{message.name}<span>{message.result}</span></div>
                        <div className="demo-code">{message.command}</div>
                      </div>
                    );
                  }
                  return (
                    <div className={`demo-message${message.role === 'user' ? ' user' : ''}`} key={message.id}>
                      <div className="demo-bubble">{message.text}</div>
                    </div>
                  );
                })}
                {sending ? (
                  <div className="demo-message"><div className="demo-bubble"><div className="demo-typing" aria-label="正在生成模拟回复"><i /><i /><i /></div></div></div>
                ) : null}
              </div>
              <div className="demo-prompts" aria-label="演示指令建议">
                {suggestions.map((suggestion, index) => (
                  <button key={suggestion} type="button" onClick={() => { setDraft(suggestion); inputRef.current?.focus(); }}>
                    {index === 0 ? '检查移动布局' : '继续完成检查'}
                  </button>
                ))}
              </div>
              <div className="phone-composer">
                <div className="demo-compose">
                  <input
                    ref={inputRef}
                    value={draft}
                    maxLength={100}
                    disabled={sending}
                    aria-label="输入模拟会话指令"
                    placeholder="发送下一条指令…"
                    onChange={event => setDraft(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        sendMessage();
                      }
                    }}
                  />
                  <button className="demo-send" type="button" aria-label="发送模拟指令" disabled={sending} onClick={sendMessage}>
                    <Icon name="send" size={13} />
                  </button>
                </div>
                <div className="demo-caption"><span>交互演示 · 不连接真实 DSH</span><button className="demo-reset" type="button" onClick={resetDemo}>重置演示</button></div>
              </div>
            </div>
          </div>
          <a className="float-card approval-float" href="#approval-demo">
            <div className="approval-float-head"><Icon name="shield" size={14} />远程审批<span>等待决定</span></div>
            <div className="approval-float-title">允许运行集成测试？</div>
            <div className="approval-float-command">pnpm test:integration</div>
            <div className="approval-float-action">核对并处理<Icon name="arrow" size={12} /></div>
          </a>
        </div>
      </div>
      <div className="container hero-bottom"><span>Mobile control, desktop power</span><span className="scroll-cue"><span className="scroll-line" />Scroll to explore</span></div>
    </section>
  );
}
