import assert from "node:assert/strict";
import test from "node:test";
import { detectBrowserInfo, type BrowserNavigator } from "./browser-info.js";

const chromeLikeUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

test("recognizes Brave even though its user agent looks like Chrome", async () => {
  const source: BrowserNavigator = {
    userAgent: chromeLikeUserAgent,
    platform: "Win32",
    brave: { isBrave: async () => true }
  };

  assert.deepEqual(await detectBrowserInfo(source), {
    name: "Brave",
    version: "151.0.0.0",
    engine: "Blink",
    operatingSystem: "Windows",
    deviceType: "Desktop"
  });
});

test("recognizes Microsoft Edge from the Edg user-agent token", async () => {
  const source: BrowserNavigator = {
    userAgent: `${chromeLikeUserAgent} Edg/151.0.0.0`,
    platform: "Win32"
  };

  assert.equal((await detectBrowserInfo(source))?.name, "Microsoft Edge");
});

test("uses Google Chrome when no Brave or Edge signal exists", async () => {
  const source: BrowserNavigator = { userAgent: chromeLikeUserAgent, platform: "Win32" };

  assert.equal((await detectBrowserInfo(source))?.name, "Google Chrome");
});
