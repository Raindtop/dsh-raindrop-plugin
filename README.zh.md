# dsh-session-date

一个 DSH Web GUI 插件：把侧边栏会话列表里的**相对时间**（“刚刚 / 5分钟 / 3天 / 2个月”）换成**具体日期**。

![侧边栏会话日期](docs/preview.png)

```
之前：  刚刚    5分钟   3小时   3天     2个月
之后：  10月29日 10月29日 10月29日 10月26日 8月30日
```

跨年会话显示年份（`2025年10月29日`）；英文界面显示 `Oct 29` / `Oct 29, 2025`。

## 改动范围

- 只改左侧会话树每一行末尾的时间标签（按工作区分组、工作区树、平铺列表三种模式都生效）。
- 标题、悬停卡片、搜索、排序、会话数据都不动。

## 安装

```bash
# 在本目录执行（这是一个本地源码包，无需构建）
dsh plugin --profile web add /absolute/path/to/dsh-session-date
```

包内声明了 `dsh.bundle.patch`，插件管理器会把它作为 profile 组合包安装、插入 `ui-session-date` 行，并写入 `dsh.profile.bundles`。装完刷新一下浏览器页面即可；`lib/client.js` 是手写的、与官方客户端包相同的模块格式，不需要编译。

卸载：

```bash
dsh plugin --profile web remove dsh-session-date
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

`SHOW_YEAR` 决定何时显示年份：`auto`（只有非当前年份才显示）、`always`、`never`。这个包是以 link 方式安装的，改完存盘、刷新页面即可，不用重装、不用构建。

也可以在 GUI 的插件设置里直接停用这个组合包，和普通插件一样。

## 实现原理

`@deepseek-ai/dsh-client-ui-workspace` 只发布了打包后的 `lib/client.js`，行内时间也不是 slot，没有现成的声明式接缝可以替换。这个插件于是利用行自身的 DOM 约定：

1. 从公开的 `ctx.sessions` 会话仓库读取 `byId[id].updatedAt` —— 正是这一行格式化时用的时间戳。
2. 给每个 `[data-row-key="session:<id>"]` 行的时钟 `<span>`（CSS Module 类名以 `_time` 结尾）打上 `data-dsh-session-date` 属性，值为格式化后的日期。
3. 注入一小段样式：把该 `span` 里的相对文字隐藏（`font-size: 0`），用 `::after { content: attr(...) }` 画出日期。React 始终拥有自己的文本节点，插件从不替换文本，因此重新渲染不会互相打架。
4. 用过滤过的 `MutationObserver`（只关心会话行内的变动）加 `ctx.sessions.list` 订阅，在列表变化、新行插入、状态切换时重新打戳。处于“待审批”等状态的会话行（`aria-hidden="true"`）保留原状态文案。

如果以后 DSH 改了 CSS Module 的类名，插件会回退到“行内第三个直接 `<span>`”；如果整行结构都变了，它只会失效（变成 no-op），不会破坏行内容。

## 兼容性

按 DSH `0.2.1-rc.4`（web profile）编写。依赖 `sessions` 客户端服务，所有 web profile 都有。
