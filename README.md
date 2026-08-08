# 梁州商务工作台 · 实时共享版

真正的多人协同工作台：数据存在服务器上，谁改了状态，所有在线同事的页面**秒级自动刷新**（像飞书一样）。

## 目录结构
```
realtime/
├── server.js          # 零依赖 Node 后端（HTTP + 登录鉴权 + SSE实时推送 + JSON存储）
├── package.json
├── public/
│   └── index.html     # 工作台前端（自动连服务器，无需任何配置）
└── data/
    ├── store.json     # 业务数据（自动生成/持久化，勿手动改）
    ├── seed.json      # 原始 Excel 数据种子（重置时恢复用）
    └── users.json     # 用户账号（首次启动自动创建 admin）
```

## 一、本地运行（先自己试）
需要 Node.js 18+。在本目录执行：
```bash
node server.js
```
浏览器打开 http://localhost:3000 即可。
默认管理员：**admin / liangzhou2026**（登录后点左下角 ⚙ 给同事建账号）。

> 数据文件在 `data/` 下，改的东西实时写盘，重启不丢。

## 二、让全团队访问（三种方式）

### 方式 A：办公室同一局域网（最快，零成本）
在公司那台常开的电脑上 `node server.js`，同事用浏览器访问
`http://<那台电脑的内网IP>:3000`（如 `http://192.168.1.50:3000`）。
- 优点：1 分钟搞定
- 缺点：同事不在公司/不在同一 WiFi 就访问不了

### 方式 B：部署到云主机（7×24 在线，你关机也不影响）★
把后端托管到云端，**你电脑开关机、谁来谁走都跟它无关**，同事随时能进。推荐 Railway（部署最简单，免费额度够小团队）。

**本目录代码已就绪**（零依赖 Node 后端 + 前端 + 种子数据 + 部署脚本），云端会自动从 `seed.json` 建数据、自动建管理员，**开箱即用**。你需要先把代码送到 GitHub，再让 Railway 连线部署。送代码有两种方式：

**方式 B-1 · 网页上传（免命令行，推荐）**
适合本机没装 Git / 命令行工具的情况，全程在网页点：
1. 注册 GitHub：https://github.com
2. 网页 New repository 建一个**空**仓库（如 `liangzhou-workbench`），不要勾选初始化文件
3. 进仓库 → Add file → Upload files → 把本 `realtime/` 文件夹里的全部内容（含 `public/`、`data/` 子文件夹，保持层级）拖拽上传并提交
4. 注册 Railway：https://railway.app （用 GitHub 登录）
5. Railway → New Project → Deploy from GitHub repo → 选刚建的仓库 → 等待部署
6. 部署完成点生成的 URL（形如 `xxx.up.railway.app`），发给同事

**方式 B-2 · Git 推送（标准）**
需本机已装 Git（Mac 需先 `xcode-select --install` 装好命令行工具）：
1. GitHub 网页建空仓库
2. 在本目录执行（换成你的用户名/仓库名）：
```bash
cd /Users/zhitianxinchang/WorkBuddy/2026-08-08-23-16-13/realtime
git init && git add -A && git commit -m "init"
git remote add origin https://github.com/你的用户名/仓库名.git
git branch -M main && git push -u origin main
```
3. 同 B-1 第 4–6 步连线 Railway 部署

> Railway 新账号有免费额度，通常需绑定一张卡验证（不扣费）。备选 Render（https://render.com，永久免费层但 15 分钟无访问会休眠）：New Web Service → 连仓库 → Start Command 填 `node server.js` → 实例选 Free。
> 首次启动云端自动建管理员 `admin / liangzhou2026`，登录后点左下角 ⚙ 给同事建各自账号。

### 方式 C：本机一键穿透（你选的方案 2，推荐个人/小团队临时用）
在你**常开的 Mac**上跑一个自带脚本，它会用 WorkBuddy 的 Node 自动起后端、自动下载免费的 cloudflared（无需注册账号）、自动建立公网隧道并打印访问地址。

```bash
cd /Users/zhitianxinchang/WorkBuddy/2026-08-08-23-16-13/realtime && bash start-local.sh
```
- 终端会打印一个 `https://xxxx.trycloudflare.com` 公网地址 → 复制发给同事即可
- 想停止：终端按 `Ctrl+C`
- ⚠️ 跑脚本的那台电脑必须**一直开着、不休眠**，同事才能访问
- ⚠️ 免费隧道的公网地址**每次重启会变**（不是固定域名）；要固定域名需用方式 B 的云主机
- 若 macOS 首次弹"无法验证开发者"，去「系统设置 → 隐私与安全性」点"仍要打开"（脚本已尽量自动规避）

> ⚠️ 之前 WorkBuddy 的"静态部署"只能发纯网页，跑不了这个后端，所以实时版需要上面任一种方式托管 Node 服务。

## 三、功能对照
| 功能 | 说明 |
|------|------|
| 登录 | 服务器端校验，外人进不来；会话 12 小时 |
| 实时同步 | SSE 推送，一处修改全员秒更 |
| 可编辑字段 | 剪辑师 / 制作进度（待开始→…→已发布）/ 下单进度 / 返点进度 / 协议进度 / 沟通状态 |
| 用户管理 | 管理员可增删用户、改密码、设角色（管理员/普通成员） |
| 数据分析 | 月度周期对比、各平台横向对比、交叉矩阵、返点率 |
| 新增/删除订单 | 合作订单页右上角「＋新增订单」填表入库；详情弹窗可删除（实时同步全员） |
| 档期日历 | 点日期可编辑排期 |
| 重置 | 管理员一键恢复到 Excel 原始数据 |

## 四、安全说明
- 密码用 scrypt 哈希存储，Cookie 为 HttpOnly，未登录接口全部 401 拦截
- 这是轻量级团队工具，适合内部使用；如需更严格权限（按人可见不同数据）可继续扩展
- 数据文件是明文 JSON，请确保部署服务器本身有权限管控
