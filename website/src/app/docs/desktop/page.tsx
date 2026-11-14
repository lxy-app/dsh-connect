import { chapterMetadata } from '@/components/manual';

export const metadata = chapterMetadata('desktop/');

export default function ChapterPage() {
  return (
    <article>
      <h1>安装 DSH 插件并连接桌面</h1>
      <p>在运行 DeepSeek Harness 的电脑上安装 Connector。插件包 <code>@lxyapp/dsh-connect@0.1.6</code> 已按 DSH <code>0.2.2-rc.3</code> 更新适配。开始配对前，向管理员索取 Server 地址和桌面配对码；自行搭建服务请先阅读<a href="../deploy/">Docker 部署手册</a>。</p>
      <p>插件版本必须与 DSH 版本对应：DSH 升级后请重新安装匹配的插件版本，否则插件会被 DSH 的兼容性检查禁用，侧边栏不会出现 Connector 面板。</p>
      <h2>从 npm 安装</h2>
      <ol>
        <li>在 DSH 桌面打开 Plugins（插件管理），进入安装已有插件的界面。</li>
        <li>在“包名或地址”中粘贴下面一行，核对包名和版本，确认安装。</li>
      </ol>
      <pre><code>@lxyapp/dsh-connect@0.1.6</code></pre>
      <p><a href="https://www.npmjs.com/package/@lxyapp/dsh-connect">查看 npm 包主页</a> · <a href="https://registry.npmjs.org/@lxyapp/dsh-connect/-/dsh-connect-0.1.6.tgz">下载 0.1.6 插件包（.tgz）</a></p>
      <p>回到已安装插件列表，启用 DSH Connect，确认插件状态为 active，并打开 DSH Connect 面板。若安装源找不到该版本，可将上面的 .tgz 下载链接粘贴到同一个“包名或地址”框，或下载后使用本地包安装。</p>
      <details>
        <summary>从仓库源码打包安装</summary>
        <p>使用 Node.js 24，从仓库根目录执行下列命令。将输出的 .tgz 文件作为本地 npm bundle 安装，随后在 Plugins 页启用。</p>
        <pre><code>{`cd connector/dsh-plugin
npm ci
npm pack`}</code></pre>
        <p>macOS Desktop 使用内置 CLI 安装本地包的命令见<a href="https://github.com/lxy-app/dsh-connect/blob/main/connector/dsh-plugin/README.md">Connector 说明</a>。</p>
      </details>
      <h2>配对桌面并开放工作区</h2>
      <ol>
        <li>管理员在“设备管理” → “桌面 Connector” → “添加桌面”生成一次性桌面配对码。桌面用户在面板填写 Server 地址、桌面名称和该码，选择“保存并配对”。</li>
        <li>在桌面核对设备指纹，勾选希望从手机使用的工作区和动作，选择“确认授权并上线”。回到后台设备列表确认这台桌面在线。</li>
        <li>日后要增加可申请的工作区，在“桌面授权范围”调整并保存。桌面应持续运行 DSH 并能主动连接 Server。</li>
      </ol>
      <h2>批准一部手机</h2>
      <p>先按<a href="../">快速上手</a>配对手机并提交访问申请。在桌面“手机访问授权”找到这部手机，核对工作区和具体动作，只批准需要的范围。仅查看进展时授予查看即可；发送、取消和审批分别选择。</p>
      <p>在手机下拉刷新，核对能打开的工作区。设备遗失时，管理员可在后台吊销该手机；只想停止访问某台桌面时，在桌面撤销该手机授权即可。DSH 本地会话会保留。</p>
    </article>
  );
}
