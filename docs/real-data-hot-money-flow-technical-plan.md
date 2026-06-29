# 真实数据热钱流向面板技术方案

> 日期: 2026-05-18  
> 目标: 去掉生产输出中的 mock/fallback 入分逻辑，只用真实采集数据判断市场热度和链间热钱流向。  
> 边界: 继续保持免费、本地、只读；不接交易、不接私钥、不使用付费 API。

## 1. 当前问题

当前 MVP 已能展示页面和评分框架，但还不能作为交易辅助信号，原因如下：

- `sampleSnapshot` 会在外部源失败时兜底，导致 mock 数据进入 dashboard。
- `DeFiLlama` 失败时，一级链上分数仍会用样例链数据输出，容易误导。
- 链间资金流图目前主要来自链级分数差，表达的是“强弱轮动 proxy”，不是“热钱流向”。
- 历史曲线已经改为真实采集历史，但历史中仍可能混入 fallback 点。
- 二级市场只有 OKX spot/swap ticker proxy，缺少 OI、funding、深度和生态 token basket。

因此当前系统只能用于观察 UI 和算法形状，不能直接指导交易。

## 2. 目标状态

第一阶段改造后，系统必须满足：

- 生产 dashboard 不再把 mock/fallback 数据用于打分。
- 数据源失败时输出 `unavailable` / `not_ready`，而不是继续输出看似真实的分数。
- 历史曲线和热钱流向只使用 `sourceStatus=ok` 的真实采集点。
- 链间热钱流向由真实历史变化计算，而不是单纯用当前分数差画箭头。
- 页面明确显示“交易可用等级”：`not_ready`、`watch_only`、`trade_assist`。

## 3. 数据源策略

### 3.1 一级链上

第一阶段真实数据来源：

- DeFiLlama `v2/chains`: 链 TVL。
- DeFiLlama DEX overview: 链级 DEX 24h volume。
- DeFiLlama stablecoins: 链级稳定币供给。
- DeFiLlama stablecoin charts: 链级 `totalBridgedToUSD` 和 `totalMintedUSD`，作为稳定币桥接/铸造代理。

已调研但暂不接入免费 MVP：

- DeFiLlama Bridges `bridges.llama.fi`: 当前公开请求返回付费要求，不能作为免费 MVP 真实桥净流入源。
- 钱包级聪明钱/地址标签: 免费公开源缺少跨链统一标签，不能直接证明真实热钱地址迁移。

这些指标只能回答：

- 哪条链链上资金体量更大。
- 哪条链 DEX 交易更活跃。
- 哪条链稳定币底座更厚。
- 哪条链相对前一次真实采集出现扩张或收缩。

暂时不能严格回答：

- 真实桥流入流出。当前只能用稳定币桥接/铸造代理辅助判断。
- 热钱地址迁移。
- 新池子/launchpad 承接。
- 聪明钱是否在某链加仓。

### 3.2 GMGN + OKX OnchainOS 增强思路

这个新思路适合补齐“新池/新币成交热度”和“社媒讨论热度”，但不能替代 TVL、稳定币和 DEX 总量：

- GMGN: 参考 `D:\trea\proj\test\tools\system` 的 `gmgn_cli.py` 与 `hot_token_mining.py`，统一通过 `npx gmgn-cli ... --raw` 拉数据，不抓网页、不猜字段。每条链拉过去 24h 热门 token，按 `volume` 排序，读取 `volume`、`history_highest_market_cap`、`liquidity`、`smart_degen_count`、`renowned_count`、`rug_ratio`、`is_wash_trading`、`is_honeypot` 等字段。聚合为链级 `hotTokenVolume24hUsd`、`hotTokenAthMcapUsd`、`hotTokenLiquidityUsd`、`hotTokenQualityPassCount`。
- Dune: 用公开 launchpad 看板补充新币/新池热度。BSC 先用 Four.meme，Solana 先看 Pump.fun、LetsBonk 和 launchpad 份额看板，Base 先看 Clanker、Zora Creator Coins、Flaunch，ETH 主网用 Uniswap 新池作为代理。当前 MVP 已把公开 Dune 页面以 iframe/外链形式展示；自动采集必须通过 Dune API 固定 query id。
- OKX OnchainOS Social Analytics: 对 GMGN 返回的 token 做 token 级社媒验证。可用 `social/sentiment/symbol` 读取 mention 与情绪比例，`social/vibe/timeline` 读取 token 级 hotness、mentions、engagement、impressions 与 KOL 时间线。
- 链级社媒讨论度不是 OKX 直接给的字段，应由“该链热门 token 的 token 级社媒指标”按成交量或质量分加权聚合，不能声称是 OKX 原生链级讨论度。
- 数据源门控：GMGN 已默认随 `npm run collect` 执行，读取本地 API key 后用 `gmgn-cli --raw` 采集；OKX Social 仍需要 OKX Web3 API 签名凭据。任一增强源不可用时，只标注 `missing/error`，不入主分。

GMGN 具体命令与过滤规则：

```text
npx gmgn-cli market trending --chain <sol|bsc|base|eth> --interval 24h --order-by volume --limit <n> --raw
```

- 链名映射：`solana -> sol`，`ethereum -> eth`。
- 内部 fetch limit：`max(limit * 8, 50)`，先多取再过滤。
- Normalize 路径：优先读取 `data.rank`，兼容 `rank`、`list`、`items`、`data`。
- 标准字段：`volume` 是美元交易量，`history_highest_market_cap` 是历史最高市值/ATH，`liquidity` 是当前流动性。
- Solana 质量过滤：剔除稳定币/蓝筹包装资产、wash trading；要求 `volume >= 1M`、`liquidity >= 30K`、`ATH >= 1M 且 smart/KOL > 0`，或 `ATH >= 5M`。
- ATH 有效性：token 级保留 GMGN 原始 ATH；链级汇总过滤超过 100B USD 的异常 ATH，并展示异常数量，避免单个异常字段放大链级热度。

增强后的一级热度拆成：

```text
tradingHeat = DEX 24h volume change + DEX/TVL
capitalFlow = stablecoin supply change + TVL change + stablecoin bridge/mint proxy
hotTokenHeat = GMGN 24h hot-token volume + Dune launchpad activity + ATH/历史最高市值 + 风险过滤后的热门 token 数
socialHeat = OKX token sentiment/vibe metrics aggregated by chain
```

只有当 `tradingHeat`、`capitalFlow`、`hotTokenHeat`、`socialHeat` 中至少两个方向一致时，才提升为更强的“链上热钱偏向”信号；否则仍显示为分化观察。

### 3.3 二级市场

第一阶段真实数据来源：

- OKX Public REST spot ticker。
- OKX Public REST swap ticker。

这些指标只能回答：

- 主流资产现货成交强弱。
- 合约成交相对现货是否拥挤。

暂时不能严格回答：

- OI 是否堆积。
- 资金费率是否拥挤。
- 订单簿深度是否支持上涨。
- 某条链生态 token 是否被二级市场追逐。

## 4. 真实数据门槛

数据源状态统一使用：

- `ok`: 真实采集成功。
- `error`: 采集失败。
- `stale`: 数据过期。
- `partial`: 非关键指标缺失。

禁止再使用 `fallback` 作为可参与打分的数据状态。

生产 dashboard 规则：

- DeFiLlama 不为 `ok` 时，一级链上分数为 `null`，链级分数为 `null`。
- OKX 不为 `ok` 时，二级市场分数为 `null`。
- 任一核心分数为 `null` 时，总分为 `null`，状态为 `数据不足`。
- 历史曲线只使用 `sourceStatus` 中 DeFiLlama 为 `ok` 的采集点。
- 二级曲线只使用 OKX 为 `ok` 的采集点。

## 5. 一级热钱流向算法

第一阶段不再输出单一 leader，而是拆成两条信号，避免把 DEX 交易升温误读为真实资金流入。

### 5.1 交易热度

每条链计算最近两个真实 DeFiLlama 采集点之间的变化：

```text
dexVolumeDeltaPct
dexVolumeTvlRatio
```

交易热度分数：

```text
tradingHeatScore =
  0.70 * dexVolumeDeltaScore
+ 0.30 * currentDexVolumeTvlScore
```

只有最近真实点存在 DEX 交易量增量时，才输出 `tradingHeat.leaderChain`。

### 5.2 资金流入

资金流入分数：

```text
capitalFlowScore =
  0.42 * stablecoinDeltaScore
+ 0.28 * tvlDeltaScore
+ 0.20 * stablecoinBridgeProxyDeltaScore
+ 0.10 * stablecoinMintedDeltaScore
```

解释：

- DEX volume 变化代表链上交易热度。
- 稳定币变化代表链上可用现金。
- TVL 变化代表资金是否停留在协议里。
- 稳定币桥接/铸造代理来自 DeFiLlama stablecoin charts，用于补充真实桥净流缺口。
- DEX/TVL 只进入交易热度，不再单独决定资金流入。

只有最近真实点存在正向 TVL、稳定币、稳定币桥接或稳定币铸造增量时，才输出 `capitalFlow.leaderChain`。

链间边生成：

- 找出 `capitalFlowScore` 高的链作为流入候选。
- 找出 `capitalFlowScore` 低的链作为相对流出候选。
- 连续采集到完全相同的链上指标时跳过重复快照；如果最近真实点没有明显增量，不生成迁移边。
- 只有分差超过阈值才生成边，例如 `BSC -> SOL`。
- 边必须标注 `proxy`，不能表述为真实逐笔资金迁移。

### 5.3 时间窗口和取不到的数据

- DEX 交易量口径：DeFiLlama DEX 24h volume。
- DEX 变化率窗口：最近两个非重复真实采集点之间的变化；本地服务目标采集间隔为 4 小时，实际间隔写入 `comparisonWindow.elapsedHours` 并在 hover 中显示。
- 稳定币桥接/铸造口径：DeFiLlama stablecoin charts 最新日线的 `totalBridgedToUSD` 和 `totalMintedUSD`。
- 稳定币供给动量：链级稳定币供给相对上一周期变化，不是活跃地址。
- DEX 交易动量：DEX 24h volume 相对 30 日日均变化，不是链上交易笔数。
- 取不到：真实跨链桥净流。DeFiLlama Bridges 当前免费请求返回付费要求，未入分。
- 取不到：钱包级聪明钱流向。免费公开源缺少跨链统一钱包标签，未入分。
- 辅助可取：新池/新币成交热度。GMGN 过去 24h 热门代币交易量、流动性、ATH/历史最高市值、smart/KOL 和风险字段已默认采集，并聚合为 `hotTokenHeatScore` 辅助热度分；Dune launchpad 已支持可选 API 结构化采集，需 `DUNE_API_KEY` 与 `DUNE_LAUNCHPAD_QUERIES` 配置稳定 query id，缺配置时仍以 iframe/外链人工观察。

GMGN 热度分只用于解释，不进入一级主分。权重为 24h 热门币成交 35%、热门币流动性 20%、ATH 20%、smart/KOL 15%、热门币数量 10%；每项使用对数刻度压缩极端值，ATH 异常数量扣分。分档为 `hot`、`active`、`watch`、`missing`。

`sourceHealth` 必须把上述边界显式展示给用户：DeFiLlama Bridges 标记为 `paid_unavailable`，原因是 `bridges.llama.fi` 的 bridges、chainstats、bridgedaystats、bridgevolume 端点当前探测返回 402；钱包级聪明钱标记为 `missing`。这两个缺口不应导致 DeFiLlama Free 主源失败，也不能被写成 0 入分。

对已实际采集的源，`sourceHealth` 需要从 `public/data/history.json` 与本轮 `meta.sourceStatus` 计算最近成功、最近失败、最近观测状态和连续失败次数。该统计只用于判断本地面板的数据可靠性；未实际采集的缺口源保持当前状态说明，不生成虚假的历史成功/失败。

前端需要提供 `public/data/history.json` 的下载入口，导出内容为本地保留期内的真实采集快照。该文件用于离线复盘趋势和源健康，不作为第三方数据源完整历史的替代。

## 6. 交易可用等级

输出 `tradeReadiness`：

### not_ready

满足任一条件：

- DeFiLlama 或 OKX 关键源失败。
- 一级或二级核心分数为 `null`。

含义：不能用于交易，只能看系统状态。

### watch_only

满足：

- DeFiLlama 与 OKX 都为 `ok`。
- 可以有少于 2 个真实历史点，但页面必须提示热钱迁移历史不足。
- 缺少 OI、funding、深度、真实桥流、钱包级聪明钱或新池/新币成交数据。

含义：可以用于观察市场方向，但不能单独作为下单依据。

### trade_assist

后续增强后才允许：

- 一级: TVL、DEX volume、稳定币、真实桥净流、钱包级聪明钱、新池/新币成交均可用。
- 二级: spot volume、perp volume、OI、funding、深度均可用。
- 历史窗口至少覆盖 24h，且无 fallback 点参与。

含义：可作为交易辅助信号，但仍不自动下单。

## 7. 本轮实现范围

本轮只做第一阶段：

- 移除生产 fallback 入分。
- 保留 `sampleSnapshot` 仅作为测试 fixture，不出现在 dashboard 数据源列表中。
- 增加 `tradeReadiness`。
- 增加 `hotMoneyFlow`，基于真实历史变化计算链间热钱 proxy。
- 历史曲线过滤掉非真实 DeFiLlama 点。
- 页面展示数据不足和交易可用等级。
- 文档说明当前仍不是交易级信号。

## 8. 验收标准

- DeFiLlama 失败时，一级分数为 `null`，总分为 `null`，状态为 `数据不足`。
- OKX 失败时，二级分数为 `null`，总分为 `null`，状态为 `数据不足`。
- dashboard 不再声明 `sample-fallback` 为生产数据源。
- 历史曲线不使用 sourceStatus 非 `ok` 的点。
- `hotMoneyFlow` 使用真实历史增量，不再只靠当前分数差。
- `tradeReadiness` 在当前免费数据能力下最多为 `watch_only`，不能误报 `trade_assist`。
