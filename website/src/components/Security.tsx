import { Icon } from './Icon';

const securityItems = [
  { number: '01 / GRANT', icon: 'lock', title: '默认拒绝', copy: '查看、发送、取消、审批分别授权；手机配对本身不会获得桌面访问权限。' },
  { number: '02 / SOURCE', icon: 'file', title: '事实留在 DSH', copy: 'DSH Session Log 是会话事实源。Server 不直接读取 DSH 内部文件，也不替代桌面执行 Agent。' },
  { number: '03 / NETWORK', icon: 'link', title: '桌面主动出站', copy: 'Connector 主动连接 Server，无需把 DSH 桌面端口暴露到公网。' },
  { number: '04 / APPROVAL', icon: 'shield', title: '审批失败关闭', copy: '只允许明确的一次性决定。超时、离线或协议异常不会被伪造成批准。' },
] as const;

export function Security() {
  return (
    <section className="section security-section" id="security">
      <div className="container">
        <div className="security-head reveal">
          <div className="section-kicker">Secure by default</div>
          <h2 className="section-title">安全不是附加项，<br />而是每一次连接的默认值。</h2>
          <p className="section-copy">权限边界、会话事实源与审批语义从架构底层保持一致，让“远程可用”不以“放松控制”为代价。</p>
        </div>
        <div className="security-grid">
          {securityItems.map(item => (
            <article className="security-card reveal" key={item.number}>
              <span className="security-number">{item.number}</span>
              <div className="security-icon"><Icon name={item.icon} /></div>
              <h3>{item.title}</h3><p>{item.copy}</p>
            </article>
          ))}
        </div>
        <div className="security-architecture reveal">
          <div className="architecture-title"><strong>一条清晰的连接链路</strong><span>HTTPS / WSS · Protocol v1</span></div>
          <div className="architecture-flow">
            <div className="architecture-node"><Icon name="phone" /><strong>Mobile App</strong><small>授权范围内的操作</small></div>
            <div className="architecture-link"><div className="architecture-link-line" />HTTPS / WSS</div>
            <div className="architecture-node"><Icon name="layers" /><strong>Go Server</strong><small>认证 · 授权 · 中继</small></div>
            <div className="architecture-link"><div className="architecture-link-line" />Outbound WSS</div>
            <div className="architecture-node"><Icon name="monitor" /><strong>DSH Desktop</strong><small>Connector + Host API</small></div>
          </div>
        </div>
      </div>
    </section>
  );
}
