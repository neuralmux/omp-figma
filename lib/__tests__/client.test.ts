import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  FigmaClient,
  normalizeNodeId,
  parseFigmaUrl,
} from "../client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mockFetch(status: number, body: unknown) {
  return mock.module("node:http", () => ({}));
}

function installFetchMock(responseOverrides: Partial<Response> = {}) {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = mock((_url: string | URL | Request, _init?: RequestInit) => {
    const init = _init as RequestInit | undefined;
    // Capture token for assertion
    (globalThis.fetch as unknown as { calls: Array<{ url: string; init?: RequestInit }> }).calls =
      (globalThis.fetch as unknown as { calls: Array<{ url: string; init?: RequestInit }> }).calls ?? [];
    (globalThis.fetch as unknown as { calls: Array<{ url: string; init?: RequestInit }> }).calls.push({
      url: typeof _url === "string" ? _url : _url instanceof URL ? _url.href : _url.url,
      init,
    });
    return Promise.resolve({
      ok: responseOverrides.ok ?? true,
      status: responseOverrides.status ?? 200,
      json: () =>
        Promise.resolve(responseOverrides.json ? responseOverrides.json() : {}),
      text: () =>
        Promise.resolve(
          responseOverrides.text
            ? responseOverrides.text()
            : JSON.stringify(responseOverrides.json ? responseOverrides.json() : {}),
        ),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    } as Response);
  });

  return () => {
    globalThis.fetch = originalFetch;
  };
}

// ---------------------------------------------------------------------------
// parseFigmaUrl
// ---------------------------------------------------------------------------
describe("parseFigmaUrl", () => {
  it("extracts fileKey and nodeId from a design URL", () => {
    const result = parseFigmaUrl(
      "https://www.figma.com/design/abc123/MyFile?node-id=1-2",
    );
    expect(result.fileKey).toBe("abc123");
    expect(result.nodeId).toBe("1:2");
  });

  it("extracts fileKey and nodeId from a file URL", () => {
    const result = parseFigmaUrl(
      "https://www.figma.com/file/xyz789/Other?node-id=10-20",
    );
    expect(result.fileKey).toBe("xyz789");
    expect(result.nodeId).toBe("10:20");
  });

  it("returns only fileKey when no node-id param", () => {
    const result = parseFigmaUrl(
      "https://www.figma.com/design/abc123/MyFile",
    );
    expect(result.fileKey).toBe("abc123");
    expect(result.nodeId).toBeUndefined();
  });

  it("returns raw string as fileKey when URL format not recognised", () => {
    const result = parseFigmaUrl("abc123");
    expect(result.fileKey).toBe("abc123");
    expect(result.nodeId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeNodeId
// ---------------------------------------------------------------------------
describe("normalizeNodeId", () => {
  it("replaces dashes with colons", () => {
    expect(normalizeNodeId("1-2")).toBe("1:2");
  });

  it("leaves colons unchanged", () => {
    expect(normalizeNodeId("1:2")).toBe("1:2");
  });
});

// ---------------------------------------------------------------------------
// FigmaClient
// ---------------------------------------------------------------------------
describe("FigmaClient", () => {
  let restoreFetch: () => void;

  afterEach(() => {
    if (restoreFetch) restoreFetch();
    mock.restore();
  });

  function client() {
    const c = new FigmaClient({ timeoutMs: 5_000 });
    c.setToken("test-token");
    return c;
  }

  // --- authentication ---
  it("throws when token is not set", async () => {
    const c = new FigmaClient();
    await expect(c.getFile("k", 1)).rejects.toThrow("Figma token not configured");
  });

  it("passes token in request headers", async () => {
    restoreFetch = installFetchMock({
      json: () => ({ name: "Test File" }),
    });
    const c = client();
    await c.getFile("k", 1);
    const calls = (globalThis.fetch as unknown as { calls: Array<{ url: string; init?: RequestInit }> }).calls;
    expect(calls.length).toBeGreaterThan(0);
    expect((calls[0].init?.headers as Record<string, string>)["X-Figma-Token"]).toBe("test-token");
  });

  // --- getFile ---
  it("getFile returns parsed JSON", async () => {
    restoreFetch = installFetchMock({
      json: () => ({ name: "My File", version: "1" }),
    });
    const c = client();
    const result = await c.getFile("unique-k", 1);
    expect(result).toEqual({ name: "My File", version: "1" });
  });

  it("getFile caches results within TTL", async () => {
    restoreFetch = installFetchMock({
      json: () => ({ name: "Cached" }),
    });
    const c = client();
    await c.getFile("k", 2);
    await c.getFile("k", 2); // should hit cache, not call fetch again

    const calls = (globalThis.fetch as unknown as { calls: Array<{ url: string; init?: RequestInit }> }).calls;
    // Only 1 fetch call, despite 2 getFile calls with same key
    expect(calls.length).toBe(1);
  });

  it("throws on non-ok response", async () => {
    restoreFetch = installFetchMock({
      ok: false,
      status: 403,
      text: () => "Forbidden",
    });
    const c = client();
    await expect(c.getFile("forbidden-k", 1)).rejects.toThrow(
      "Figma API error 403",
    );
  });

  // --- getNodes ---
  it("getNodes returns parsed JSON", async () => {
    restoreFetch = installFetchMock({
      json: () => ({
        nodes: {
          "1:1": { document: { id: "1:1", name: "Frame", type: "FRAME" } },
        },
      }),
    });
    const c = client();
    const result = await c.getNodes("k", ["1-1"]);
    expect(result).toHaveProperty("nodes");
  });

  // --- searchComponents ---
  it("searchComponents filters by name", async () => {
    restoreFetch = installFetchMock({
      json: () => ({
        meta: {
          components: [
            { name: "Button / Primary", key: "b1" },
            { name: "Input / Text", key: "b2" },
            { name: "Card / Default", key: "b3" },
          ],
        },
      }),
    });
    const c = client();
    const result = await c.searchComponents("k", "button");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect((result[0] as Record<string, unknown>).name).toBe("Button / Primary");
  });

  // --- getDesignContext (no nodeId) ---
  it("getDesignContext without nodeId returns top-level structure", async () => {
    restoreFetch = installFetchMock({
      json: () => ({
        name: "Design File",
        lastModified: "2026-01-01",
        version: "1",
        document: {
          name: "Document",
          children: [
            { id: "0:1", name: "Page 1", type: "CANVAS", children: [] },
          ],
        },
      }),
    });
    const c = client();
    const ctx = await c.getDesignContext("k");
    expect(ctx).toHaveProperty("file");
    expect(ctx).toHaveProperty("document");
    expect((ctx as Record<string, unknown>).document).toHaveProperty("children");
    expect((ctx as Record<string, unknown>).metadata).toBeDefined();
  });
});
