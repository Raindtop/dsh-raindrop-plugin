# dsh-raindrop-plugin

一个 DSH Web GUI 插件：把侧边栏会话列表里的**相对时间**（“刚刚 / 5分钟 / 3天 / 2个月”）换成**具体日期**，在侧栏头部加一个「日期视图」面板（切换首次对话/最后活动、按日期排序、按日期范围筛选），在“新会话”的工作区选择菜单里加一个**搜索框**，并在当前模型使用自己的 DeepSeek 账号额度时在**顶部显示告警**。

![侧边栏日期视图](docs/preview.png)

```
之前：  刚刚    5分钟   3小时   3天     2个月
之后：  10月29日 10月29日 10月29日 10月26日 8月30日
```

跨年会话显示年份（`2025年10月29日`）；英文界面显示 `Oct 29` / `Oct 29, 2025`。

## 功能

- **行内日期**：每个会话行末尾显示日历日（默认“最后活动”，可切换为“首次对话”）。
- **工作区搜索**：打开“新会话”的工作区菜单后，顶部会出现搜索框。工作区菜单最多显示 5 行，其余滚动，搜索框和“添加工作区”固定在两端；输入时列表只保留匹配的工作区；`↑`/`↓` 移动高亮，`Home`/`End` 跳到第一个/最后一个匹配项，`Enter` 切到当前高亮项（没有高亮时优先名称完全匹配，其次第一个匹配项）。没有匹配时输入框下划线变橙色，`Enter` 不动作。
- **自有额度告警**：当前会话选中的模型由自己的 DeepSeek 账号提供时（`deepseek-account` 账号登录路由或 `deepseek-official` 官方 API Key 路由），窗口顶部会固定显示一条琥珀色告警：**“正在使用自己的额度！”**（英文界面为 **“You are using your own quota!”**）。切到其他供应商后立即消失，不遮挡、不拦截操作。`qz` 等第三方网关有自己的计费，不会触发。
- **日期视图面板**：侧栏头部的日历按钮（在原生“视图选项”滑杆按钮左侧）。
  - 显示日期：`最后活动` / `首次对话`
  - 按日期排序：`默认（侧栏排序）` / `日期：新 → 旧` / `日期：旧 → 新`
  - 筛选日期：`全部` / `今天` / `近 7 天` / `近 30 天` + 自定义起止日期
  - `清除筛选`
- 选择结果保存在 `localStorage`，刷新页面后保持。
- 排序与筛选只影响侧栏当前渲染出来的行；工作区分组模式下按“每个展开的工作区内部”排序，折叠的工作区不会被自动展开。
- “首次对话”取自会话 header 的 `createdAt`（Host 侧读取）；如果“新会话”草稿被搁置很久后才使用，这个时间可能早于第一条消息。需要精确到“首条用户消息时间”的话还得扫描完整日志，暂未实现。

## 自有额度告警

![自有额度告警](docs/own-quota.png)

告警跟随**当前屏幕上这条会话选中的模型**，不是全局账号状态：把模型切到第三方供应商，告警消失；切回「DeepSeek 账号」下的模型，告警回来。打开插件管理、设置等入口页时告警会继续保留，因为下一次请求仍会花自己的余额。

哪些供应商标记为“自有额度”由 [`lib/client.js`](lib/client.js) 顶部一个集合决定：

```js
const OWN_QUOTA_PROVIDERS = new Set(["deepseek-account", "deepseek-official"]);
```

`deepseek-account` 是 DeepSeek 账号登录路由，`deepseek-official` 是官方 API Key 路由。想连第三方账号一起提醒（例如 `"qz"`），把它的 provider id 加进去；不想提醒某个路由就从集合里删掉。这些 id 与模型选择器上的 `data-provider-id` 一致；插件不读取 API Key、账号 token 或账户余额。

## 安装

从 npm 安装（推荐）：

```bash
dsh plugin --profile web add dsh-raindrop-plugin
```

本地源码 link 安装（开发用）：

```bash
# 在本目录执行（这是一个本地源码包，无需构建）
dsh plugin --profile web add /absolute/path/to/dsh-raindrop-plugin
```

包内声明了 `dsh.bundle.patch`，插件管理器会把它作为 profile 组合包安装、插入 `ui-raindrop-plugin` 行，并写入 `dsh.profile.bundles`。装完刷新一下浏览器页面即可；`lib/client.js` 是手写的、与官方客户端包相同的模块格式，不需要编译。

改动已安装（link）插件的**宿主侧**代码（`lib/index.js`）后，`dsh web` 会在下一次 profile 重载时替换它——修改一次 `~/.dsh/profiles/<name>/cordis.patch.yml`（例如加一行注释再删掉）或重启 `dsh web` 即可；客户端代码改动只需刷新页面。registry 安装是纯拷贝，改代码后需要重装。

卸载：

```bash
dsh plugin --profile web remove dsh-raindrop-plugin
```

## 调整日期格式

格式是 [`lib/client.js`](lib/client.js) 顶部的两个常量：

```js
const FORMAT = "localized"; // localized | numeric | iso
const SHOW_YEAR = "auto";   // auto | always | never
```

| FORMAT | 示例 |
| --- | --- |
| `localized`（默认） | `10月29日` / `Oct 29` |
| `numeric` | `10-29`（是否带年看 `SHOW_YEAR`） |
| `iso` | `2026-10-29` |

`SHOW_YEAR` 决定何时显示年份：`auto`（只有非当前年份才显示）、`always`、`never`。以 link 方式安装时，改完存盘、刷新页面即可，不用重装、不用构建；registry 安装是拷贝，改完需要重装。

也可以在 GUI 的插件设置里直接停用这个组合包，和普通插件一样。

## 实现原理

`@deepseek-ai/dsh-client-ui-workspace` 只发布了打包后的 `lib/client.js`，行内时间不是 slot，头部按钮列表也不是 slot，没有现成的声明式接缝。插件因此利用界面自身的稳定约定：

**行内日期**

1. 从公开的 `ctx.sessions` 会话仓库读取 `byId[id].updatedAt`；首次对话日期从本包的 Host 路由读取 `createdAt`。
2. 给每个 `[data-row-key="session:<id>"]` 行的时钟 `<span>`（CSS Module 类名以 `_time` 结尾）打上 `data-dsh-session-date` 属性，值为格式化后的日期。
3. 注入样式：隐藏该 `span` 的相对文字（`font-size: 0`），用 `::after { content: attr(...) }` 画出日期。React 始终拥有自己的文本节点，插件从不替换文本，因此重新渲染不会互相打架。
4. 用过滤过的 `MutationObserver`（只关心会话行和侧栏头部内的变动）加 `ctx.sessions.list` 订阅，在列表变化、新行插入、状态切换时重新打戳。处于“待审批”等状态的会话行（`aria-hidden="true"`）保留原状态文案。

**排序与筛选**

5. 行外层容器在排序开启时临时变成 flex 列，每行 wrapper 设置 CSS `order`；React 始终拥有文档顺序，插件从不移动节点。
6. 范围外的行加一个隐藏属性；工作区内的行全部被筛掉时整段隐藏，并在列表顶部显示“没有符合日期范围的会话”。

**Host 路由**

7. 浏览器拿不到 `createdAt`（`session.list` 只带 `updatedAt`），所以 Host 半用公开的 `sessionQuery.listSessions()` 读取 durable header，在 `GET /session-date/dates` 返回 `{ sessions: { [id]: createdAt }, fetchedAt }`。路由走 `connection.authorizeIndex` 的浏览器会话校验（无 cookie 返回 401），只暴露会话 id 与创建时间，不返回标题、提示词或路径；15 秒缓存。

**自有额度告警**

8. 输入框的模型标签带有 `data-provider-id`（官方 `conversation.input.model.label` 约定），这是实时来源；没有输入框的入口页（插件管理、设置）回退到 `ctx.sessions.list` 中当前会话的 durable `projectionValues.modelSelection.next` / `lastUsed`，并用“最后一次已知 provider”在页面切换期间兜底。
9. 告警条是挂在 `body` 上的固定元素；显示时给 `#root` 加 `data-dsh-own-quota` 属性，样式规则在顶部预留 32px 高的一条带，告警固定在带内；隐藏时移除属性，布局恢复原高。不移动、不替换任何 React 管理的节点。

如果以后 DSH 改了 CSS Module 的类名，插件会回退到“行内第三个直接 `<span>`”；如果整行结构都变了，它只会失效（变成 no-op），不会破坏行内容。排序/筛选同样只在结构匹配时生效。

## 兼容性

按 DSH `0.2.1-rc.4`（web profile）编写。客户端依赖 `sessions` 服务；Host 半依赖 `webServer`、`connection` 和可选的 `sessionQuery`（缺失时路由返回空表，日期回退到最后活动）。自有额度告警使用模型标签的 `data-provider-id` 或会话的 `modelSelection` projection；两者都不存在时保持静默。
