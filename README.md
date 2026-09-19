# Clash Subscription Converter

一个自托管的 Clash/Mihomo 订阅管理与转换服务。输入上游订阅 URL，服务会定时拉取并缓存内容，筛选 `pro-*`、`直连-*` 中属于香港、台湾、美国、日本的节点，并分别生成 tvOS、iOS、Android 订阅地址。

## 功能

- 支持 Clash/Mihomo YAML，以及常见 Base64/URI 节点订阅（SS、VMess、VLESS、Trojan、Hysteria2、TUIC）。
- 香港、台湾、美国、日本独立 `url-test` 自动测速组；没有节点的地区不会生成空策略组。
- 新增 `🌈 AI 自动`，仅包含名称以 `直连-美国` 开头且兼容当前设备的节点（不含 `pro-*`、其他地区或 `DIRECT`）。AI 平台和 Apple-智能均可选择它，原有默认选项保持不变。若过滤后无符合节点，则省略该组及选项，避免空组；例如 tvOS 会先排除 Mieru。
- 地区使用服务自带 PNG 图标和 `HK/TW/US/JP` 文字标识，不依赖系统旗帜 Emoji 字体；生成的配置带有对应 `icon` URL。
- 网页按设备可视化展示地区组、服务组、配置默认策略和过滤后的节点，支持按组筛选、名称/协议搜索、延迟排序。
- 网页可通过独立 Mihomo 内核实测过滤后节点的 HTTP 延迟，展示进度、成功/失败和测试时间。
- 服务分组：海外 AI、Apple-智能、YouTube、Netflix、HBO、Disney+、Prime Video、Google、邮件、日本区域、iCloud、苹果服务、微软服务、国内流媒体、漏网之鱼、广告拦截。
- 每个服务组均可选择地区自动组、单个节点和 `DIRECT`。`直连-*` 是机场代理节点，`DIRECT` 才表示本地直连。
- AI 和 Apple-智能默认优先美国自动；日本区域默认日本自动；iCloud、苹果、微软、国内流媒体默认 `DIRECT`；广告组默认 `REJECT`，可切换为 `DIRECT`。
- tvOS/Android 接入 [Loyalsoldier/clash-rules](https://github.com/Loyalsoldier/clash-rules) 的 9 个基础规则集；iOS 使用 MetaCubeX 的 10 个二进制 MRS 规则集以降低启动内存。客户端每 24 小时更新。Google 基础集仅覆盖可在大陆直连的部分域名，完整服务分组由内置域名和上游规则补充。
- 合并上游自包含域名/IP 规则时按服务映射策略组，并按域名具体程度排序，确保邮件、AI、YouTube API 等先于 Google/微软大类匹配。没有对应组的规则映射到“漏网之鱼”。
- 网页可编辑全局 DIRECT 白名单，匹配时强制直连，优先于所有分组和广告规则。持久化到 `/data/settings.json`，保存后下一次下载同一订阅链接即可生效。
- tvOS 在生成策略组之前排除 `mieru` 节点；过滤后无节点的地区不生成空组，全部无可用节点则返回明确的 HTTP 422 错误。iOS、Android 保留 Mieru。
- 三套设备预设：tvOS 关闭 TUN/嗅探，iOS 关闭 TUN、启用保守嗅探，Android 启用 TUN/DNS 劫持与完整嗅探。
- 管理 API 使用 Bearer Token；设备订阅使用独立的高熵公开令牌，可随时轮换。
- 阻止本机/内网上游地址，并提供响应大小限制、拉取超时、重定向复检、原子化持久化。

> Apple-智能包含 `ios.chat.openai.com`、`gateway.icloud.com`、`apple-relay.apple.com`、`apple-relay.fastly-edge.com`、`apple-relay.cloudflare.com`、`guzzoni.apple.com`、`cp4.cloudflare.com`、`gspe1-ssl.ls.apple.com`、`smoot.apple.com`、`apple-relay.akamaized.net`、`apple-relay.mask.apple-dns.net`、`aapps.mzstatic.com`，优先于普通 OpenAI/Apple/iCloud 规则。三端共用这些规则，iOS 可使用它们处理 Apple ChatGPT 登录流量。其他 ChatGPT 流量走 AI 平台组；两组默认同为美国自动。

规则目录在 `src/routing.js`，设备与节点设置在 `src/converter.js`。Apple/AI 域名和地域可用性会变化，规则匹配不等于承诺账号可登录。

## DIRECT 白名单

连接管理页面后，在“DIRECT 白名单”里每行输入一个条目并保存，例如：

```text
example.com
DOMAIN,api.example.com
192.168.0.0/16
IP-CIDR6,fd00::/8
```

裸域名表示该域名及所有子域名；`DOMAIN` 只匹配精确域名。支持 IPv4/IPv6 单个地址、CIDR，以及 `DOMAIN-SUFFIX` 显式格式。不接受 URL 路径、任意策略或 `MATCH`；最多 500 条。修改后在客户端执行“更新订阅”，无需刷新上游或重新添加链接。删除一行后保存即移除该例外，清空保存则关闭所有白名单例外。

规则优先级：DIRECT 白名单 → Apple-智能 → 私有域名/广告集 → 按具体程度排序的服务域名和上游规则 → Apple/iCloud/Google 基础集 → 日本后缀 → 国内直连/通用代理/IP 集 → 漏网之鱼。

## 规则集与客户端兼容

订阅文件本身始终是 **Clash YAML**，不是 sing-box JSON。tvOS/Android 使用 [Stash 文档支持的 YAML rule-providers](https://stash.wiki/rules/rule-set)；iOS 面向 Clash Mi/Mihomo，使用其支持的二进制 `format: mrs` 规则文件（并非把订阅改成另一种格式）。规则集由设备从 jsDelivr 拉取；首次导入需要设备能够访问这些 URL。代理节点凭据不会发送给规则集提供方。规则列表采用内置域名，不生成 `GEOSITE,category-ai-!cn` 或 `GEOSITE,category-ai-cn`。

上游 `GEOSITE`、`RULE-SET`、逻辑/进程规则不直接继承，避免依赖未携带的数据库或 provider。tvOS/Android 的日本 IP 回退使用客户端 GeoIP 数据库。iOS 改用单独的日本 IP MRS 集，不生成需要完整 GeoIP 数据库的规则。

### Clash Mi（Mihomo 1.19.30）与 iOS 秒断

[Clash Mi 官方 FAQ](https://clashmi.app/guide/faq) 提醒 iOS VPN 扩展有约 50 MB 内存限制，超限可能直接断开，并建议使用 MRS。原来的大体积 YAML provider 在解析时需要额外内存；桌面内核通过 `-t` 仅说明配置合法，不能证明 iOS VPN 能持续运行。

iOS 基础集来自 [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat)，对应广告、iCloud、Apple、Google 中国域名、海外域名、中国域名、私有域名、私有 IP、中国 IP、日本 IP。它们与 Loyalsoldier 列表不是逐条相同；原有显式服务域名、上游自包含规则、DIRECT 白名单及优先级不变，节点参数及 AI 自动组不变。iOS 的 TUN 生命周期由 Clash Mi 接管，不通过强开订阅内的 TUN 来解决内存问题。

可选的真实内核启动检查（需自行提供可信的 Mihomo 1.19.30 可执行文件）：

```bash
CORE_BIN=/absolute/path/to/mihomo SOURCE_FILE=/absolute/path/to/source.yaml node scripts/verify-ios-core.mjs
```

检查会下载公开规则，在临时目录分别启动旧版 YAML / 新版 MRS 配置，确认所有 provider 已载入，输出采样 RSS。为隔离规则开销，两组均关闭 TUN、DNS、嗅探、代理监听和节点自动测速；不会测试节点连通性或上传订阅。macOS/Linux RSS 不能当作 iPhone 内存实测，也不替代手机 VPN 验证。

更新服务后，在 Clash Mi 更新原有 **iOS 订阅链接**即可取得新配置，无需更换令牌或改用节点-only订阅。远端服务需先部署本次代码更新，单独更新本机不会改变远端输出。

## Docker 部署

```bash
cp .env.production.example .env.production
# 首次编辑 .env.production：设置强 ADMIN_TOKEN 和外网 PUBLIC_BASE_URL
docker compose --env-file .env.production up -d --build
```

Compose 默认仅绑定 `127.0.0.1:8080`，供宿主机上的 Caddy/Nginx 反向代理使用；不会直接开放公网 8080。配置 HTTPS 后访问 `PUBLIC_BASE_URL`，输入 `ADMIN_TOKEN`，添加上游订阅。若反向代理也在容器中，应通过 Docker 网络连接服务，不能直接使用代理容器自身的 `127.0.0.1`。

Docker 镜像内置 Mihomo v1.19.29，无需额外安装测速内核。`PUBLIC_BASE_URL` 应设置为设备能访问的服务地址；订阅中的地区图标也从这个地址获取。修改图标或分组后，需在客户端更新订阅；不支持 `icon` 字段的客户端仍能看到地区文字标识。

一个最小 Caddy 配置：

```caddyfile
sub.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---:|---|
| `ADMIN_TOKEN` | 空 | 管理令牌；生产环境必须设置 |
| `PORT` | `8080` | HTTP 监听端口 |
| `DATA_DIR` | `./data` | 元数据和上游缓存目录 |
| `PUBLIC_BASE_URL` | 请求地址 | 展示给设备的公网根地址 |
| `REFRESH_INTERVAL_MINUTES` | `360` | 后台刷新间隔，最小 5 分钟 |
| `FETCH_TIMEOUT_MS` | `15000` | 上游请求超时 |
| `MAX_SUBSCRIPTION_BYTES` | `10485760` | 上游最大响应大小 |
| `ALLOW_PRIVATE_UPSTREAMS` | `false` | 是否允许内网 URL；仅可信网络按需开启 |
| `MIHOMO_BIN` | 空；Docker 已配置 | Mihomo 可执行文件路径；未配置时仍可转换，但网页测速不可用 |
| `LATENCY_TIMEOUT_MS` | `5000` | 单节点 HTTP 测试超时，范围 1000–15000 毫秒 |

## 分组预览与网页测速

展开订阅卡片的“分组与节点”，切换 iOS、tvOS、Android 可查看该设备最终配置。点击地区/服务卡片查看可选策略及其节点；这是配置预览，不会改变客户端正在使用的策略。tvOS 预览与下载使用同一过滤逻辑，排除 Mieru。

点击“开始测速”后，服务启动临时独立 Mihomo 实例，通过各节点请求 `https://www.gstatic.com/generate_204`。数值是**服务器 → 代理 → 测试网址的 HTTP 延迟**，不是下载带宽，也不是手机/电视的实际延迟。测试使用当前设备全部过滤后节点，搜索和分组筛选仅改变显示范围。失败或超时单独标记，不生成虚假延迟。

每次最多 500 个节点、并发 4 个，全服务同时只允许一轮测试，完成后需间隔 10 秒重试。结果仅存内存，重启后清空；节点配置变更后旧结果会隐藏。临时内核仅开放带随机认证的本机控制接口，不开启代理端口、TUN 或系统代理，完成后退出并清理临时配置。管理页面只返回节点名称、协议、地区和测试结果，不返回节点服务器地址或凭据。

## API

`/api/...` 管理接口使用 `Authorization: Bearer <ADMIN_TOKEN>`；页面静态资源、`/healthz`、`/icons/...` 与持有独立令牌的 `/sub/...` 无需管理令牌。

- `GET /api/subscriptions`：列出订阅（不会返回完整上游 URL）。
- `GET /api/settings`：读取全局设置。
- `PUT /api/settings`：保存全局白名单，JSON 为 `{"directWhitelist":["example.com","DOMAIN,api.example.com"]}`，也接受逐行字符串。需管理令牌；无效条目返回 400 且不覆盖原设置。
- `POST /api/subscriptions`：添加并立即验证，JSON 字段为 `name`、`url`、`includeUpstreamRules`。
- `PATCH /api/subscriptions/:id`：更新订阅。
- `POST /api/subscriptions/:id/refresh`：立即刷新。
- `GET /api/subscriptions/:id/preview?device=ios`：返回过滤后节点、分组、规则数量和测速快照；设备可选 `ios`、`tvos`、`android`。
- `POST /api/subscriptions/:id/latency?device=ios`：启动真实 HTTP 延迟测试，返回 202；内核未配置返回 503，其他任务运行中返回 409，重复测试过快返回 429。
- `GET /api/subscriptions/:id/latency?device=ios`：读取该设备测试进度与结果。
- `POST /api/subscriptions/:id/token`：轮换设备链接令牌。
- `DELETE /api/subscriptions/:id`：删除订阅和缓存。
- `GET /sub/:token/{tvos|ios|android}.yaml`：设备订阅输出。

## 本地开发

```bash
npm install
cp .env.local.example .env.local
# 仅首次设置本地选项；已有 .env.local 时不要再次覆盖。
npm test
npm run dev
```

`npm run dev` 使用 `.env.local` 并监听代码变化；`npm run start:local` 使用同一文件但不监听。本机已有数据继续放在 `./data`，远端 Docker 使用独立命名卷 `/data`。本地模板的 Mihomo 路径适用于 macOS Clash Verge；其他环境首次修改该路径或留空禁用网页测速。

### 环境分离：以后只换启动命令，不来回改配置

| 环境 | 配置（仅首次填写） | 启动/更新命令 | 数据 |
|---|---|---|---|
| 本地开发 | `.env.local` | `npm run dev` | 本机 `./data` |
| 本地体验 | `.env.local` | `npm run start:local` | 同上 |
| 远端部署 | `.env.production` | `docker compose --env-file .env.production up -d --build` | Docker 命名卷 `/data` |

两份私有环境文件均不提交 Git、不进入 Docker 构建上下文。不要把 `.env.local` 上传到远端；上传时排除 `.env`、`.env.local`、`.env.production` 和 `data/`，但保留对应 `.example` 模板。远端配置只需在服务器保存一次，之后更新代码无需覆盖它。`.env.example` 保留用于旧部署参考，新的流程使用两份专用模板。

本地 `PUBLIC_BASE_URL` 留空时根据访问地址生成链接：给手机/电视复制链接时，应使用 Mac 的局域网 IP 访问管理页，不能用 `localhost`。也可以在 `.env.local` 固定局域网地址。远端必须设置设备可访问的 HTTPS 域名，不继承 Mac 地址或本地内网放行设置。Shell 中已导出的同名变量优先于环境文件；排查意外配置时检查这些变量。原始 `npm start` 保持只读取进程环境，不自动读取任何 `.env` 文件。

远端日常检查：

```bash
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=100
```

## 下载文件名称

设备订阅 URL 保持原来的 `/sub/:token/tvos.yaml`、`ios.yaml`、`android.yaml`，无需更换已有链接。HTTP 下载响应使用无引号的 `Content-Disposition: attachment; filename=...`，文件名分别为 `tvOS-kakamlab.yaml`、`iOS-kakamlab.yaml`、`Android-kakamlab.yaml`。保留 `.yaml` 扩展名用于软件识别配置。客户端若自行给已有订阅命名，不一定会随下载文件名更新，需要手动重命名。

服务只缓存上游原文与必要元数据，不会把订阅凭据写入日志或前端列表。请把 `/data` 作为敏感数据备份和保护。
