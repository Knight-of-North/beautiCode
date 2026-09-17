import assert from "node:assert/strict";
import test from "node:test";
import { isSafeSkinId, normalizeSkinCenterUrl } from "../dist/skin-center.js";

test("skin center URL and id guards", () => {
  assert.equal(normalizeSkinCenterUrl("https://hnnulwh.cn"), "https://hnnulwh.cn");
  assert.equal(normalizeSkinCenterUrl("https://hnnulwh.cn/"), "https://hnnulwh.cn");
  assert.equal(normalizeSkinCenterUrl("http://evil.example"), null);
  assert.equal(normalizeSkinCenterUrl("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  assert.equal(isSafeSkinId("skin-abc12345"), true);
  assert.equal(isSafeSkinId("../etc/passwd"), false);
});
