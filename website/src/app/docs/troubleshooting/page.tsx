import { chapterMetadata } from '@/components/manual';

export const metadata = chapterMetadata('troubleshooting/');

export default function ChapterPage() {
  return (
    <article>
      <h1>常见问题与恢复</h1>
      <h2>扫码后连不上 Server</h2>
      <p>先用手机浏览器打开配对页显示的 Server 地址。127.0.0.1 在手机上指向手机自身。管理员应把 DSH_CONNECT_SERVER_URL 改为手机可达的地址，重新加载配置并生成新码。若浏览器也打不开，检查网络、反向代理和证书；若可打开，再核对使用的是手机配对码且未消费、未过期。</p>
      <h2>已配对却看不到工作区</h2>
      <p>在后台检查桌面是否在线 → 在桌面“桌面授权范围”检查工作区是否开放 → 在手机“设备”提交访问申请 → 在桌面“手机访问授权”确认这部手机 → 手机下拉刷新。已看到工作区但没有会话时，在 DSH 核对会话所属的工作区。</p>
      <h2>能阅读但不能发送或审批</h2>
      <p>在手机设备页和桌面面板检查获准的动作。若要给已生效授权补授远程审批，先确认可以中断当前访问，再撤销并重新申请需要的范围，让桌面重新确认。撤销会使待处理审批失效。</p>
      <h2>桌面离线或回复中断</h2>
      <p>确认桌面没有休眠、DSH 正在运行、插件 active，再在 DSH Connect 面板检查连接。若浏览器可打开后台而 Connector 无法保持在线，检查代理的 WebSocket 转发。恢复后重新打开会话读取历史，再判断是否需要继续操作。</p>
      <h2>审批卡消失或已失效</h2>
      <p>先核对桌面是否已接管、请求是否过期或被撤回，再查看该会话最新事件。若仍需执行，由桌面根据当前任务发起新的请求。</p>
      <h2>开发包打不开或找不到 Metro</h2>
      <p>iPhone 检查开发团队、设备信任和开发者模式；Android 用 adb devices 确认已授权；鸿蒙用 hdc list targets 核对设备，并确认安装的是为该设备签名的 HAP。已安装但无法加载代码时，在对应 App 目录运行 npm start，确认手机可访问构建机的 Metro 地址。加载到“连接 Server”之后，才检查业务服务地址。</p>
    </article>
  );
}
