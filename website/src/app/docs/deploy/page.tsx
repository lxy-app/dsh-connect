import { chapterMetadata } from '@/components/manual';

export const metadata = chapterMetadata('deploy/');

export default function ChapterPage() {
  return (
    <article>
      <h1>使用 Docker 部署 DSH Connect</h1>
      <p>两种方式均使用 Docker Compose 运行 Server 和管理后台。使用发布版本请选<a href="#docker-hub">从 Docker Hub 拉取镜像</a>；要运行指定提交或本地修改，请选<a href="#build">从源码构建镜像</a>。</p>
      <h2 id="docker-hub">方式一 · 从 Docker Hub 拉取镜像部署</h2>
      <p>准备 Docker Engine、Compose 和 curl。在新目录下载部署文件：</p>
      <pre><code>{`mkdir dsh-connect-deploy
cd dsh-connect-deploy
curl -fLO https://raw.githubusercontent.com/lxy-app/dsh-connect/main/docker-compose.server.yml
curl -fL https://raw.githubusercontent.com/lxy-app/dsh-connect/main/.env.example -o .env`}</code></pre>
      <p>按下方<a href="#configuration">公共配置</a>填写 .env，然后执行以下命令。Compose 从 <a href="https://hub.docker.com/r/lxyapp/dsh-connect">Docker Hub 镜像仓库</a>拉取 <code>lxyapp/dsh-connect:latest</code> 并启动容器。</p>
      <pre><code>{`docker compose -f docker-compose.server.yml pull server
docker compose -f docker-compose.server.yml up -d --pull never`}</code></pre>
      <p>启动后前往<a href="#verify">部署验证</a>。</p>
      <h2 id="build">方式二 · 从源码构建镜像部署</h2>
      <p>准备 Git、Docker Engine、Buildx 和 Compose。在部署主机取得源码；已有仓库时，可直接进入要部署的版本所在目录。首次部署时创建 .env，已有配置可继续使用。</p>
      <pre><code>{`git clone https://github.com/lxy-app/dsh-connect.git
cd dsh-connect
cp .env.example .env`}</code></pre>
      <p>按下方<a href="#configuration">公共配置</a>填写 .env，然后在仓库根目录构建。使用 Compose 文件指定的镜像名；<code>--load</code> 将产物载入本机 Docker，<code>--pull never</code> 让 Compose 使用刚构建的镜像。</p>
      <pre><code>{`docker buildx build --load -t lxyapp/dsh-connect:latest .
docker compose -f docker-compose.server.yml up -d --pull never`}</code></pre>
      <p>启动后前往<a href="#verify">部署验证</a>。</p>
      <h2 id="configuration">公共配置 · 数据库、Owner 和外部地址</h2>
      <p>单台主机首次试用可选 SQLite。把 .env 中对应的五项改成下面的配置，替换令牌、账号、密码和域名。Compose 已为 SQLite 和附件创建独立持久卷。</p>
      <pre><code>{`DSH_CONNECT_DATABASE_URL=sqlite:///data/sqlite/dsh-connect.db
DSH_CONNECT_BOOTSTRAP_TOKEN=替换为随机长令牌
DSH_CONNECT_BOOTSTRAP_OWNER_EMAIL=owner@example.com
DSH_CONNECT_BOOTSTRAP_OWNER_PASSWORD=替换为自己的强密码
DSH_CONNECT_SERVER_URL=https://connect.example.com`}</code></pre>
      <p>默认使用 PostgreSQL 18。先准备数据库、账号及密码，将 DSH_CONNECT_DATABASE_URL 设为容器能访问的数据库地址，例如 <code>postgres://USER:PASSWORD@db.example.com:5432/dsh_connect?sslmode=verify-full</code>，替换账号、库名和主机，并按数据库证书配置信任。数据库运行在宿主机时，可用 host.docker.internal，确认监听地址和访问规则允许容器连接。</p>
      <p>SQLite 只运行一个 Server 实例。升级或重建容器时保留数据库和附件数据卷。</p>
      <ul>
        <li>设置 DSH_CONNECT_BOOTSTRAP_TOKEN 为随机长令牌，可用 openssl rand -hex 32 生成。仅服务管理员保管。</li>
        <li>填写 DSH_CONNECT_BOOTSTRAP_OWNER_EMAIL 与 DSH_CONNECT_BOOTSTRAP_OWNER_PASSWORD（至少 8 位）。空用户表首次启动时创建 Owner，后续修改这些变量不会重置已有账号。</li>
        <li>把 DSH_CONNECT_SERVER_URL 设为手机和桌面都能访问的 HTTPS 地址，如 https://connect.example.com。管理后台独立域名部署时，用 DSH_CONNECT_ADMIN_ORIGIN 指定其完整来源（协议、域名及非默认端口）。</li>
      </ul>
      <h2 id="verify">部署验证</h2>
      <pre><code>{`docker compose -f docker-compose.server.yml ps
docker compose -f docker-compose.server.yml logs --tail=50 server`}</code></pre>
      <p>服务默认发布在宿主机 8787 端口。为对外域名配置有效 TLS 证书，将 HTTPS 请求反向代理到服务端口，并为 WebSocket 转发 Upgrade 和 Connection 请求头。限制后端端口的外部访问；使用附件时，代理请求体上限应大于服务端单文件上限。</p>
      <p>先在主机运行 <code>curl -fsS -o /dev/null http://127.0.0.1:8787/</code> 检查后台首页能否响应（自定义端口时替换 8787）。浏览器打开对外地址，用 Owner 邮箱和密码登录。再从手机网络打开同一地址，确认能加载后台且证书有效。然后<a href="../desktop/">连接桌面</a>，检查后台显示在线，并在配对页核对二维码里的 Server 地址。源码运行、镜像自建和持久化细节见<a href="https://github.com/lxy-app/dsh-connect#快速启动">根 README</a>。</p>
    </article>
  );
}
