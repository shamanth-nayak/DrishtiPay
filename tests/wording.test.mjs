import test from "node:test";
import assert from "node:assert/strict";
import { SpokenMessages, validateNoForbiddenWords, FORBIDDEN_WORDS } from "../frontend/js/messages.js";

test("F-02: Spoken messages contain NO forbidden wording ('safe', 'verified merchant', 'payment successful', 'secure')", () => {
  for (const [key, msg] of Object.entries(SpokenMessages)) {
    if (typeof msg === "string") {
      assert.doesNotThrow(() => validateNoForbiddenWords(msg), `Message ${key} failed forbidden word check`);
      for (const forbidden of FORBIDDEN_WORDS) {
        assert.equal(msg.toLowerCase().includes(forbidden), false, `Forbidden word "${forbidden}" in ${key}`);
      }
    } else if (typeof msg === "function") {
      // Test dynamic functions with sample arguments
      const sample = msg("₹35", "₹350", "Store");
      assert.doesNotThrow(() => validateNoForbiddenWords(sample), `Dynamic message ${key} failed forbidden word check`);
      for (const forbidden of FORBIDDEN_WORDS) {
        assert.equal(sample.toLowerCase().includes(forbidden), false, `Forbidden word "${forbidden}" in dynamic ${key}`);
      }
    }
  }
});
