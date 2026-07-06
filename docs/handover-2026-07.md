# 交接文档 — cockpit/v2 资金流驾驶舱(2026-07 会话续接)

> 面向"开新 thread 继续"的交接。旧的总览见 `docs/project-handover.md`(2026-06,偏 v1→v2 架构);
> 本文档覆盖 2026-07 这轮大改后的**当前状态、非显然的业务逻辑、环境坑、后续候选**。
> 逐条 changelog 见 `.helloagents/CHANGELOG.md`(倒序,最新在最上)。

## 0. 一句话

Node 22 / ESM / **零第三方依赖** / 无构建的静态"资金流向与轮动驾驶舱"。把加密资金拆成五层 + 旁路信号,
合成"钱在哪、往哪轮、对某标的该不该上"的**决策辅助**(watch_only 上限,绝不下单)。

## 1. 部署与访问(已上线)

- **仓库**:`github.com/qahhaaaa/capital-flow-cockpit`(gh 账号 `qahhaaaa`),分支 `main`。
- **线上**:https://qahhaaaa.github.io/capital-flow-cockpit/ (GitHub Pages)。讲解页 `/guide.html`。
- **CI**:`.github/workflows/collect-and-deploy.yml` —— 每小时(cron `17 * * * *`)+ push + 手动。
  流程:`npm test`(门禁)→ `node scripts/collect-cockpit.mjs` 采集 → 数据 commit 回 main → 部署 `public/` 到 Pages。
  deploy 步骤有**失败自动重试一次**(Pages 服务端偶发 "try again later")。手动可带 `force_notify` 强推一条 TG。
- **零 secret 采集**;可选 Telegram 推送已配好 2 个 repo secret(`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`,bot=@projInf_bot,菜单按钮已设)。
- **测试**:`npm test` 当前 **132 全绿**,必须保持绿。

## 2. 架构与数据流

`providers(各源,失败隔离) → layers(normalize+signal) → engine(flowState + guidance) → contract(cockpit/v2 JSON) → public/main.js 渲染`

五层 + 旁路:
- **L1 宏观** `layers/macro` — FRED 净流动性 `WALCL−TGA−RRP`(regime 闸门)。
- **L2 链间** `layers/chain-flow` — **多时间轴综合**(见 §3),现为核心。
- **L3 发射台** `layers/launchpad` — DeFiLlama 协议收入 + 动量 + **体量门槛**轮动边。
- **L4 DEX↔CEX** `layers/dexcex` — OKX 衍生品;**云端 451 时自动回退 Hyperliquid**(`providers/hyperliquid.mjs`,仅 perp 腿→partial)。
- **L5 主题** `layers/narrative` — DeFiLlama 板块 TVL 7d 相对强弱 + **支持数据/推导**(保留成分协议)。
- 旁路:`appRevenueHeat`(各链协议收入热度)、`stableTide`(稳定币总量潮汐,side-channel,不进引擎 v1)。
- 顶部宏观三曲线 `public/data/macro-context.json`(**手工维护**,capex 已季度化取自 Epoch,详见 memory `epoch-data-extraction`)。

前端 `public/main.js` 渲染顺序(移动优先):结论卡 → 可信度栏 → **轮动地图** → **L2 链间** → 仓位建议 → L3+L4 → L5 → 宏观 → App 收入 → 数据健康 → 宏观三曲线(折叠)。

## 3. 非显然的业务逻辑(改动核心,务必读)

**链间综合(`layers/chain-flow.mjs`)** —— 这轮的重点:
- 每链方向/强度 = **多时间轴综合分**:`fast(6h, GeckoTerminal 聚合) × 0.45 + mid(24h, DeFiLlama DEX量+费用) × 0.35 + slow(存量, 稳定币份额Δ) × 0.20`,缺失层权重归一化。
- **fast 6h 信号**从 watchlist 那次 GeckoTerminal 请求**顺出聚合**(`providers/watchlist.mjs` 的 `aggregateChainActivity`,零新增调用):`accel6h=(6h/6)/(24h/24)−1`、accel1h、量加权价动量、买卖不平衡。
- **轮动边按综合分选端点**(不再是稳定币存量份额——那是修 SOL→BSC 漏判的根因)。来源=综合分最低且 `<−0.05`;目的地=所有综合分 `>0.10` 的**交易型**链。
  - **stage**:`confirmed`(24h mid 两端同向)/ `early`(仅 6h 快信号)。`slowFollow`=稳定币份额是否也跟。
  - **flowType**:`trading`(6h/24hDEX 放量=真热钱)/ `fee`(交易冷、仅靠协议费用)。**费用驱动的边被过滤出轮动地图**(如 ETH 被 Titan Builder 出块费用抬起的假象),但仍在 L2 表可见并标 ⚠。
  - **费用去噪**:单协议占某链 fee `>60%` → 按集中度线性折价(60%→不折,100%→归零),防一个 builder 虚抬整条链。
- **持续性签名 `computeChainPersistence`**(P-C):广度(1h/6h/24h/7d 同向计数)× 连续性(综合分连续同向小时数,来自历史)× 动量(复用 `stats.cusum`/`emaGap` 判 building/fading)× 慢钱跟进 → 标签 `闪现(日内)/升温(1-3d)/结构性(多日)/积累中`。**当前形态刻画,非未来预测**;需历史积累(`history.chainScores` 约 2026-07-06 下午才开始存,满 6 点后才脱离"积累中")。展示在轮动边 + **L2 链间表「持续性」列**。

**仓位引擎 v2(`engine.mjs`)**:`conviction = 层信号×0.6 + 标的因子×0.4`(标的因子=多窗口动量0.2 / 买卖不平衡0.1 / 换手0.1)。发射台硬下限 → 风险降档 → 收水封顶。每行带 `factors[]` 明细 + `chainTag` + `metrics`(GeckoTerminal:价格/多窗口涨幅/量/流动性/买卖/CA)。前端仓位表可展开详情行(metrics + 因子 + **顺风/逆风(移动端在此看)** + CA 复制 + GMGN 跳转)。

**采集**:1h 一次;`config.mjs REFRESH.intervalHours=1`;滚动历史上限 720 点(≈30 天),`buildHistoryEntry` 存 chainShares/totalUsd/chainScores。

**stats.mjs 工具**(可复用):`cusum`(带 stepsSinceAlarm 时效 + z winsorize)、`emaGap`、`resampleByTime`、`percentileRank`、`zScore`。

## 4. 数据诚实铁律(硬约束)

- 取不到 → `missing`/`partial`,**绝不用 0 冒充**。`Number(null)===0` 是反复踩的坑:任何数值在 `Number()` 前必须 `null/undefined/"" ` 前置拒绝(见各 provider 的 `strictNumber`/`finite`)。
- 走 API 端点不爬前端;信号基于变化率/滚动分位,不绑死绝对阈值;付费源(真实桥净流、交易所净流)记缺口不硬凑。

## 5. 后续候选(未做 / P1)

- **持续性成熟**:再跑几小时/几天,`积累中` 会转 `升温/结构性`;可回来验证。
- **L1 宏观日频 nowcast**:TGA 有免费日频源(Treasury fiscaldata,需先验证端点),WALCL 周频插值 → 放水/收水更快。
- **稳定币潮汐进引擎**:现为 side-channel v1,成熟后可进 regime/conviction。
- **L5 去币价噪声**:USD-TVL 含币价,BTC/ETH 计价去噪待做。
- **TG 生命周期推送**:轮动 早期→确认→结构性→衰减 跃迁推送(P-C 监控的"持续监控"半,现仅面板显示)。
- **原始 6h 加速列**、**GT h1 量/txns.h6 字段**真机确认(accel1h 缺失优雅降级)。
- **支持数据/推导**已做到 L5+轮动地图,可照搬到 L3 发射台 / App 收入热度。
- 仓位风险标记详情移到详情行(移动端现仅显示数量)。
- GMGN 本地增强(vibe-trade 用 gmgn-cli,需 key/CLI,**云端不可行**,仅本地);当前标的动态源=GeckoTerminal top3/链。

## 6. 环境坑(新 thread 必看,踩过多次)

- **git push / gh 必须走代理 `127.0.0.1:7897`**(github 直连被墙,代理间歇抽风)。push:`git -c http.proxy=http://127.0.0.1:7897 push origin main`。代理 down 时先让用户挂起来。
- **判断 push/git 成败必须看真实 `$?`,别接 `| tail`/`| grep`**(管道把退出码换成 tail/grep 的,误报成功;已栽两次)。
- **推送前 `fetch → rebase origin/main → push`(分步)**:CI bot 每小时 commit 数据到 main → 本地会落后;本地源改动不碰 public/data(提交前 `git checkout -- public/data/`),故 rebase 无冲突。`pull --rebase` 偶发 "could not detach HEAD"——提交其实完好(HEAD 就是它),`git checkout -- .` 清工作区后单独 rebase。
- **Codex(codex-rescue 子代理)在共享运行时偶发卡死零落盘**:轮询工作区 git status / `~/.codex/sessions` mtime 判断,10 分钟没动就当死掉、**直接手写实现**(本会话大量核心是手写的)。
- **本地 node `fetch` 不走代理(undici)**:GeckoTerminal/OKX 本地直连被重置;探数据用 `curl -x http://127.0.0.1:7897`,或注入 fixture 测试。**runner 直连可达**这些源。
- **路径**:node 把 `/tmp` 解析成 `D:\tmp`;临时文件写仓库根(用完删)或 `curl | node` 走 stdin。
- **本地采集降级**:GT 本地拉不到 → watchlist 沿用上一快照、metrics/持续性显示 `—`/`积累中`,属正常;要看真数据拉线上 `data/cockpit.json`。
- **HelloAGENTS 框架**:用户 CLAUDE.md 有路由协议(R0-R3),但本项目实操是"用户提需求 → 直接干 + 逐项验证 + 提交部署",R2/R3 确认从简。记忆在 `~/.claude/projects/D--trea-proj-exp-dashboard/memory/`(见 MEMORY.md:`proxy-git-gotchas`、`epoch-data-extraction`)。

## 7. 工作纪律

Node 22 / ESM / 零依赖 / 中文 UI / 深色主题 / 所有动态串过 `esc()` / 缺失标 missing 不造 0 / 每次改完 `npm test` 全绿 + `node --check` / 移动端 375-390px 不横向溢出(表格用 `.table-scroll` 内滚)/ 改完提交推送并盯 CI 绿 + 拉线上真实数据目验 / 核心信号逻辑改动写测试锁定 + 记 CHANGELOG。

---

## 开新 thread 的续接 prompt(直接粘贴)

```
继续开发 D:\trea\proj\exp\dashboard —— Node22/ESM/零依赖的静态"资金流向与轮动驾驶舱"(cockpit/v2),
已上线 GitHub Pages(repo qahhaaaa/capital-flow-cockpit,https://qahhaaaa.github.io/capital-flow-cockpit/),
每小时 GitHub Actions 采集+部署。

先读这些再动手(别重读百轮历史):
1. docs/handover-2026-07.md —— 当前状态、核心业务逻辑、环境坑、后续候选(最重要,先读全)
2. .helloagents/CHANGELOG.md 顶部几条 —— 最近改了啥
3. README.md + docs/project-handover.md §11 —— 架构与部署
4. 记忆 MEMORY.md(proxy-git-gotchas / epoch-data-extraction)

硬约束(handover §4/§6/§7):数据诚实(取不到标 missing 绝不用 0;Number(null)=0 是坑)/ 零依赖 /
每次改完 npm test 全绿(现 132)/ 移动端不溢出 / 提交推送必须走代理 127.0.0.1:7897 且
"fetch→rebase origin/main→push"分步、看真实 $? 别接管道 / 本地 node fetch 不走代理(探数据用 curl -x)。

工作方式:用户提需求 → 直接实现(Codex 卡就手写)+ npm test + 起本地预览(preview_* 工具)拉真实数据目验 +
提交推送盯 CI 绿 + 拉线上 data/cockpit.json 复核 → 核心信号改动写测试+记 CHANGELOG。

我接下来想做:<在这里写你的新需求>
```
