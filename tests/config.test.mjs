import test from "node:test";
import assert from "node:assert/strict";

import { SUPPORTED_CHAINS } from "../src/config.mjs";

test("SUPPORTED_CHAINS includes Robinhood Chain with exact DeFiLlama name", () => {
  const robinhood = SUPPORTED_CHAINS.find((chain) => chain.id === "robinhood");

  assert.ok(robinhood);
  assert.equal(robinhood.label, "Robinhood");
  assert.equal(robinhood.llamaName, "Robinhood Chain");
  assert.deepEqual(robinhood.ecosystemSymbols, []);
});
