# Free Liquidity Dashboard MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a free-data, local-first liquidity dashboard MVP that scores SOL, Base, ETH mainnet, and BSC primary on-chain liquidity, compares it with secondary-market activity, and renders a static dashboard.

**Architecture:** A Node.js collector pulls free public data, normalizes it into a small dashboard JSON file, and a static frontend renders that JSON. The MVP avoids paid APIs, databases, private keys, trading permissions, and external build tooling.

**Tech Stack:** Node.js 22 ESM, built-in `node:test`, built-in `fetch`, static HTML/CSS/JS, generated JSON under `public/data/dashboard.json`.

---

## File Structure

- `package.json`: scripts for test, collect, serve, and local start.
- `src/config.mjs`: supported chains, labels, symbols, and free-data constraints.
- `src/math.mjs`: numeric helpers used by scoring.
- `src/scoring.mjs`: primary chain scores, aggregate scores, migration signals, and dashboard assembly.
- `src/providers/defillama.mjs`: free DeFiLlama TVL and DEX volume adapters.
- `src/providers/okx.mjs`: free OKX public ticker adapter.
- `src/sample-data.mjs`: deterministic fallback dataset for offline local use.
- `scripts/collect.mjs`: fetch free sources, compute dashboard JSON, and write `public/data/dashboard.json`.
- `scripts/serve.mjs`: local static file server.
- `public/index.html`: dashboard page.
- `public/styles.css`: dashboard styling.
- `public/main.js`: dashboard renderer.
- `public/data/dashboard.json`: generated starter data.
- `tests/scoring.test.mjs`: TDD coverage for scoring and flows.
- `tests/dashboard.test.mjs`: TDD coverage for dashboard schema and free-only constraints.

## Tasks

### Task 1: Core Scoring Tests

**Files:**
- Create: `tests/scoring.test.mjs`
- Create: `tests/dashboard.test.mjs`

- [ ] **Step 1: Write failing tests for chain scoring and dashboard schema**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboard, computePrimaryChainScores, computeFlows } from "../src/scoring.mjs";
import { sampleSnapshot } from "../src/sample-data.mjs";

test("ranks the four primary chains and keeps every required chain visible", () => {
  const scores = computePrimaryChainScores(sampleSnapshot.chains);
  assert.deepEqual(scores.map((item) => item.chain), ["solana", "base", "ethereum", "bsc"]);
  assert.equal(scores[0].rank, 1);
  assert.equal(scores[0].label, "SOL");
  assert.ok(scores.every((item) => item.score >= 0 && item.score <= 100));
});

test("detects secondary to primary expansion when primary breadth is stronger than secondary crowding", () => {
  const flows = computeFlows({
    primaryScore: 74,
    secondaryScore: 58,
    primaryMomentum: 12,
    secondaryMomentum: -3,
    chainScores: computePrimaryChainScores(sampleSnapshot.chains),
  });
  assert.equal(flows.crossLayer.direction, "secondary_to_primary");
  assert.ok(flows.crossLayer.score > 50);
  assert.ok(flows.rotationEdges.length > 0);
});

test("builds dashboard output with free-only metadata", () => {
  const dashboard = buildDashboard(sampleSnapshot);
  assert.equal(dashboard.meta.paidSourcesUsed, false);
  assert.deepEqual(dashboard.primaryChains.map((item) => item.chain), ["solana", "base", "ethereum", "bsc"]);
  assert.equal(typeof dashboard.flows.crossLayer.direction, "string");
  assert.equal(typeof dashboard.state.label, "string");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/*.test.mjs`  
Expected: FAIL because `src/scoring.mjs` and `src/sample-data.mjs` do not exist yet.

### Task 2: Scoring Implementation

**Files:**
- Create: `src/config.mjs`
- Create: `src/math.mjs`
- Create: `src/sample-data.mjs`
- Create: `src/scoring.mjs`
- Modify: `package.json`

- [ ] **Step 1: Implement minimal scoring code to satisfy tests**
- [ ] **Step 2: Run `node --test tests/*.test.mjs` and confirm PASS**

### Task 3: Free Data Adapters And Collector

**Files:**
- Create: `src/providers/defillama.mjs`
- Create: `src/providers/okx.mjs`
- Create: `scripts/collect.mjs`
- Create: `public/data/dashboard.json`

- [ ] **Step 1: Add free-source adapters with fallback to sample data**
- [ ] **Step 2: Run `npm run collect` and confirm JSON is written**

### Task 4: Static Dashboard UI

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/main.js`
- Create: `scripts/serve.mjs`

- [ ] **Step 1: Render state, chain cards, flow map, and source status from `dashboard.json`**
- [ ] **Step 2: Run `npm run serve` and inspect the page locally**

### Task 5: Docs And Deployment Notes

**Files:**
- Create: `README.md`
- Modify: `technical-solution.md`

- [ ] **Step 1: Document local deployment as the default free MVP**
- [ ] **Step 2: Document optional Vercel/VPS deployment boundaries**
- [ ] **Step 3: Run tests and collector again before completion**

## Self-Review

- Spec coverage: Covers free-only data, chain-level primary scores, cross-layer flows, cross-chain rotation, local deployment, static frontend, and fallback behavior.
- Placeholder scan: No placeholder markers remain.
- Type consistency: Dashboard keys use `primaryChains`, `flows.crossLayer`, `flows.rotationEdges`, and `meta.paidSourcesUsed` consistently.
