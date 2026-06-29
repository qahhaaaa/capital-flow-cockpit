# 加密货币一级/二级市场流动性衡量方法调研报告

> 日期: 2026-06-18
> 目标: 调研"别人(数据商/学术界/量化从业者/开源面板/推特KOL)一般怎么衡量加密一级与二级市场流动性",并回到本项目(`dashboard/`)给出落地建议。
> 口径要求(用户确认): **两套口径都覆盖 + 显式映射**;产出形态 = **综述 + 本项目落地建议**。

---

## 0. 方法与可信度(必读)

本报告由 deep-research 工作流产出并经人工合成:

- **流程**: 5 个检索角度 → 并行 WebSearch → 抓取 **25 个信源** → 提取 **113 条可证伪论断** → 对 top 25 做 **3 票对抗式验证**(≥2 票反驳即否决) → 合成。
- **结果**: **23 条确认 / 2 条否决 / 13 条合成 finding**;另有抓取但未进入 top-25 验证的论断(主要是一级打新方向)。
- **本地基线对照**(避免重复造轮子): `dashboard/deep-research-report.md`、`dashboard/technical-solution.md`、`dashboard/docs/real-data-hot-money-flow-technical-plan.md`。
- **置信度标注**: 🟢高(多个一手源/全票)、🟡中(二手源/分票/工程综合判断)、🔴低(无核验一手源支撑)。

> ⚠️ **最大缺口先说**: "金融标准一级市场 = 新币发行/打新(launchpad 毕业率、bonding curve、首日深度、vesting)" 的衡量方法,本轮 23 条核验 claim **无一覆盖**(全部集中在二级微观结构)。第 3 节为已抓取来源 + 业界通行做法的**方向性综述,置信度🔴低,需专项研究**。

---

## 1. 双口径术语澄清与映射表 🟢

这是全报告最关键的一条:**本项目的"一级/二级"与金融通用语义指向完全不同的对象,不可混用。**

| 维度 | 金融标准口径 | 本项目(`dashboard/`)口径 | 在金融标准里实际属于 |
|---|---|---|---|
| **一级市场** | 新代币**发行/打新**:launchpad、IDO/ICO/IEO、bonding curve、TGE、初始 LP | "**链上**流动性环境":DEX volume / TVL / 稳定币供给 / 桥入代理(SOL/Base/ETH/BSC) | **二级市场**(已上市代币的链上 DEX 交易) |
| **二级市场** | **已上市代币交易**:CEX 订单簿 + DEX/AMM 池 | "**CEX** 交易活跃度":OKX/Binance 现货+合约成交、OI、资金费率、perp/spot 比 | **二级市场**(CEX 部分) |

**核心结论**:
- 本项目的"一级链上",在金融标准里其实是**二级市场的链上(DEX)部分**;本项目的"二级 CEX"也属金融二级市场。
- **真正金融意义的"一级(发行/打新)"在现有面板中基本缺位**——这正是若要"补齐一级市场流动性衡量"的真实工作量所在。
- 依据: 本项目文档(`technical-solution.md` §1-2、`deep-research-report.md` 执行摘要) vs S&P Global 定义(见 §2.1)。

**落地建议(术语)**: 在 UI/文档显式区分三层,避免用户误读:
1. **链上(on-chain)流动性** ← 现"一级"
2. **CEX 流动性** ← 现"二级"
3. **发行/打新(primary issuance)流动性** ← 金融真正的一级,当前缺位,需新增

---

## 2. 二级市场(交易)流动性衡量方法综述

### 2.1 数据商商用口径(Kaiko / Coin Metrics / Amberdata)🟢

三家把流动性做成**可售卖的标准化指标**,口径高度一致,且与 **S&P Global**"流动性 = 资产以低成本、无显著价格错位快速变现为法币/稳定币的能力"的定义吻合。

| 指标 | 标准定义 | 公式 / 档位 | 数据商口径 |
|---|---|---|---|
| **市场深度 (market depth)** | 距参考价(中间价或最优买卖价)一组固定**百分比/基点档位**内累计的挂单量,分买卖方向;**越深 = 流动性越好** | Kaiko: 0.1%/0.2%…1%/1.5%/**2%**/4%/6%/8%/10%(字段 `bid_volume_x`/`ask_volume_x`);Amberdata: **10/50/100bps**(100bps=1%) | 以"**距价 X% 的可成交量**"度量,**不是绝对 TVL** |
| **买卖价差 (bid-ask spread)** | 最高买价与最低卖价之差,通常以占中间价的百分比表示;**越小 = 越好** | `(Ask − Bid) / ((Ask+Bid)/2)` | Coin Metrics 产品化为 `bid_ask_spread_percent` 的 **1m/1h/1d** 三粒度(各为区间均值) |
| **滑点 / 价格冲击曲线 (slippage)** | 预期成交价(基于当前订单簿)与实际执行价之差,**分方向、对一组美元规模分别算 → 整条曲线** | `滑点% = (|P_exec − P_mid| / P_mid) × 100`,`P_exec` = 吃单成交的 VWAP | Coin Metrics: **$1K–$1M 共 21 档 × 买卖双向 = 42 个指标**;Kaiko: `ask_slippage`/`bid_slippage`,参考价 `mid_price`(默认)或 `best` |

**⚠️ 关键警示(🟢, 3-0)**: **Kaiko 明确弃用"2% 深度"单一档作为主指标**,因为它是 CoinGecko 上展示的档位,**最容易被刷量操纵**。→ 本项目若做深度,应以 **0.1% / 1%** 为主档,2% 仅作展示。

来源: [Kaiko REST 文档](https://docs.kaiko.com/rest-api/data-feeds/level-1-and-level-2-data/level-2-aggregations/raw-order-book-snapshot/raw-order-book-snapshot-+-market-depth-bid-ask-spread-and-price-slippage)、[Kaiko CEX 流动性方法论](https://www.kaiko.com/resources/understanding-centralized-exchange-liquidity-data)、[Coin Metrics slippage](https://gitbook-docs.coinmetrics.io/market-data/market-data-overview/liquidity/slippage)、[Coin Metrics spread](https://gitbook-docs.coinmetrics.io/market-data/market-data-overview/liquidity/bid-ask-spread)、[Amberdata order book depth](https://docs.amberdata.io/data-dictionary/analytics/spot/order-book-depth)、[S&P Global](https://www.spglobal.com/en/research-insights/special-reports/liquidity-demographics-for-crypto-asset-trading)。

### 2.2 学术微观结构口径(有明确公式)🟢

Easley / O'Hara / Yang / Zhang《Microstructure and Market Dynamics in Crypto Markets》(SSRN 4814346, 2024, 后发于 *Journal of Financial Markets*)给出**五个标准指标**:

| 指标 | 公式 | 度量什么 |
|---|---|---|
| **Amihud illiquidity** | `(1/W)·Σ |r_i| / (p_i·V_i)` | 价格冲击 / 流动性**水平** |
| **Kyle's λ** | `(p_t − p_{t−W}) / Σ b_i·V_i` | 价格冲击 / **逆向选择**系数 |
| **Roll** | `2·√|cov(ΔP_t, ΔP_{t−1})|` | 隐含买卖价差 |
| **Roll impact** | `Roll / (p_t·V_t)` | 单位成交的价差冲击 |
| **VPIN** | `(1/W)·Σ |V_i^S − V_i^B| / V_i` | **订单流毒性 / 知情交易**代理 |

**实测对比(🟢, 3-0)**: 加密(BTC/ETH/XRP/SOL/ADA on Binance)平均 **VPIN ≈ 0.45–0.47**,而传统期货(E-mini 标普500、原油, ELO 2012)仅 **0.22–0.23**(闪崩峰值约 0.8)。→ **加密二级市场逆向选择/信息不对称显著更强**;对"流动性状态/拥挤度"信号设计的直接启示:**VPIN 高的时点应判定为流动性更脆弱**。

**实操选型结论(🟢, Brauneis 等《How to measure the liquidity of cryptocurrency markets?》JBF 2021)**:
- 加密**无受监管的合并行情(无 NBBO/SIP 等价物)**,交易所/辖区众多 → 高频价差难算、跨场所难比较 → **低频流动性代理(从价量计算)是刚需**。
- **按目的分别择优**(关键!):
  - 估流动性"**水平 / 执行成本**" → **Amihud(2002)** + **Kyle-Obizhaeva(2016, σ÷成交量)** 最贴近高频基准;
  - 捕流动性"**时序变化 / 何时择时进出**" → **Corwin-Schultz(2012)** + **Abdi-Ranaldo(2017)** 高低价价差估计量,"在所有频率/场所/基准/币种上表现最佳"。

> 🔴 **边界(被对抗验证否决, 0-3)**: "低频代理可靠估计高频流动性并大幅省成本"这一**更强的概括被否决**。→ 应保守表述为"**按目的择优**",**不可宣称低频普遍替代高频**。(另: Corwin-Schultz 对 BTC 好但对 ETH 弱,主要靠 Abdi-Ranaldo。)

来源: [Easley et al. SSRN 4814346](https://stoye.economics.cornell.edu/docs/Easley_ssrn-4814346.pdf)、[Brauneis et al. JBF 2021](https://www.sciencedirect.com/science/article/pii/S0378426620303022)。

### 2.3 DEX / AMM 流动性(可量化,且能对标 CEX)🟢

- **Uniswap 官方开源方法 [v3-market-depth-study](https://github.com/Uniswap/v3-market-depth-study)**(GPL-3.0):从 v3 **集中流动性的 tick 级 liquidity 分布**重建"**realized depth at ±X%**"(如 ±2%),**直接对标 CEX 订单簿深度**。
  - 口径: `市场深度 = 价格相对当前价偏移 ±X% 区间内可成交的流动性金额`(即价格冲击百分位),**而非用 TVL 近似**。
  - 算法: `x_js = L_js/√p_a − L_js/√p_b`,按 tick spacing(默认 60)聚合,从 mint/burn 事件回溯重建历史分布。
  - **重要**: 证明 **TVL ≠ 可成交深度**。([Uniswap 博客](https://blog.uniswap.org/uniswap-v3-dominance))
  - caveat: realized depth 为**快照口径**,JIT 流动性可能低估执行深度;结果按交易对而异(ETH 对胜出,小盘币逊于 CEX)。
- **LVR (loss-versus-rebalancing)**:AMM 做市对 LP 的流动性成本的**统一解析框架**("AMM 版 Black-Scholes"闭式解, Milionis et al, [arXiv 2208.06046](https://arxiv.org/abs/2208.06046))。
  - 瞬时 LVR: `ℓ(σ,P) = (σ²P²/2)·|x'(P)|`;定义 = AMM 头寸价值与"以外部市场价执行相同交易的再平衡组合"之差(刻画链上陈旧价被套利者"挑单"的损失)。
  - 实证算法([arXiv 2404.05803](https://arxiv.org/html/2404.05803v1)):按以太坊每个区块时间戳同步 Binance 价,扣费后边际价偏离即模拟套利、复利施损。
  - 🔴 **边界(被否决, 1-2)**: "LVR 是 AMM LP **首要/canonical** 逆向选择成本指标"被否决。→ 应表述为**统一解析框架之一**,非唯一/首要;闭式等价精确成立于连续时间无费理想情形。

---

## 3. 一级市场(发行/打新)流动性衡量 — ⚠️最大缺口 + 方向性综述 🔴

> **置信度🔴低**: 本轮 23 条核验 claim 无一覆盖此维度。以下为**已抓取来源 + 业界通行做法**的方向性整理,**未经对抗核验**,引用需谨慎,建议作为后续专项 deep-research 对象。

### 3.1 链上打新(launchpad / memecoin)

常见衡量方向(来自 [CoinGecko bonding curve 指南](https://www.coingecko.com/learn/get-bonding-curve-data-from-memecoin-launchpads-using-python)、[Cointelegraph: LetsBonk 超越 pump.fun(DeFiLlama 数据)](https://cointelegraph.com/news/letsbonk-surpasses-pumpfun-daily-revenue-defillama) 等):

- **发行侧热度**: 新发行数量、**毕业率(graduation rate)**、毕业耗时、**bonding curve 进度%/深度**、上线 FDV/市值、launchpad 日收入/费用。
  - *bonding curve 进度* = 已购代币 / 毕业阈值;*毕业* = 曲线填满后迁移到 DEX(如 pump.fun → PumpSwap / Raydium)。
- **首日承接(二级)**: day-1 realized depth at ±2%、给定美元规模滑点、初始 LP 锁定/规模。
- **看板/数据源**: DeFiLlama(launchpad 收入/费用,已能比较 pump.fun vs LetsBonk 日收入)、Dune(pump/four.meme 看板)、GeckoTerminal / DexScreener / Birdeye(新池+首日深度)、CoinGecko API(bonding curve 数据)。
- **缺口**: 毕业率的"**统一分母口径**"无标准;各看板口径不一。

### 3.2 传统发行(IDO / ICO / IEO / TGE)

来自 [Binance Research: Low Float & High FDV](https://public.bnbstatic.com/static/files/research/low-float-and-high-fdv-how-did-we-get-here.pdf)、[tokenomics vesting 指南](https://tokenomics.com/articles/token-vesting-complete-guide-to-vesting-schedules-cliffs-and-unlock-mechanisms)、[tokenomist.ai](https://tokenomist.ai/):

- **low float / high FDV 问题**: 低流通 + 高 FDV → 上线后解锁抛压 → 流动性恶化。
- **float / 解锁 / vesting 对流动性的影响**: cliff(悬崖解锁) / linear(线性解锁);**解锁日 = 流动性冲击事件**。
- **看板**: tokenomist.ai(解锁日历/vesting)、DeFiLlama Unlocks。

---

## 4. 跨层与资金流衡量方法 🟡

业界与开源/推特实战**以代理(proxy)信号为主**:用桥净流、稳定币流向、CEX 净流、聪明钱地址、OI/funding 组合判断"钱在哪一层、往哪边流"。

- **数据源**: [Nansen](https://nansen.ai/post/how-to-track-crypto-smart-money-your-guide-to-onchain-investment-moves)(smart money)、[Allium](https://www.allium.so/blog/best-on-chain-stablecoin-analytics-tools-and-dashboards/)(稳定币)、[CryptoQuant](https://intercom.help/cryptoquant/en/articles/4990634-keywords-you-must-know-to-understand-on-chain-charts)(交易所净流/链上关键词)、[CoinGlass](https://www.coinglass.com/CryptoApi)(OI/funding/交易所余额 API)、GMGN(meme)。
- **本地基线已记录**: 开源项目 **Day1 Global Briefing** 的面板化组织(5 分钟轮询 + 60 秒缓存,克制数据源 Yahoo/OKX/alternative.me/CoinGlass/Finnhub);X KOL **@gongyue777** "钱跑去合约了,看 OI、看指数更早抓端倪" + 链上做市痕迹/地址建仓。
- 🟡 **caveat**: 真实桥净流、钱包级聪明钱在**免费源下取不到**,只能 proxy;**X 原文本轮未独立抓取核验**(依赖项目文档转引的二手镜像)。

---

## 5. 业界产品 / 开源 / 推特实战做法对照

| 类别 | 代表 | 怎么衡量流动性 | 口径 / 可得性 |
|---|---|---|---|
| 数据商 | Kaiko / Coin Metrics / Amberdata | depth / spread / slippage 标准化(§2.1) | 付费 API,口径权威一致 |
| 一站式聚合 | CoinGlass | OI / funding / 深度 / 交易所余额 | API key,性价比高,适合个人面板 |
| 链上聚合 | DeFiLlama | TVL / DEX vol / 稳定币 / launchpad 收入 | **免费**,生态/总量层高效 |
| 链上情报 | Nansen / Allium / CryptoQuant | 聪明钱 / 稳定币流 / 交易所净流 | 多为付费,proxy 思路 |
| 学术 | Easley·O'Hara / Brauneis / Milionis | 五指标 / 分目的择优 / LVR(§2.2-2.3) | 公式公开,可自建 |
| DEX | Uniswap v3-market-depth-study | tick 级 realized depth,对标 CEX | **开源**,需链上数据 |
| 开源面板 | Day1 Global Briefing | 多源收敛成固定面板 | 克制数据源 = 可持续 |
| 推特 KOL | @gongyue777 等 | OI / 指数 / 做市痕迹 / 地址建仓 | 🔴 弱来源,待原文核验 |

---

## 6. 回到本项目:P0 / P1 落地建议 🟡

> 约束: **免费/可验证数据、四链 SOL/Base/ETH/BSC、现有栈 DeFiLlama/OKX/GMGN/Dune、交易可用等级上限 watch_only**。
> 现状: 已有三分数 / 四状态 / 二维矩阵 / 链级 proxy,但在**金融标准微观结构维度有明确可补的免费缺口**。
> 🟡 本节为基于已核验事实的**工程综合判断**,各免费接口的限速/历史深度/逐笔可得性**需实现时实测确认**。

### P0(免费可得,直接补强二级与一级承接)

1. **二级深度 + 价差**: 用 OKX `/api/v5/market/books` + Binance `/api/v3/depth`(OKX ticker 已在用)计算 **depth at ±0.1% / ±1% / ±2%** 与 **bid-ask spread%**。
   - **主指标用 0.1% / 1%,2% 仅展示**(因 2% 单档最易被刷,§2.1 警示)。
2. **滑点曲线**: 对四链主资产(BTC/ETH/SOL/BNB)用"**给定美元规模滑点曲线**"($1K / $10K / $100K)补充/替代当前 depth÷volume 比。
3. **DEX realized depth**: 对四链 DEX 用 **Uniswap 官方 tick 法**算 **realized depth at ±2% 替代 TVL 近似**(ETH / Base 的 v3 池优先)。证明"TVL≠可成交深度"。
4. **Amihud**: 加 **Amihud(|日收益| / 美元成交量)** 作四链与主资产的**低频流动性"水平"代理**(免费,只需价量;Brauneis JBF 2021 背书其在加密适用)。

### P1(部分免费 / 有缺口)

5. **Corwin-Schultz / Abdi-Ranaldo** 高低价价差估计量(只需 OHLC,免费)→ 流动性"**择时**"时序信号。
6. **VPIN / Kyle's λ**: 需逐笔成交 + 买卖方向分类;免费逐笔有限 → **列缺口**(可试用 tick rule 从公开 aggTrades 近似方向,见开放问题)。
7. **真实桥净流 / 钱包级聪明钱 / launchpad 毕业率**: 当前**免费栈缺口**(DeFiLlama Bridges 返回 402 付费)→ 保持 proxy + 显式标注。
8. **LVR**: 需逐区块价格同步,免费实现成本高 → **列离线研究**。

> **门控(沿用现有规则)**: 所有新增指标必须遵守——取不到 → `null`/`partial`,**不入主分**,标注数据质量;不破坏 `watch_only` 上限。

### 一级打新落地(回应"口径2 = 金融真正一级")

若要真正补"金融一级(发行/打新)流动性",**最低成本起步** = DeFiLlama launchpad 收入 + GeckoTerminal/DexScreener 首日池深度 + Dune pump/four.meme 看板(iframe 已有)。但**需专项研究统一口径**(毕业率分母、首日深度采集),见开放问题。

---

## 7. 边界(caveats)与开放问题

### 边界
1. 🔴 **一级打新衡量是最大缺口**: 本轮 23 条核验 claim 无一覆盖;第 3 节内容 confidence 低,不应作权威结论引用。
2. 🟡 **推特/X 来源弱**: @gongyue777 等来自项目文档转引的二手镜像,本轮未对 X 原文独立抓取核验;X 内容易删改,引用谨慎。
3. **数据商内部口径不一致**: Kaiko 深度参考点在 REST 文档用"best bid/ask"、在方法论博客用"mid-price";Kaiko 用 % 档、Amberdata 用 bps 档 → 跨源对比前需统一口径。
4. **两条被否决 claim 明示**: (a)"低频代理普遍可靠替代高频"被 0-3 否决;(b)"LVR 是首要/canonical 指标"被 1-2 否决。
5. **realized depth 为快照口径**: JIT 流动性、区块离散化、价格区间限制会使其与真实执行深度有偏。
6. **VPIN 的逆向选择解读**有作者自承的方法论争议。
7. **落地建议是工程综合判断**,非单一可核验事实;免费接口限速/逐笔可得性需实测。
8. **S&P Global 原文** 直接抓取返回 403,核验依据为搜索索引的同源摘录(多次互证但非全文 WebFetch)。

### 开放问题(建议后续专项研究)
1. 一级(打新/发行)流动性如何**标准化衡量**?(毕业率统一分母、bonding curve 可比口径、首日深度采集、vesting/解锁量化影响、各看板口径差异与免费可得性)
2. 本项目免费约束下,Kyle's λ / VPIN 所需**逐笔成交 + 方向分类**能否从 OKX/Binance 免费接口(aggTrades 等)以可接受限速获取?能否用 tick rule 免费近似方向?
3. X/Twitter 量化与链上 KOL 读一级/二级流动性的**可复现方法与阈值**,需对 X 原文独立抓取+对抗核验后再纳入。
4. 对四链(尤其 SOL/Base 上 pump.fun/four.meme/Clanker)新发行,能否免费、可验证地算"**首日 realized depth at ±2% 与给定规模滑点**"(类比 Uniswap tick 重建),把金融一级首日流动性真正落到面板?

---

## 附录:信源清单(25 个,按角度+质量)

**二级微观结构 / 数据商(一手)**: Kaiko REST 文档、Kaiko CEX 流动性方法论、Coin Metrics slippage、Coin Metrics spread、Amberdata order book depth、S&P Global 加密流动性报告。
**学术 / DEX(一手)**: Easley et al. SSRN 4814346、Brauneis et al. JBF 2021、Milionis et al. arXiv 2208.06046、LVR 实证 arXiv 2404.05803、Uniswap v3-market-depth-study(GitHub)、Uniswap 博客。
**一级打新(二手/blog,未核验)**: CoinGecko bonding curve 指南、Cointelegraph LetsBonk vs pump.fun、Bitget、DexScreener API 替代、Binance Research Low Float/High FDV、tokenomics vesting、tokenomist.ai。
**跨层资金流(blog/二手)**: Nansen smart money、Allium 稳定币、CryptoQuant 链上关键词、CoinGlass API、Gate GMGN 介绍。
**本地基线**: `dashboard/deep-research-report.md`、`dashboard/technical-solution.md`、`dashboard/docs/real-data-hot-money-flow-technical-plan.md`。

> 统计: 5 角度 / 25 信源 / 113 论断 / 25 验证 / 23 确认 / 2 否决 / 13 合成 finding。
