'use client';

import { useState } from 'react';
import { Icon } from './Icon';
import { useToast } from './Toast';

const scopeNames = ['查看会话', '发送指令', '取消执行', '远程审批'] as const;
type ScopeName = typeof scopeNames[number];
type ApprovalState = 'pending' | 'allowed' | 'rejected';

export function FactStrip() {
  return (
    <section className="fact-strip" aria-label="产品核心事实">
      <div className="container fact-grid">
        <div className="fact-item"><Icon name="zap" size={19} /><span><strong>实时流式</strong>回复</span></div>
        <div className="fact-item"><Icon name="folder" size={19} /><span><strong>工作区级</strong>授权</span></div>
        <div className="fact-item"><Icon name="shield" size={19} /><span><strong>一次性</strong>远程审批</span></div>
        <div className="fact-item"><Icon name="layers" size={19} /><span><strong>自托管</strong>部署</span></div>
      </div>
    </section>
  );
}

export function Features() {
  const [approval, setApproval] = useState<ApprovalState>('pending');
  const [scopes, setScopes] = useState<Record<ScopeName, boolean>>({
    查看会话: true,
    发送指令: true,
    取消执行: true,
    远程审批: true,
  });
  const notify = useToast();
  const scopeCount = Object.values(scopes).filter(Boolean).length;

  function decideApproval(decision: Exclude<ApprovalState, 'pending'>) {
    setApproval(decision);
    notify(decision === 'allowed' ? '已模拟允许一次，没有执行真实命令' : '已模拟拒绝，没有执行真实命令');
  }

  return (
    <section className="section features-section" id="features">
      <div className="container">
        <div className="section-head reveal">
          <div><div className="section-kicker">Made for momentum</div><h2 className="section-title">不只查看进度，<br />更能推进任务。</h2></div>
          <p className="section-copy">聚焦离开电脑后真正需要的操作。不是把桌面 IDE 塞进手机，而是把每一次关键决定放在你手边。</p>
        </div>
        <div className="bento-grid">
          <article className="bento-card span-7 stream-card reveal">
            <div>
              <div className="card-icon"><Icon name="zap" /></div>
              <h3 className="card-title">进展实时抵达，<br />上下文始终连续。</h3>
              <p className="card-copy">查看历史消息与工具执行摘要，接收 Assistant 流式回复。回到会话时，沿着原来的思路继续。</p>
            </div>
            <div className="stream-window" aria-label="流式会话界面示意">
              <div className="mini-window-head"><i className="window-dot" /><i className="window-dot" /><i className="window-dot" /><span>修复断线恢复 · dsh-connect</span></div>
              <div className="stream-block">
                <div className="stream-label"><Icon name="chat" size={12} />DSH Assistant</div>
                <div className="stream-text">已定位到事件游标的恢复问题，正在补充重复事件与分页修复的测试。</div>
                <div className="stream-code"><span className="code-accent">const</span> cursor = snapshot.lastSeq;<br /><span className="code-accent">await</span> follow({'{ cursor }'});<br /><span className="code-green">// 按序恢复，不重复提交</span></div>
                <div className="stream-state">正在流式接收</div>
              </div>
            </div>
          </article>

          <article className="bento-card span-5 approval-demo reveal" id="approval-demo">
            <div>
              <div className="card-icon mint"><Icon name="shield" /></div>
              <h3 className="card-title">关键操作，<br />仍由你最后决定。</h3>
              <p className="card-copy">远程审批保持一次性、失败关闭。先看清命令、工作区与风险，再允许一次或明确拒绝。</p>
            </div>
            <div className="approval-demo-box" id="approvalDemoBox" data-state={approval}>
              <div className="approval-demo-meta"><span className="risk-dot" />工具审批 · 高风险<span>04:38</span></div>
              <div className="approval-command">pnpm test:integration</div>
              <div className="approval-scope">MacBook Pro · dsh-connect<br />批准仅对本次请求有效</div>
              {approval === 'pending' ? (
                <div className="approval-actions">
                  <button className="btn btn-reject" type="button" onClick={() => decideApproval('rejected')}>拒绝</button>
                  <button className="btn btn-allow" type="button" onClick={() => decideApproval('allowed')}>允许一次</button>
                </div>
              ) : (
                <div className={`approval-result ${approval}`} style={{ display: 'flex' }}>
                  <span className="result-icon"><Icon name={approval === 'allowed' ? 'check' : 'x'} size={14} /></span>
                  <span>{approval === 'allowed' ? '已允许一次' : '已拒绝本次请求'}<br /><small>模拟结果，不执行真实命令</small></span>
                  <button type="button" onClick={() => { setApproval('pending'); notify('审批演示已重置'); }}>重置</button>
                </div>
              )}
            </div>
          </article>

          <article className="bento-card span-5 reveal">
            <div className="card-icon"><Icon name="sliders" /></div>
            <h3 className="card-title">只开放需要的，<br />其余保持默认拒绝。</h3>
            <p className="card-copy">手机配对不等于桌面授权。每个工作区、每种动作，都需要桌面 Connector 明确确认。</p>
            <div className="scope-demo">
              <div className="workspace-row"><Icon name="folder" size={16} /><span className="workspace-name">dsh-connect</span><span>已授权工作区</span></div>
              <div className="scope-list" aria-label="切换模拟授权范围">
                {scopeNames.map(scope => (
                  <button
                    className="scope-button"
                    type="button"
                    key={scope}
                    aria-pressed={scopes[scope]}
                    onClick={() => setScopes(current => ({ ...current, [scope]: !current[scope] }))}
                  >
                    {scope}
                  </button>
                ))}
              </div>
              <div className="scope-summary"><span>点击体验分权控制</span><strong>{scopeCount ? `${scopeCount} 项动作已授权` : '未授权任何动作'}</strong></div>
            </div>
          </article>

          <article className="bento-card span-7 admin-card reveal">
            <div>
              <div className="card-icon"><Icon name="monitor" /></div>
              <h3 className="card-title">个人使用简单，<br />团队治理清晰。</h3>
              <p className="card-copy">通过 Web 管理后台治理用户、设备、工作区权限与敏感操作审计。会话正文不默认变成管理员的全局视图。</p>
            </div>
            <div className="admin-browser" aria-label="Web 管理后台示意，数据为模拟值">
              <div className="admin-bar"><i className="window-dot" /><i className="window-dot" /><i className="window-dot" /><span className="admin-address">DSH Connect · Admin</span></div>
              <div className="admin-body">
                <div className="admin-side"><div className="admin-side-logo" /><div className="admin-side-line active" /><div className="admin-side-line" /><div className="admin-side-line" /><div className="admin-side-line" /></div>
                <div className="admin-main">
                  <div className="admin-heading">运行概览<span>演示数据</span></div>
                  <div className="admin-metrics">
                    <div className="admin-metric"><div className="admin-metric-label">在线桌面</div><div className="admin-metric-value">2 <small>/ 3</small></div></div>
                    <div className="admin-metric"><div className="admin-metric-label">活跃会话</div><div className="admin-metric-value">4</div></div>
                    <div className="admin-metric"><div className="admin-metric-label">待审批</div><div className="admin-metric-value">1</div></div>
                  </div>
                  <div className="admin-chart" aria-hidden="true">{[24, 40, 35, 62, 48, 78, 58, 88, 67, 96, 74, 86].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
                  <div className="admin-audit"><div className="admin-audit-row"><span className="online-dot" />工作区授权已更新<span>刚刚</span></div><div className="admin-audit-row"><span className="online-dot" />远程指令已被 DSH 接受<span>2m</span></div></div>
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
