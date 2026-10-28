# Render 免费实例 + 独立 PostgreSQL

网站注册只需要自定义账号和密码，不要求手机号、邮箱或任何验证码。独立数据库与网站登录是两回事：访客不需要注册数据库托管平台账号。

免费实例的本地磁盘不能保存真实账号或任务。当前版本支持把这些数据保存在外部 PostgreSQL，Render 只运行网页与 API。根目录 `render.yaml` 已切换为这一路线；原付费磁盘方案保存在 `deploy/render-sqlite.yaml`，不会自动创建任何资源。

## 准备数据库

可以使用 Supabase 的 Free 方案或其他可兼容 PostgreSQL 的托管服务。确认控制台当前价格和额度为免费，再创建；不要为了这份配置自动升级付费套餐。

1. 以站长身份登录 Supabase，选择 Free 组织，创建数据库项目，地域尽量与 Render 接近。
2. 数据库密码自行保管。项目就绪后，从连接入口选择 **Session pooler** 连接串，避免仅支持 IPv6 的直连地址与托管平台网络不兼容。
3. 按平台说明补入数据库密码；如果密码含特殊字符，需要进行 URL 编码。完整连接串是密码凭据，只填到 Render 的服务端 `DATABASE_URL`，不要发到聊天、放入代码或填入 `VITE_` 变量。
4. 连接使用经过证书校验的 TLS。程序不接受远程 `sslmode=disable`。如平台使用专用 CA，从其官方控制台取得 PEM 证书，填到服务端 `DATABASE_SSL_CA`，不要关闭验证。

这里使用的是数据库连接串，不是 Supabase 的公开 API URL、匿名 key 或服务角色 key。数据库账号、网站访客账号彼此独立。

## Render 手动创建服务

- 仓库：`colorlessfo/repo-giuyocqo`，分支：`qiyu-ddl`。
- Language / Runtime：Docker；Root Directory 留空；Dockerfile Path：`./Dockerfile`。
- Compute：Free；不要添加持久磁盘。
- 服务端环境变量：`TRUST_PROXY=1`、`REQUIRE_DATABASE_URL=true`，以及秘密保存的 `DATABASE_URL`。
- `NODE_ENV=production` 已在 Dockerfile 中设置。
- Health Check Path：`/api/health`。

也可通过 Blueprint 读取 `render.yaml`。填写秘密连接串后，确认价格与资源均符合预期再创建部署。没有 `DATABASE_URL` 时程序会拒绝在 Render 使用临时 SQLite，避免误以为账号已经持久保存。

表结构首次启动时自动建立。应用数据使用私有 `qiyu` schema，不使用公开 `public` schema；匿名角色不应具有读取权限。

## 上线后检查

1. 取得 Render 实际提供的 HTTPS 网址，不要预先猜测网址。
2. 注册自己的账号，创建任务、课程及分类，在另一设备登录验证一致；另一个账号应看不到这些数据。
3. 重新部署网页服务，再登录确认数据仍在。下载 JSON 备份并妥善保存。

## 边界

- 目前只在开发环境和本地 PostgreSQL 验证适配，并不代表已经连通你的 Supabase 项目或完成公开部署；需取得实际服务响应后才能确认。
- 免费实例可能闲置休眠，首次唤醒可能较慢；数据库免费方案也有容量、用量或闲置暂停条件。以开通时控制台及官方规则为准，不承诺永久免费、无限容量或持续可用。
- 程序不会自动把原 SQLite 数据复制到外部数据库。如已有真实数据，需要先备份并安排迁移，不能直接切换连接串后假定旧账号、任务已搬过去。
- 当前不提供短信、邮件验证码或密码找回；请记住自己的账号和密码。
