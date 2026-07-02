# 资金流向与轮动驾驶舱 (Capital Flow & Rotation Cockpit)

跟着钱走(follow the money)的本地优先、免费数据面板:把加密资金的流动拆成**五层**捕捉,再合成为**对具体标的的仓位建议**。

> **仅决策辅助,不自动下单**;真实交易由用户手动执行。

- **目标**:回答「钱现在在哪一层、往哪流、轮动到哪」+「据此对某标的(链上现货 / CEX 合约)该不该上、上多少」。
- **不是**:订单簿微观结构流动性(spread/深度/滑点),也不是旧的"链上活跃度分数"面板(已退役,见 `_legacy/`)。
- **完整规格见 [docs/PRD-capital-flow-cockpit.md](docs/PRD-capital-flow-cockpit.md)**;调研依据见 [docs/capital-flow-rotation-survey-2026-06-19.md](docs/capital-flow-rotation-survey-2026-06-19.md)。

## 五层(均免费、走 API 不爬前端)

| 层 | 含义 | 免费数据源 | 状态 |
|---|---|---|---|
| L1 宏观 | 放水/收水(净流动性) | FRED `WALCL−TGA−RRP`(无 key) | ✅ |
| L2 链间 | 资金在 SOL/Base/ETH/BSC 间迁移 | `stablecoins.llama.fi/stablecoinchains`(稳定币份额变化) | ✅ |
| L3 发射台 | 打新资金在哪个台子升温 | `api.llama.fi/overview/fees`(pump.fun / BONK.fun / four.meme 收入) | ✅ |
| L4 DEX↔CEX | 钱在链上现货还是 CEX 合约 + 拥挤度 | OKX 衍生品(OI/funding/perp-spot);OKX 不可达时自动回退 Hyperliquid(免 key,仅 perp 腿 → 层标 partial) | ✅(双源回退) |
| L5 主题轮动 | 资金在哪个板块/叙事 | `api.llama.fi/protocols`(按 category 聚合 TVL 动量) | ✅ |

引擎按「各层方向×强度×置信度 → conviction → 仓位档(空仓/试探/小仓/标准)」给建议,受**宏观 regime 闸门**(收水期压制并封顶)、链上出场流动性、合约 funding/OI 拥挤等**风险降档**约束。

## 辅助信号: App 收入热度

`appRevenueHeat` 是 cockpit/v2 顶层 side-channel,来源为 DeFiLlama 每条链的协议 24h revenue 排名。它只表示**活动热度 / 确认维度**,不是流动性、不是资金净流入,也不进入五层 `layers`、`flowState`、`guidance` 或 conviction 计算。

缺失链数据保持 `missing`/`partial`,不以 0 代替。若单一协议 24h 收入占某链 >60%,面板会标记 `singleAppSpike`,提示该热度可能由单点应用主导。

## 辅助信号: 稳定币总量潮汐

`stableTide` 是另一个旁路 side-channel:全局稳定币总市值的动量(24h/7d 时间锚定变化 + 快慢 EMA 缺口 + CUSUM 拐点警报)。链间份额只反映**池内轮动**(份额恒和 100%),总量潮汐反映**钱进出 crypto 这个池子本身**。v1 仅展示与推送,不进五层引擎/conviction;历史自 2026-07-03 起积累(旧点无此字段=诚实缺失)。

## 快速开始(Node.js 22+,无第三方依赖)

```bash
npm test            # 单元测试(纯函数 + 契约 + provider 解析)
npm run collect     # 采集一次 → public/data/cockpit.json
npm run serve       # 启动服务(默认 :4173),启动即采集,之后每 4h 自动采集
```

打开 `http://localhost:4173/`。端口占用时 `PORT=4181 npm run serve`。

## 数据诚实原则

任一源失败/取不到 → 该层标 `missing`/`partial`,**绝不用 0 冒充**,不污染其余层与总判断;每个信号显式带置信度与数据质量。交易可用等级上限 `watch_only`(信号增强,仍不自动下单)。

## 历史与"点亮"

链间轮动 / 百分位强度需要**滚动历史**:`npm run serve` 进程**常驻时自身每 1h 采一个点**(GitHub Actions 部署同为每小时)。链流 delta 按**真实时间 4h 锚定**(与采集频率解耦):方向需序列跨度 ≥4h,强度/`ok` 需 ≥8 个锚定 delta 且覆盖 ≥24h;历史上限 720 点 ≈ 30 天。采集间隔在 `src/config.mjs` 的 `REFRESH.intervalHours`。

## 架构

```
src/cockpit/
  stats.mjs / envelope.mjs        # 滚动百分位/z + 指标信封
  layers/{macro,chain-flow,launchpad,narrative,dexcex}.mjs   # 五层 normalize + signal
  layers/app-revenue.mjs          # 顶层辅助收入热度,不进入五层引擎
  providers/{macro,stablecoins,launchpad,narrative,dexcex}.mjs # 数据采集(fetch 可注入,便于离线测试)
  providers/app-revenue.mjs       # DeFiLlama chain fees side-channel
  engine.mjs                      # computeFlowState + computePositionGuidance
  contract.mjs                    # 组装 cockpit/v2 → public/data/cockpit.json
  history.mjs                     # 滚动历史(份额序列)
scripts/{collect-cockpit,serve-cockpit}.mjs
public/{index.html,main.js}       # 前端(纯静态,无构建)
```

## 已知缺口 / P1(均诚实标注,非阻塞)

- **真实桥净流**:DeFiLlama 桥端点实测(2026-06-19)仍 **402 付费**,Artemis 需 key/JS 渲染 → 暂以 **L2 稳定币份额变化**作免费代理。
- **交易所净流**:无干净免费源(CryptoQuant/Glassnode/Nansen 付费;DeFiLlama 同类 402)→ 现实代理 = L4 的 OKX 现货/合约+funding(网络可达时),真净流需付费源。
- **OKX 不可达时** → L4 自动回退 Hyperliquid(免 key、不封美区;仅 perp 腿,funding 小时率×8 对齐 OKX 8h 口径,层标 partial);两者都失败才 missing。
- **watchlist** 现为占位(WIF/AERO/BNB-PERP),`scripts/collect-cockpit.mjs` 里 `DEFAULT_WATCHLIST` 可改;需用户配置入口。
- 主题层 USD-TVL 含币价噪声,BTC/ETH 计价去噪为后续;发射台毕业率/bonding curve、mindshare 为 P1。

## 部署

生产部署走 **GitHub Actions + Pages**(`.github/workflows/collect-and-deploy.yml`):每小时第 17 分采集 → 数据 commit 回 main 累积历史 → 部署 `public/`。可选 Telegram 状态变化推送:配置 `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` 两个 repo secret 即启用(缺省静默跳过)。`vercel.json` 仍可用作备选静态部署。

---
旧 v1 面板(链上活跃度分数)已归档至 `_legacy/`(本仓库非 git,故保留可恢复)。
