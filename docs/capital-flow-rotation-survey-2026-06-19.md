# 加密货币"资金流动与轮动"捕捉方法调研报告（最终核验版）

> 日期: 2026-06-19
> 目标(用户校正后): 捕捉"**钱往哪流、在哪一层、轮动到哪**"——而非交易所订单簿微观结构流动性。
> 五层: ① 宏观放水/收水 ② 链间流动 ③ 发射台流动 ④ DEX↔CEX 流动 ⑤ 主题/叙事轮动。
> 最终用途: 据此对具体标的(链上现货 / CEX 合约)按风险收益**管理仓位**(决策辅助,不自动下单)。
> 产出: 五层"别人怎么做"综述 + 跨层统一框架 + 业界对照 + 本项目 P0/P1 落地建议(带引用)。

---

## 0. 方法与可信度(必读)

由 deep-research 工作流(6 角度 → 30 信源 → 123 论断 → top 25 经 **3 票对抗验证**)+ 人工合成。经多轮续跑,**验证已完整完成**:**18 条确认 / 7 条否决 / 10 条合成 finding**(早期版本因会话限额未跑完层 4/5,本版已补齐)。

**置信度标注**:
- **【✓核验】** 经 3 票对抗验证通过(3-0 或 2-1)——高置信。
- **【◐源实·未核验】** 信源已抓取、口径为业界共识,但未进入本轮 3 票验证(主要是宏观层)——中置信,引用前建议复核。
- **【✗数值存疑】** 能力/看板真实存在(已核验),但其**具体数字**被对抗验证否决——只用其"能力/口径",不引用该数值。

> **本地基线已覆盖**(避免重复):`deep-research-report.md`(宏观三大分数 TGA/稳定币/交易所净流、四状态)、`technical-solution.md`(三大分数、游资迁移、二维矩阵)、`docs/real-data-hot-money-flow-technical-plan.md`(真实数据门槛、链间热钱 proxy)。
> **本报告增量**:净流动性完整口径(WALCL−TGA−RRP)、ETF 流入、**免费桥净流来源及其真实可得性约束**、发射台轮动、主题叙事轮动。
> ⚠️ **实现层关键提醒**:DeFiLlama 的**前端页面**(/bridges/chains、/categories、/stablecoins/chains)对爬虫返回 **403(Cloudflare 反爬,非鉴权)**;但其 **API 端点**(`stablecoins.llama.fi`、`api.llama.fi`)实测可用。**落地一律走 API,不要爬前端**。

---

## 1. 五层"别人怎么做"综述

### 1.1 宏观资金流动性(放水/收水) ◐

**做法**:把"系统里有没有水"做成时间序列,核心是 **净流动性 Net Liquidity = WALCL(Fed 资产负债表) − TGA(财政部账户) − RRP(隔夜逆回购)**,上升=放水/下降=收水。

| 指标 | 口径 | 数据源(免费) | 置信度 |
|---|---|---|---|
| 美联储净流动性 | `WALCL − WTREGEN − RRPONTSYD` | FRED 三序列,免费可程序化 | ◐(公式为业界共识) |
| 全球流动性指数 GLI | Howell/CrossBorderCapital:看资金流**动量/变化率**;加密=最敏感"金丝雀" | 概念框架(指数付费) | ◐([tftc](https://www.tftc.io/global-liquidity-peak-189-trillion-michael-howell-crossborder-capital/)、[lars.cycles](https://lars.cycles.org/p/global-liquidity-bitcoin-cycles-michael-howell-lars-von-thienen)) |
| 稳定币总供给增速 | 加密原生"干火药",供给升先于买盘 | DeFiLlama(免费) | 本地已用 |
| 现货 ETF 净流入 | BTC/ETH 每日净流入=机构增量 | [CoinGlass ETF](https://www.coinglass.com/etf/bitcoin)、Farside、SoSoValue | ◐ |
| M2 / DXY | 货币供给、美元强弱背景 | FRED | 背景 |

**信号化**:Δ净流动性 + 稳定币供给增速 + ETF 净流入,同向上=放水共振。来源:[prereason](https://www.prereason.com/insights/net-liquidity)、[streetstats](https://streetstats.finance/liquidity/fed-balance-sheet)。本地宏观分数(`−ΔTGA+稳定币增速−交易所净流`)**建议补全为完整净流动性(加 RRP/WALCL)+ ETF**。
> 注:宏观层各论断为【◐源实·未核验】(未进入本轮 top-25 验证),但 WALCL−TGA−RRP 与方向为强共识,风险较低。

### 1.2 链间资金流动 ✓

| 指标 | 口径 | 数据源 | 置信度 |
|---|---|---|---|
| **桥净流** | `Net Flow = Deposits − Withdrawals`(24h/7d);DeFiLlama "Bridges Inflows by Chain" 看板列含 24h/7d 净流/流入/流出 | [DeFiLlama /bridges/chains](https://defillama.com/bridges/chains) | **【✓核验 3-0】看板与口径**;某链具体数值(−$804m 等)**【✗存疑 1-2】** |
| **跨链 Flows** | Artemis "Flows":每链 Inflow/Outflow/Netflow,可选周期,覆盖 25+ 链含四链 | [Artemis Flows](https://app.artemis.xyz/flows) | **【✓核验 3-0】** |
| **稳定币按链分布** | 免费 API `stablecoins.llama.fi/stablecoinchains`(**实测 HTTP 200、201 链、聚合 ~$309B**);份额变化率=比"桥 proxy"更干净的迁移信号 | [DeFiLlama stablecoins/chains](https://defillama.com/stablecoins/chains) | **【✓核验 3-0 + 实测可用】** |
| 稳定币集中度(现状) | ETH ~51% + Tron ~29% ≈两链占 80%;SOL #3 ~$14.8B、BSC #4 ~$14.2B、Base #6 ~$4.85B | 同上 | **【✓核验 3-0】** |
| 链级 TVL/DEX 份额轮动 | 各链 TVL/DEX 成交占比变化 | [DeFiLlama /chains](https://defillama.com/chains) | 能力成立(项目已用);**453链/ETH53%/$73.4B 数值【✗存疑 0-3】** |

> **纠正项目既有认知**:项目记着"真实桥净流取不到(`bridges.llama.fi` 返回 402 付费)"。**桥净流看板(DeFiLlama / Artemis)免费可见且口径已核验**——但**程序化免费可得性有真实约束**:DeFiLlama 前端 403 反爬、公开 `bridges.llama.fi` 现需付费档、Artemis `app.artemis.xyz/flows` 已 308 跳转 classic 且 JS 渲染(WebFetch 取不到,需浏览器或 API key)。→ **稳定币按链分布(`stablecoinchains` API 实测可用)是当前最可靠的免费链间迁移源**;真实桥净流的免费程序化采集列 P1 实测(见 §4)。

### 1.3 发射台(launchpad)资金流动 ✓

| 指标 | 口径 | 数据源 | 置信度 |
|---|---|---|---|
| 发射台收入/费用排名 | DeFiLlama 把各台收入分开计,pump.fun / BONK.fun(LetsBonk) / four.meme 份额可直接对比 | [DeFiLlama launchpad/solana](https://defillama.com/protocols/launchpad/solana) | **【✓核验 3-0】能力**;**pump 占 89% 等占比【✗存疑 0-3】** |
| 单台收入时间序列 | pump.fun 累计收入 ~$10.45 亿(2026-05,首个破$1B 的 Solana 应用);日峰值 ~$1588 万(2025-01-24) | [Dune adam_tehc/pumpfun](https://dune.com/adam_tehc/pumpfun) | **【✓核验 3-0】** |
| four.meme(BSC)收入 | DeFiLlama 可查:累计费 ~$95.99M ≈ 累计收入 ~$94.58M(费≈收入,几乎全留协议) | [DeFiLlama four.meme](https://defillama.com/protocol/four.meme) | **【✓核验 3-0】**;**Q4'25 >12x 跃升具体值【✗存疑 1-2】** |
| 份额轮动叙事 | pump.fun vs LetsBonk 王座反复易手;pump 重夺榜首、日均 ~$1M 新发行 | [TheBlock 1](https://www.theblock.co/post/367266/solana-memecoin-launchpad-war-flips-again-as-pump-takes-top-spot-amid-letsbonk-collapse)、[TheBlock 2](https://www.theblock.co/post/375352/pump-fun-dominates-token-launches-1-million-daily-despite-market-slowdown) | 二手佐证 |
| 毕业率/bonding curve/SOL投入 | 方向合理但**各看板口径/分母不统一** | Dune、GeckoTerminal、Birdeye | 缺口 |

> 注:DeFiLlama 把 pump.fun 归类 'Dexs' 而非 'Launchpad',但各自 fees 页可比。**"发射台资金轮动"是用户新加的层**,用 DeFiLlama launchpad 收入(免费)可直接起步。

### 1.4 DEX↔CEX 资金流动 ✓

| 指标 | 口径 | 数据源 | 置信度 |
|---|---|---|---|
| **交易所净流** | `Netflow = Inflow − Outflow`(链上充值/提现到交易所钱包,**非订单簿**);流入↑偏空(待卖/上杠杆)、流出↑偏多(转冷存储) | [CryptoQuant 文档](https://userguide.cryptoquant.com/cryptoquant-metrics/exchange/exchange-in-outflow-and-netflow) | **【✓核验】定义/公式 3-0;方向读法 2-1** |
| OI / 资金费率 / perp-spot 量比 | "钱跑去合约"= OI↑ + 现货平 + funding 偏高 | [期货指标](https://medium.com/@cryptocreddy/comprehensive-guide-to-crypto-futures-indicators-f88d7da0c1b5)、OKX/Binance 公开接口 | 项目已部分有(OKX ticker) |
| 杠杆开/平 | 杠杆头寸开/平辨识衍生品资金进出 | [Glassnode leverage](https://insights.glassnode.com/leverage-position-openings-and-closures/) | 佐证 |
| 稳定币 CEX 余额 vs 链上 | 稳定币在交易所余额变化=资金待命位置 | [CryptoQuant 稳定币流](https://cryptoquant.com/asset/stablecoin/chart/exchange-flows) | 缺口(免费档有限) |

> 边界:净流为机械信号,有 OTC/托管/抵押品误归因等限制(方向读法 2-1,反对方仅质疑机械可靠性,不否认 CryptoQuant 如此定义)。"钱跑去合约了,看 OI/指数"——@gongyue777(本地转引)。项目已有 OKX 现货/合约 ticker,**缺 OI/funding/真实交易所净流**。

### 1.5 主题/叙事轮动 ✓

| 指标 | 口径 | 数据源 | 置信度 |
|---|---|---|---|
| **板块 TVL 轮动** | DeFiLlama /categories:各板块 Combined TVL + **1d/7d/1m 变化** + 24h 收入;板块间分化=资金轮动 | [DeFiLlama /categories](https://defillama.com/categories) | **【✓核验】列结构 3-0;数值示例 2-1** |
| **链上因子 + 活动监控** | Artemis 用链上基本面(DAU/费用增速/收入稳定性/MC-Fees)构因子;2026-05 基本面因子 +8.7% 跑赢动量 −7.9%;Activity Monitor 按板块(DeFi/Gaming/DePIN/RWA…)分用户行为 | [Artemis 因子](https://research.artemis.ai/p/artemis-crypto-factor-model-analysis-820)、[Artemis sectors](https://app.artemis.xyz/sectors) | **【✓核验】因子 3-0;Activity Monitor 3-0;17 类专有分类法【✗存疑 1-2】;稳定币因子 Sharpe 0.37【✗存疑 1-2】** |
| **mindshare/注意力** | Kaito:索引社媒/治理论坛/Farcaster/Telegram 等;营销"系统追踪叙事轮动/早期识别新兴叙事" | [Kaito docs](https://docs.kaito.ai/overview/kaito-pro-ai-platform) | **【✓核验】多源索引 3-0、叙事轮动能力 3-0**;但 mindshare **可操纵**(见下),Token/Narrative Mindshare 具体指标【✗存疑 1-2】→ medium |
| 叙事收益复盘 | 历史最赚钱叙事复盘 | [CoinGecko narratives](https://www.coingecko.com/research/publications/most-profitable-crypto-narratives) | 二手 |

> ⚠️ **Kaito mindshare 可操纵**:被多方指可被 engagement farming/刷量/OTC 投票博弈,且 mindshare≠协议价值(例 Loud FDV $30M→$1.4M)。落地时把 mindshare 当"**可操纵的注意力代理**",不可当真金白银流入。
> ⚠️ **USD-TVL 含币价噪声**:板块 TVL 的 USD 变化混入币价波动,作相对强弱时**应配 ETH/BTC 计价或净流去噪**。
> **"主题轮动"是项目当前完全缺失的层**,DeFiLlama /categories(免费 API)可直接起步。

---

## 2. 跨层统一框架:"钱在哪一层、往哪流、轮动到哪" ◐

```
宏观(放水/收水) ──决定总水量──┐
   ↓                            │
链间(SOL/Base/ETH/BSC 净流)    │  每层输出: 方向 + 强度 + 置信度
   ↓ 哪条链承接                  │  (置信度受免费数据缺口约束)
发射台(打新资金在哪个台子)        │
   ↓ 链内最投机的增量            │
DEX↔CEX(现货 vs 合约)  ←────────┘  钱在链上现货 or CEX 合约
   ↕
主题/叙事轮动(横切各层: AI/meme/RWA/DeFi/DePIN…)
```

**判断逻辑**(沿用本地 `real-data` §5.2 "多方向一致才升级"):
- **共振做多**:宏观放水 + 某链净流入 + 该链发射台升温 + 资金从合约回流现货 + 对应叙事 mindshare 上升 → 高置信顺风。
- **背离/警惕**:宏观收水;或只有合约 OI 拥挤而现货/稳定币没跟上("钱只在合约空转")→ 低置信。
- **每条结论必带**:方向(从哪到哪)+ 强度(动量分位)+ 置信度(数据齐否、是 proxy 还是真净流)。
> 框架组件均已核验(桥净流/稳定币分布/发射台收入/交易所净流/板块 TVL 各 3-0);但"跨层综合逻辑"为方法论合成 + X 实战二手转引,故整体置 ◐。开源 [Day1 Global Briefing]、[awesome-crypto-trackers](https://github.com/denisnazarov/awesome-crypto-trackers)、[walletfinder "chain of markets"](https://www.walletfinder.ai/blog/chain-of-markets) 是"宏观+链上+情绪面板化"的实践参考。

---

## 3. 业界产品 / 开源 / 推特对照

| 层 | 代表 | 免费可得性 |
|---|---|---|
| 宏观 | FRED(净流动性原料,免费)、Howell GLI(付费)、Arthur Hayes/Raoul Pal 框架、CoinGlass ETF(免费) | FRED/ETF 免费 |
| 链间 | **DeFiLlama stablecoinchains API(免费实测可用)**、DeFiLlama/Artemis 桥净流看板(免费看,程序化受限)、Token Terminal | 见 §1.2 约束 |
| 发射台 | **DeFiLlama launchpad(免费)**、Dune(pump/four.meme 看板)、GeckoTerminal、Birdeye | DeFiLlama/Dune 免费 |
| DEX↔CEX | CryptoQuant、Glassnode、Nansen、OKX/Binance 公开接口 | 交易所接口免费;数据商免费档有限 |
| 叙事轮动 | **DeFiLlama /categories API(免费)**、Artemis sectors、Kaito(mindshare,付费/可操纵) | DeFiLlama 免费 |
| 跨层/工具 | 开源 Day1 Global Briefing、awesome-crypto-trackers、walletfinder | 开源/免费 |
| 推特实战 | @gongyue777("钱跑合约了,看 OI/指数")等(本地转引,X 原文未独立核验) | — |

---

## 4. 回到本项目:五层 P0/P1 落地建议

> 约束:免费/可验证、四链 SOL/Base/ETH/BSC、现有栈 DeFiLlama/OKX/GMGN/Dune、上限 watch_only。
> 标注:**[已有]** 已实现 / **[补全]** 已有需扩展 / **[新增]** 当前缺失。门控沿用:取不到→null/partial、不入主分、标数据质量。
> 实现统一走 **API 端点**(`stablecoins.llama.fi`/`api.llama.fi`),不爬前端(403)。

### P0(免费、已核验源、直接落地)
1. **[新增] 发射台轮动**:接 DeFiLlama launchpad 收入(pump.fun / BONK.fun / four.meme)做**份额 + 收入动量**——判断打新资金在哪个台子升温。【✓核验源】
2. **[新增] 叙事轮动**:接 DeFiLlama `/categories`(API)板块 Combined TVL + 1d/7d/1m 变化做**相对强弱**(配 ETH/BTC 计价去噪)。【✓核验源】
3. **[补全] 链间稳定币迁移**:接 `stablecoins.llama.fi/stablecoinchains`(**实测可用**)做四链稳定币**份额变化率**——比现有桥 proxy 更干净。【✓核验+实测】
4. **[补全] 宏观净流动性**:现有宏观分数补全为 FRED `WALCL − WTREGEN − RRPONTSYD` 完整净流动性 + BTC/ETH ETF 净流入。免费。
5. **[补全] DEX↔CEX 结构**:现有 OKX ticker 上补 OI + 资金费率 + perp/spot 量比,实现"钱跑去合约"信号。免费。

### P1(需实测可得性 / 有缺口)
6. **[补全] 真实桥净流**:实测 DeFiLlama 桥的可用 API 档 / Artemis 免费档程序化可得性(前端 403 + bridges.llama.fi 付费 + Artemis JS 渲染)→ 可得则替代稳定币桥 proxy;不可得则继续用 #3 稳定币迁移代理。
7. **[新增] 交易所净流**:CryptoQuant/Glassnode 免费档有限 → 先用"稳定币 CEX 余额 vs 链上"代理,标缺口。
8. **[补全] 发射台毕业率/bonding curve**:需 Dune 固定 query 或 GeckoTerminal/Birdeye;口径不统一→列专项。
9. **[新增] mindshare/叙事注意力**:Kaito 多付费且可操纵 → 先用 GMGN 热门代币 + 社媒辅助代理,标缺口与可操纵性。

### 与"仓位管理"目标的衔接(下一步)
五层信号 = **顺风/逆风方向 + 强度 + 置信度**;仓位层把它映射到标的:
- **链上现货标的**:顺风层数 + 该链/发射台资金净增越强 → 提高 conviction;受**出场流动性**约束(小盘留滑点余量)。例:某新发射台存量资金持续净增 → 上涨概率偏大 → 小仓试探(用户原话场景)。
- **CEX 合约标的**:叠加 funding/OI 拥挤度做**反向约束**(拥挤时降杠杆)。
- 输出**仓位建议/置信度,不自动下单**(守 watch_only→trade_assist 边界)。

---

## 5. 关键发现 · 缺口 · 边界

**关键发现**
- **桥净流不全是付费**,但有真实约束:看板免费、口径已核验,然而程序化免费采集受限(前端 403、bridges.llama.fi 付费、Artemis JS/308)。**稳定币按链分布 API(实测可用)是当前最稳的免费链间迁移源**。
- **发射台 + 叙事两层有免费一手 API**(DeFiLlama launchpad / categories),是项目最易补的两个新层。
- 各层"能力/口径"均已核验,但**具体数值多为时点快照、且部分被对抗验证否决**(见下),信号用"变化率/相对强弱",不绑死绝对数。

**被对抗验证否决的具体数值(只用能力,不引用数字)**
- /chains "453 链 / ETH 53% / 总$73.4B"(0-3);pump.fun 占 Solana launchpad 30d 费 "~89%"(0-3);某链桥 7d 净流 "−$804m" 等(1-2);four.meme "Q4'25 $54.24M vs Q3 $4.46M >12x"(1-2,费≈收入结论仍成立);Artemis 稳定币因子 "Sharpe 0.37"(1-2);Kaito "Token/Narrative Mindshare" 量化指标(1-2,叙事轮动能力本身成立);Artemis "17 类专有分类法"(1-2,按板块分段能力成立)。

**边界**
1. **宏观层(§1.1)未进入 3 票验证**(基于源 + 共识 + 本地基线),为 ◐;WALCL−TGA−RRP / Netflow=Inflow−Outflow 为强共识,风险低。
2. **时间敏感**:所有 TVL/收入/净流/稳定币数值为 2026-06 时点快照,日内漂移实测 0.2%–1.3%;USD-TVL 含币价噪声(配 ETH/BTC 计价或净流)。
3. **数据可得性需实现时实测**:DeFiLlama 前端 403(用 API)、Artemis JS 渲染/308(需浏览器或 key)、Kaito/CryptoQuant 免费档有限。
4. **X/Twitter 实战(@gongyue777 等)为本地二手转引**,未对 X 原文独立核验;Kaito mindshare 可操纵。

**开放问题(后续专项)**
1. DeFiLlama 桥 / Artemis Flows 是否有**稳定免费的程序化接口**?(决定能否真正补全真实桥净流)
2. 四链发射台**毕业率/bonding curve**的免费、跨台可比、可验证统一口径?
3. 交易所净流在不付费下能否用"稳定币 CEX 余额 vs 链上"做足够可靠的免费代理?偏差多大?
4. **"五层信号 → 风险收益 → 仓位"的映射规则与阈值**(分数 Kelly / 波动目标 / conviction 分档;链上现货 vs CEX 合约分别定)——**用户最终目标**,本轮只覆盖信号层,映射规则需单独设计/研究。

---

## 附录:信源清单(按层 · 含质量)

- **宏观**: [prereason 净流动性](https://www.prereason.com/insights/net-liquidity)(blog)、[streetstats Fed 表](https://streetstats.finance/liquidity/fed-balance-sheet)、[tftc GLI/Howell](https://www.tftc.io/global-liquidity-peak-189-trillion-michael-howell-crossborder-capital/)、[lars.cycles GLI](https://lars.cycles.org/p/global-liquidity-bitcoin-cycles-michael-howell-lars-von-thienen)、[CoinGlass ETF](https://www.coinglass.com/etf/bitcoin)
- **链间**: [DeFiLlama bridges/chains](https://defillama.com/bridges/chains)【✓】、[Artemis Flows](https://app.artemis.xyz/flows)【✓】、[DeFiLlama stablecoins/chains](https://defillama.com/stablecoins/chains)【✓实测】、[DeFiLlama /chains](https://defillama.com/chains)、[deBridge 指南](https://debridge.com/learn/guides/top-8-best-cross-chain-bridges/)、[MEXC](https://www.mexc.com/news/1079881)
- **发射台**: [DeFiLlama launchpad/solana](https://defillama.com/protocols/launchpad/solana)【✓】、[Dune pump.fun](https://dune.com/adam_tehc/pumpfun)【✓】、[DeFiLlama four.meme](https://defillama.com/protocol/four.meme)【✓】、[TheBlock 1](https://www.theblock.co/post/367266/solana-memecoin-launchpad-war-flips-again-as-pump-takes-top-spot-amid-letsbonk-collapse)、[TheBlock 2](https://www.theblock.co/post/375352/pump-fun-dominates-token-launches-1-million-daily-despite-market-slowdown)
- **DEX↔CEX**: [CryptoQuant 交易所流](https://userguide.cryptoquant.com/cryptoquant-metrics/exchange/exchange-in-outflow-and-netflow)【✓】、[期货指标](https://medium.com/@cryptocreddy/comprehensive-guide-to-crypto-futures-indicators-f88d7da0c1b5)、[Glassnode 杠杆](https://insights.glassnode.com/leverage-position-openings-and-closures/)、[CryptoQuant 稳定币流](https://cryptoquant.com/asset/stablecoin/chart/exchange-flows)
- **叙事轮动**: [DeFiLlama /categories](https://defillama.com/categories)【✓】、[Artemis 因子](https://research.artemis.ai/p/artemis-crypto-factor-model-analysis-820)【✓】、[Artemis sectors](https://app.artemis.xyz/sectors)【✓】、[Kaito docs](https://docs.kaito.ai/overview/kaito-pro-ai-platform)【✓/可操纵】、[CoinGecko narratives](https://www.coingecko.com/research/publications/most-profitable-crypto-narratives)
- **跨层/工具**: [awesome-crypto-trackers](https://github.com/denisnazarov/awesome-crypto-trackers)、[walletfinder chain of markets](https://www.walletfinder.ai/blog/chain-of-markets)、[CryptoQuant 链上流动性](https://cryptoquant.com/insights/quicktake/69791015cbe161236f13a162-How-to-Read-On-Chain-Liquidity-Interpreting-ERC20-Stablecoin-Supply-and-Exchange)
- **本地基线**: `dashboard/deep-research-report.md`、`dashboard/technical-solution.md`、`dashboard/docs/real-data-hot-money-flow-technical-plan.md`

> 统计: 6 角度 / 30 信源 / 123 论断 / 25 验证 / **18 确认 / 7 否决 / 10 合成**。
