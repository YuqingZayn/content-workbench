import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  allowedLoginNavigation,
  webLoginPartition,
  xhsIdentity,
} from "../src/contracts/web-login";

test("web login only permits official HTTPS navigation, never lookalikes or local protocols", () => {
  for (const url of [
    "https://creator.xiaohongshu.com/login",
    "https://www.xiaohongshu.com/explore",
    "https://passport.xiaohongshu.com/",
  ])
    assert.equal(allowedLoginNavigation(url), true);
  for (const url of [
    "https://creator.xiaohongshu.com.evil.test/",
    "https://creator.xiaohongshu.com@evil.test/",
    "https://evil@creator.xiaohongshu.com/",
    "http://creator.xiaohongshu.com/",
    "https://creator.xiaohongshu.com:8443/",
    "file:///C:/Windows/",
    "javascript:alert(1)",
    "xiaohongshu://login",
  ])
    assert.equal(allowedLoginNavigation(url), false);
});
test("sessions bind both project and account identifiers and refuse path-like IDs", () => {
  const project = randomUUID(),
    account = randomUUID();
  assert.match(webLoginPartition(project, account), /^persist:/);
  assert.notEqual(
    webLoginPartition(project, account),
    webLoginPartition(randomUUID(), account),
  );
  assert.notEqual(
    webLoginPartition(project, account),
    webLoginPartition(project, randomUUID()),
  );
  assert.throws(() => webLoginPartition("../secret", account));
});
test("only a successful identity response authenticates; expired, anonymous and malformed responses do not", () => {
  assert.equal(
    xhsIdentity(200, {
      success: true,
      data: {
        userId: "abc123",
        userName: "合成账号",
        token: "must-not-return",
      },
    }).state,
    "logged_in",
  );
  assert.equal(
    JSON.stringify(
      xhsIdentity(200, {
        success: true,
        data: { userId: "abc123", token: "must-not-return" },
      }),
    ).includes("must-not-return"),
    false,
  );
  for (const body of [
    { success: true, data: {} },
    { success: false, data: { userId: "guest" } },
    "<html>login</html>",
    null,
  ])
    assert.equal(xhsIdentity(200, body).state, "unconfirmed");
  assert.equal(xhsIdentity(401, {}).state, "not_logged_in");
  assert.equal(
    xhsIdentity(200, { success: false, result: -100 }).state,
    "not_logged_in",
  );
  assert.equal(xhsIdentity(503, null).state, "network_error");
  assert.equal(xhsIdentity(403, { token: "fixture" }).state, "unconfirmed");
  assert.equal(xhsIdentity(429, null).state, "unconfirmed");
});
