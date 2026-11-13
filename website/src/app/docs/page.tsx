import { chapterMetadata } from '@/components/manual';

export const metadata = chapterMetadata('');

export default function ChapterPage() {
  return (
    <article>
      <h1>快速上手</h1>
      <p>已有团队服务时，向管理员索取为你生成的手机配对码。自建服务请先完成<a href="deploy/">Docker 部署手册</a>；手机上尚无 App，请按<a href="mobile/">手机安装指南</a>选择平台。</p>
      <h2>先让桌面上线</h2>
      <p>管理员在后台“设备管理” → “桌面 Connector” → “添加桌面”生成桌面配对码。桌面用户打开 DSH Connect 面板，填写地址和桌面配对码，核对指纹，选择含有会话的工作区并确认上线。可跟随<a href="desktop/">DSH 插件安装与授权步骤</a>操作。</p>
      <h2>配对你的手机</h2>
      <ol>
        <li>管理员打开后台“设备管理” → “手机设备”，选择这部手机所属的用户，生成一次性二维码。</li>
        <li>手机打开“连接 Server” → “扫描配对二维码”。相机不可用时，手动输入同一页面显示的 Server 地址和手机配对码。</li>
        <li>配对成功后进入“设备”，找到在线桌面，点“申请访问”，选工作区、查看和发送权限，再点“提交访问申请”。</li>
        <li>桌面用户在 DSH Connect → “手机访问授权”中核对设备与申请范围并确认。手机下拉刷新，进入“工作区”或“会话”。</li>
      </ol>
      <h2>验证第一条回复</h2>
      <p>打开该工作区里已有的会话，先确认能读到历史，再发送“请简要总结当前进度”。保持桌面 DSH 在线，等待本轮回复结束。若输入框只读，请桌面用户核对发送权限。继续阅读<a href="sessions/">会话与审批操作</a>。</p>
    </article>
  );
}
