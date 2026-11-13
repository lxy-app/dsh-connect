import { chapterMetadata } from '@/components/manual';

export const metadata = chapterMetadata('mobile/');

export default function ChapterPage() {
  return (
    <article>
      <h1>编译与安装手机端</h1>
      <p>以下每组命令都从仓库根目录开始。使用 Node.js 24，先连接并解锁真机。iOS / Android 使用 Expo SDK 58 的 Development Build；鸿蒙使用单独的 SDK 55 + RNOH 0.84.1 工程。</p>
      <h2>iPhone</h2>
      <p>准备 macOS、Xcode 和 CocoaPods。在 Xcode 中配置开发团队，确认手机信任这台 Mac 并已开启开发者模式。</p>
      <pre><code>{`cd apps/mobile
npm ci
npm run ios -- --device`}</code></pre>
      <p>选择连接的 iPhone。命令会生成原生工程、编译并安装开发包，随后启动 Metro。若签名失败，检查 Xcode 中的开发团队和设备注册。</p>
      <h2>Android</h2>
      <p>安装 Android Studio、Android SDK 和平台工具。在手机开启开发者选项和 USB 调试，连接后允许这台电脑调试。</p>
      <pre><code>{`cd apps/mobile
npm ci
adb devices
npm run android -- --device`}</code></pre>
      <p>确认 adb devices 中设备状态为 device，再选择这台手机。构建命令将开发包安装到设备并启动 Metro；开发调试包使用调试签名。</p>
      <h2>HarmonyOS</h2>
      <p>准备 DevEco Studio 6.1+、HarmonyOS SDK、OHPM、Hvigor 和 hdc，手机开启开发者模式。用 DevEco 为目标设备生成调试签名，按<a href="https://github.com/lxy-app/dsh-connect/blob/main/apps/mobile-harmony/README.md">鸿蒙签名配置示例</a>把材料路径、别名和口令写入仓库外的本机 JSON5 文件。将下面的路径替换为实际文件。</p>
      <pre><code>{`cd apps/mobile-harmony
npm ci --legacy-peer-deps
npm run doctor
export EXPO_HARMONY_SIGNING_CONFIG_FILE=/absolute/path/to/signing.json5
npm run setup:native
npm run build:hap
hdc list targets
hdc install -r harmony/entry/build/default/outputs/default/entry-default-signed.hap
npm start`}</code></pre>
      <p>确认 hdc 列出目标设备，安装 signed.hap 后在手机桌面打开 App。只有 unsigned.hap 时，检查签名文件并重新生成原生工程和构建。</p>
      <h2>首次打开与后续开发</h2>
      <p>使用开发包时保持对应工程的 Metro 运行，手机和构建机处于互通的网络。再次开发时在同一目录运行 npm start；变更原生模块或权限后重新构建并安装。看到“连接 Server”后，按<a href="../">快速上手</a>扫描管理员提供的手机配对码。iOS / Android 也提供<a href="https://github.com/lxy-app/dsh-connect/blob/main/apps/mobile/README.md#eas-build可选">EAS 构建配置</a>。</p>
    </article>
  );
}
