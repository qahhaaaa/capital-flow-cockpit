# PRD — 资金流向与轮动驾驶舱 (Capital Flow & Rotation Cockpit)

> 日期: 2026-06-19
> 状态: ready-for-agent
> 来源: 本对话上下文 + 两份调研报告(`docs/capital-flow-rotation-survey-2026-06-19.md` 为目标方向,`docs/liquidity-measurement-survey-2026-06-18.md` 为对照/排除项)
> 说明: 本 PRD 是**全新设计**,不沿用现有 `src/scoring.mjs` / `src/insights.mjs` / `public/main.js` 的设计;现有系统视为"待替换基线",仅底层免费数据抓取管线(provider HTTP 部分)可回收。
> 发布: 项目为本地非 git 工程、无配置 issue tracker,故以本文件形式交付(等价于一张 `ready-for-agent` 工单);若后续接入 GitHub/Linear 再迁移并打标签。

---

## 问题陈述 (Problem Statement)

> 以用户(加密交易者)视角。

我现在的面板给了一堆"链上分数 / 二级分数 / 综合分数",但**完全没有指导意义**——我看完仍然不知道:

- **钱现在在哪一层?** 是停在宏观观望、囤在某条链、涌进某个发射台、还是跑去 CEX 合约空转?
- **钱在往哪流、轮动到哪?** 哪条链在吸金、哪个发射台在升温、资金从哪个叙事轮到哪个叙事、是从现货去合约还是从合约回现货?
- **整体是放水还是收水?**(美联储在松还是紧,有没有"水"。)
- **据此我该对某个具体标的(链上现货币 / CEX 合约)做什么?该不该上、上多少?** 比如某个新发射台的存量资金一直在增、上涨概率偏大,我想知道"可以打一点仓"——现在的面板完全给不出这种判断。

现有系统衡量的是"链上 vs CEX 的活跃度高低",这**不是我要的**;它也没有发射台轮动、主题轮动、宏观净流动性、真实资金迁移这些层,更没有把信号落到"对某标的的仓位建议"。所以它对我的实际决策**零价值**。

---

## 解决方案 (Solution)

> 以用户视角。

一个"**跟着钱走(follow the money)**"的驾驶舱,把资金流动拆成五层捕捉,再把五层信号合成为**对具体标的的仓位指导**:

1. 打开面板,顶部先告诉我**当前是放水还是收水**(宏观水位 regime),以及**钱主要在哪一层**。
2. 往下,五个层面各给我一个清晰信号——**方向 + 强度 + 置信度**:
   - 宏观:净流动性在扩还是缩、稳定币"干火药"在增还是减、ETF 在流入还是流出。
   - 链间:钱在从哪条链流向哪条链(SOL/Base/ETH/BSC…)。
   - 发射台:打新资金在哪个台子升温/降温(pump.fun / LetsBonk / four.meme…)。
   - DEX↔CEX:钱在链上现货还是 CEX 合约,合约是不是过度拥挤。
   - 主题轮动:资金从哪个叙事(AI/meme/RWA/DeFi…)轮到哪个。
3. 一张**轮动地图**直观展示链→链、板块→板块、现货↔合约的资金迁移方向。
4. 一张**标的-仓位建议表**:我关心的每个标的(链上现货或 CEX 合约)旁边,显示它"吃到哪几层顺风"、综合 conviction、**建议仓位档(空仓/试探/小仓/标准)**、以及风险旗标(链上看出场流动性、合约看 funding/OI 拥挤)。例如"某发射台存量资金持续净增 → 该台新标的 +1 顺风 → 建议:试探仓"。
5. 每个信号都明确标**置信度和数据缺口**,并全局声明:**这是辅助判断,不自动下单,真实下单由我手动执行。**

核心区别:从"展示活跃度分数" → 变成"**告诉我钱往哪流、并据此该对哪个标的上多少仓**"。

---

## 用户故事 (User Stories)

**宏观水位层(放水/收水)**
1. 作为交易者,我想一眼看到当前是"放水/收水/中性"的 regime,以便决定整体该进攻还是防守。
2. 作为交易者,我想看到美联储净流动性(WALCL − TGA − RRP)的方向和近期变化率,以便判断系统里有没有"水"。
3. 作为交易者,我想看到稳定币总供给增速(加密原生"干火药"),以便判断买盘弹药在增还是减。
4. 作为交易者,我想看到 BTC/ETH 现货 ETF 的净流入/流出,以便判断机构增量资金方向。
5. 作为交易者,我想让宏观水位作为"闸门"压制或放大下层信号,以便在收水期自动降低做多 conviction。

**链间流动层**
6. 作为交易者,我想看到资金在 SOL/Base/ETH/BSC 之间的净迁移方向,以便知道哪条链在吸金。
7. 作为交易者,我想用各链稳定币份额的变化率(免费可得)作为链间迁移的主信号,以便比"桥 proxy"更干净地判断资金搬家。
8. 作为交易者,我想看到链级 TVL/DEX 份额的轮动(以 BTC/ETH 计价去噪),以便区分"真迁移"和"币价波动"。
9. 作为交易者,当真实桥净流可免费程序化获取时,我想用它替代稳定币代理,以便提高链间信号的准确度。
10. 作为交易者,我想看到"资金从 X 链流向 Y 链"的轮动边及其强度/置信度,以便定位承接力最强的链。

**发射台流动层**
11. 作为交易者,我想看到打新资金在各发射台(pump.fun / LetsBonk / four.meme 等)之间的份额与收入动量,以便知道哪个台子在升温。
12. 作为交易者,我想看到某个发射台"存量资金/收入持续净增"的信号,以便对该台新标的提高 conviction(我的核心用例)。
13. 作为交易者,我想看到发射台的降温/塌方信号,以便及时回避该台标的。
14. 作为交易者,我想把发射台热度按链归属,以便和链间信号联动(哪条链 + 哪个台子双顺风)。

**DEX↔CEX 流动层**
15. 作为交易者,我想看到资金在"链上现货"与"CEX 合约/现货"之间的迁移方向,以便判断钱是在建仓还是在空转。
16. 作为交易者,我想看到 OI、资金费率、perp/spot 量比,以便识别"钱跑去合约了"和合约拥挤。
17. 作为交易者,我想在合约过度拥挤(funding/OI 极端)时收到反向降杠杆提示,以便规避挤兑风险。
18. 作为交易者,我想用交易所净流(或稳定币 CEX 余额代理)判断资金进出 CEX 托管,以便辅助多空偏向。

**主题/叙事轮动层**
19. 作为交易者,我想看到各板块(AI/meme/RWA/DeFi/DePIN…)的相对强弱与多窗口(1d/7d/1m)动量,以便知道资金轮到哪个叙事。
20. 作为交易者,我想板块强弱以 BTC/ETH 计价或净流口径计算,以便剔除币价上涨造成的假轮动。
21. 作为交易者,我想看到 mindshare/注意力代理(并明确其可被操纵),以便把"叙事热度"当辅助而非真凭据。
22. 作为交易者,我想把某标的归到其叙事,以便它享受/承受该叙事的轮动顺逆风。

**跨层合成与轮动地图**
23. 作为交易者,我想要一个"钱在哪一层、往哪流、轮动到哪"的统一结论,而不是五个孤立分数。
24. 作为交易者,我想只有当多层信号方向一致时才提升整体 conviction("多方向一致才升级"),以便降低单层噪声误导。
25. 作为交易者,我想要一张轮动地图(链→链、板块→板块、现货↔合约),以便一眼看清资金迁移结构。
26. 作为交易者,我想看到"共振做多"与"背离/空转"两类典型组合的明确标识,以便快速校准体感。

**仓位指导层(最终目标)**
27. 作为交易者,我想维护一个标的清单(链上现货币 / CEX 合约),每个标的打上链/板块/发射台标签,以便系统把对应层的顺逆风挂到它身上。
28. 作为交易者,我想每个标的显示"吃到哪几层顺风/逆风 + 综合 conviction 分档",以便快速排序候选。
29. 作为交易者,我想每个标的给出**建议仓位档(空仓/试探/小仓/标准)**及理由,以便把信号落到实际下单大小。
30. 作为交易者,我想链上标的的仓位建议受"出场流动性"约束(小盘留滑点余量),以便不被困在出不掉的仓里。
31. 作为交易者,我想合约标的的仓位建议受"funding/OI 拥挤度"反向约束,以便拥挤时自动建议降杠杆。
32. 作为交易者,我想仓位建议始终是**建议、不自动下单**,并明确标注"真实下单需我手动",以便我始终掌控资金安全。
33. 作为交易者,我想在数据不足时标的仓位建议降级为"仅观察",以便不在缺数据时被诱导加仓。

**数据诚实度与运维**
34. 作为交易者,我想每个信号都显示置信度与具体数据缺口,以便知道哪些结论可信、哪些只是 proxy。
35. 作为交易者,我想任一数据源失败时该层标记 null/partial 而非用样例/0 冒充,以便绝不被假数据误导。
36. 作为交易者,我想 hover 任意信号能看到其原始指标与口径,以便自行复核。
37. 作为交易者,我想面板顶部显示整体"交易可用等级"(not_ready / watch_only / trade_assist),以便知道当前结论能用到什么程度。
38. 作为面板维护者,我想数据采集失败相互隔离(一个源挂不拖垮其他层),以便系统在部分缺数据时仍可用。
39. 作为面板维护者,我想保留真实采集历史以支撑滚动分位/动量与轮动差分,以便信号有"相对强弱"的基准。
40. 作为面板维护者,我想所有抓取走 API 端点而非爬前端(前端 403),以便采集稳定。

---

## 实现决策 (Implementation Decisions)

**整体架构(四段式,全新)**
- 数据采集层(providers) → 归一化层(normalizers) → **信号引擎(纯函数,核心)** → 流向/轮动状态 + 仓位指导 → 数据契约(`dashboard.json v2`) → 展示层(前端重做)。
- 编排脚本串起"采集 → 归一化 → 信号 → 状态 → 指导 → 写快照 + 追加历史";各源失败隔离。
- 仅回收现有 provider 的底层 HTTP/重试/代理写法;**口径、归一化、信号、状态、展示全部重定义**。现有 `scoring.mjs` 的线性 `primary/secondary/overall` 加权与 `flows` 被废弃替换。

**数据采集层(模块按源拆分,各 `load()` 返回带 source-status 的归一化输入)**
- 新增:宏观净流动性源(FRED WALCL/WTREGEN/RRPONTSYD)、ETF 流入源、稳定币按链分布源(`stablecoins.llama.fi/stablecoinchains`,已实测可用)、发射台收入源(DeFiLlama launchpad / Dune)、板块源(DeFiLlama categories)、CEX 衍生品源(OKX OI/funding/perp-spot)。
- 复用/扩展:DeFiLlama、OKX、GMGN、Dune 现有抓取管线。
- 每源输出统一 source-status:`ok | error | stale | partial`;失败不入信号、不伪造。

**归一化层(metric envelope,统一指标信封)**
- 每个指标归一化为:`{ value, asOf, window: number[], percentile, z, dataQuality }`——携带滚动历史窗口以支持分位/z 与动量。
- 涉及 TVL/价格污染的指标(链/板块强弱)额外提供 BTC/ETH 计价口径以去噪。

**信号引擎(纯函数,主 seam)**
- `computeLayerSignals(normalizedInputs) → { macro, chain, launchpad, dexCex, narrative }`,每层一个 `LayerSignal`:
  ```
  LayerSignal = {
    direction: 枚举,            // 如 risk_on/risk_off | inflow/outflow | heating/cooling | to_spot/to_perp | rotate_in/rotate_out
    strength: 0..100,           // 滚动分位/z 归一,非绝对阈值
    confidence: 'high'|'medium'|'low',  // 由数据完整度决定
    drivers: string[],          // 拉动该方向的具体指标
    raw: object,                // 原始指标供 hover
    dataQuality: 'ok'|'partial'|'missing'
  }
  ```
- `computeFlowState(layerSignals) → { regime, moneyLocation, rotationEdges, agreement, confidence }`:
  - `regime` 由宏观层闸门(放水/收水/中性);
  - `rotationEdges: { from, to, type: 'chain'|'sector'|'spot_perp', strength, confidence }[]`;
  - `agreement`:多层方向一致度,驱动"一致才升级"逻辑。
- `appRevenueHeat` 为 cockpit/v2 顶层辅助 side-channel,不属于 `layerSignals`。协议 24h revenue 只代表活动热度/确认维度,不是流动性、不是资金净流入,不得参与 `computeFlowState` 或 `computePositionGuidance` 的 conviction 计算。
- `computePositionGuidance(layerSignals, watchlist) → GuidanceRow[]`:
  ```
  GuidanceRow = {
    target, type: 'onchain_spot'|'cex_perp',
    tailwindLayers: string[], headwindLayers: string[],
    conviction: 0..100, tier: 'flat'|'probe'|'small'|'standard',
    riskFlags: string[],        // 链上: 出场流动性/小盘; 合约: funding/OI 拥挤
    rationale: string, dataQuality
  }
  ```
  - 仓位档由 conviction + regime 闸门 + 标的风险画像共同决定;链上受出场流动性约束、合约受拥挤度反向约束。
  - 用户核心用例编码为一条规则:**某发射台 launchpad 信号 = heating 且其存量/收入分位上升 → 归属该台的链上现货标的 tailwind +1 → 在 regime 非收水时,tier 至少 probe。**

**标的清单(watchlist 配置)**
- 用户可配置的标的数组,每项:`{ target, type, chainTag, sectorTag, launchpadTag? }`;引擎据 tag 把对应层信号挂到标的。

**数据契约 `dashboard.json v2`(后端↔前端唯一 seam)**
- 顶层:`{ meta, regime, layers:{macro,chain,launchpad,dexCex,narrative}, appRevenueHeat, flowState:{moneyLocation,rotationEdges,agreement}, guidance: GuidanceRow[], dataHealth, methodology, tradeReadiness }`。
- `appRevenueHeat` 缺失时为 `null` 或 `dataQuality: missing/partial`,禁止用 0 填补缺失链;单协议占比 >60% 时标记 `singleAppSpike`。
- 与现有 v1 不兼容,前端按 v2 重写。

**安全/门控决策(强约束)**
- **纯决策辅助:绝不下单、不接私钥、不碰钱包转账**;`guidance` 永远是建议。
- `tradeReadiness`:`not_ready`(核心层缺失)/ `watch_only`(可观察)/ `trade_assist`(数据足够,仅信号增强,仍不自动执行)。
- 无付费源、无 mock fallback 入信号;源失败 → null/partial + 显式缺口。
- 所有抓取走 API 端点(前端 403 反爬)。
- 时间敏感:信号基于变化率/相对强弱/滚动分位,不绑死绝对数值(调研中多个绝对值已被证伪)。

**展示层(前端重做)**
- regime 顶栏 + 整体"钱在哪一层"摘要 + tradeReadiness 徽标。
- 五层信号面板(方向/强度/置信度 + hover 原始指标)。
- 辅助 App 收入热度面板,明确标注"活动热度,不是流动性/净流入",展示各链 top apps、份额、动量和单点应用 spike 提示。
- 轮动地图(链→链 / 板块→板块 / 现货↔合约)。
- 标的-仓位建议表(target | 顺/逆风层 | conviction/tier | 风险旗标 | 数据质量)。
- 全局"辅助非信号、不下单"声明;缺口处显式写"取不到",不用 0 冒充。

---

## 测试决策 (Testing Decisions)

**什么是好测试**:只测**外部行为**,不测实现细节。对纯函数,给定归一化输入断言输出的方向/强度档/置信度/仓位档;对契约,断言 `dashboard.json v2` 形状与关键字段;不针对内部中间变量或具体权重数字写脆弱断言(权重会调)。

**受测模块与重点用例**
- **信号引擎(主)**:`computeLayerSignals` / `computeFlowState` / `computePositionGuidance`,用 fixture 归一化输入测——
  - 每层方向判定(放水/收水、inflow/outflow、heating/cooling、to_spot/to_perp、rotate_in/out)。
  - "多方向一致才升级 agreement/conviction";单层噪声不应单独拉高 conviction。
  - **用户核心用例回归测**:发射台 heating + 存量分位上升 → 对应链上标的 tier ≥ probe(regime 非收水时);收水 regime 应压制为 flat/观察。
  - 合约标的:funding/OI 拥挤 → riskFlag + 反向降档。链上标的:小盘/低出场流动性 → riskFlag + 限档。
- **数据契约**:从 fixture snapshot 跑全链路,快照断言 `dashboard.json v2` 顶层结构与各层关键字段存在性、枚举合法性。
- **provider 归一化**:每源 `normalize(rawFixture) → metric envelope`,断言解析、单位、dataQuality、缺字段降级。
- **失败隔离与门控**:单源 error → 该层 missing/partial、其他层仍出信号、无 mock 入信号;数据不足 → `watch_only` 且 `guidance` 不出 trade_assist;任何路径都不产生"下单"副作用。

**prior art(沿用现有测试**手法**,非现有设计)**:现有仓库已用 `node:test` + fixture(样例快照)+ dashboard 输出快照 的测法(如 `tests/scoring.test.mjs`、`tests/dashboard.test.mjs`、各 provider 测试)。**保留这套测试组织方式**(纯函数 + fixture + 契约快照),但 fixture、断言、口径全部按 v2 新建。

---

## 范围之外 (Out of Scope)

- **自动交易 / 下单 / 私钥 / 钱包转账**——本系统永远只给建议,绝不执行。
- **订单簿微观结构流动性**(bid-ask spread / 深度 / 滑点 / Amihud / Kyle's λ / VPIN / LVR)——用户明确排除;仅在判断某层"承接能力"时偶作次要辅助并明确标注。
- **付费数据源**(bridges.llama.fi 付费档、Glassnode/CryptoQuant 付费档、Kaito 付费 mindshare)——v1 用免费源/代理替代,标缺口。
- **策略回测 / P&L 验证引擎**——v1 不做;信号有效性验证为后续。
- **发射台毕业率 / bonding curve 的统一跨台口径**——无免费统一源,列后续专项;v1 用收入/份额动量近似。
- **钱包级聪明钱跨链追踪**——无免费统一标签,v1 不入。
- **真实逐笔跨链桥净流**——若免费程序化不可得,则用稳定币按链分布代理,不强行接付费。
- **链的无限扩展**——v1 锁定 SOL/Base/ETH/BSC,架构允许扩展但不在本期实现。

---

## 补充说明 (Further Notes)

- **数据可得性已核验的关键点**:`stablecoins.llama.fi/stablecoinchains` 实测可程序化采集;DeFiLlama 前端页(/bridges/chains、/categories、/stablecoins/chains)对爬虫返回 403(用 API,不爬前端);Artemis `app.artemis.xyz/*` 已 308 跳转且 JS 渲染(免费程序化采集需实测,列 P1)。
- **去噪**:链/板块强弱必须配 BTC/ETH 计价或净流口径,避免把币价上涨误读为资金流入。
- **Kaito mindshare 可被操纵**(刷量/OTC 投票,mindshare≠价值),仅作可操纵的注意力代理。
- **落地优先级**(实现可分期,PRD 覆盖全量):P0 = 发射台轮动 + 主题轮动 + 稳定币按链迁移 + 宏观净流动性补全 + DEX↔CEX 补 OI/funding(均免费已核验);P1 = 真实桥净流可得性实测 + 交易所净流代理 + 毕业率 + mindshare 代理。详见 `docs/capital-flow-rotation-survey-2026-06-19.md` §4。
- **与现有系统关系**:v2 替换现有打分/insights/前端;现 dashboard.json v1 契约废弃;provider HTTP 管线可回收。
- **术语**:沿用调研报告与项目既有词汇(五层、资金流向、轮动边 rotation edges、regime 水位、conviction 分档、仓位档、tradeReadiness、信号=方向/强度/置信度)。
- **安全复述**:涉及真金白银的下单始终由用户手动执行;本系统在任何 tradeReadiness 等级下都不具备、也不应被赋予下单能力。
