import { afterEach, describe, expect, it, mock } from "bun:test";
import { createTtlCache } from "../cache.js";

describe("createTtlCache", () => {
  // Freeze time to make tests deterministic.
  let now = 1_000_000;
  const realNow = Date.now;

  afterEach(() => {
    // Restore real Date.now and clear mock state.
    globalThis.Date.now = realNow;
    mock.restore();
  });

  function freezeTime(ms: number) {
    now = ms;
    globalThis.Date.now = () => now;
  }

  // -----------------------------------------------------------------------
  // getOrSet – basic
  // -----------------------------------------------------------------------
  it("calls the loader on first access and returns the value", async () => {
    freezeTime(0);
    const cache = createTtlCache<string>({
      defaultTtlMs: 60_000,
      maxEntries: 10,
    });
    let calls = 0;
    const val = await cache.getOrSet("k", async () => {
      calls++;
      return "hello";
    });
    expect(val).toBe("hello");
    expect(calls).toBe(1);
  });

  it("returns cached value on second access within TTL", async () => {
    freezeTime(0);
    const cache = createTtlCache<string>({
      defaultTtlMs: 60_000,
      maxEntries: 10,
    });
    let calls = 0;
    await cache.getOrSet("k", async () => {
      calls++;
      return "first";
    });
    freezeTime(10_000);
    const val = await cache.getOrSet("k", async () => {
      calls++;
      return "second";
    });
    expect(val).toBe("first");
    expect(calls).toBe(1); // loader never called a second time
  });

  it("reloads after TTL expiry", async () => {
    freezeTime(0);
    const cache = createTtlCache<string>({
      defaultTtlMs: 5_000,
      maxEntries: 10,
    });
    let calls = 0;
    await cache.getOrSet("k", async () => {
      calls++;
      return "first";
    });
    // move past expiry
    freezeTime(10_000);
    const val = await cache.getOrSet("k", async () => {
      calls++;
      return "second";
    });
    expect(val).toBe("second");
    expect(calls).toBe(2);
  });

  // -----------------------------------------------------------------------
  // rejection behaviour
  // -----------------------------------------------------------------------
  it("removes the entry when the loader rejects", async () => {
    freezeTime(0);
    const cache = createTtlCache<string>({
      defaultTtlMs: 60_000,
      maxEntries: 10,
    });

    const boom = cache.getOrSet("fail", () => Promise.reject(new Error("boom")));
    await boom.catch(() => {}); // swallow

    // The entry should have been removed, so next call triggers loader again.
    freezeTime(1_000);
    let called = false;
    const val = await cache.getOrSet("fail", async () => {
      called = true;
      return "recovered";
    });
    expect(val).toBe("recovered");
    expect(called).toBe(true);
  });

  // -----------------------------------------------------------------------
  // deduplication of concurrent requests
  // -----------------------------------------------------------------------
  it("deduplicates concurrent requests for the same key", async () => {
    freezeTime(0);
    const cache = createTtlCache<string>({
      defaultTtlMs: 60_000,
      maxEntries: 10,
    });
    let calls = 0;
    const [a, b] = await Promise.all([
      cache.getOrSet("dup", async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 5));
        return "shared";
      }),
      cache.getOrSet("dup", async () => {
        calls++;
        return "never-used";
      }),
    ]);
    expect(a).toBe("shared");
    expect(b).toBe("shared");
    expect(calls).toBe(1); // only the first loader ran
  });

  // -----------------------------------------------------------------------
  // multiple keys
  // -----------------------------------------------------------------------
  it("treats different keys independently", async () => {
    freezeTime(0);
    const cache = createTtlCache<number>({
      defaultTtlMs: 60_000,
      maxEntries: 10,
    });
    const a = await cache.getOrSet("a", () => Promise.resolve(1));
    const b = await cache.getOrSet("b", () => Promise.resolve(2));
    expect(a).toBe(1);
    expect(b).toBe(2);
  });
});
