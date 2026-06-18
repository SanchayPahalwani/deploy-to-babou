import { describe, expect, it, vi } from "vitest";
import { BabouApiError, RestTransport } from "../src/transport.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("RestTransport", () => {
  it("sends bearer auth and the correct create-project body to the right URL", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "prj_x" }));
    const t = new RestTransport({ apiKey: "sk-bab-test", fetchImpl: fetchImpl as unknown as typeof fetch });

    const r = await t.createProject({ name: "N", description: "D" });

    expect(r.id).toBe("prj_x");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("https://api.babou.ai/api/v1/projects");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-bab-test");
    expect(JSON.parse(init.body as string)).toEqual({ name: "N", description: "D" });
  });

  it("retries on 429 then succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => (++n < 2 ? jsonResponse({ error: { code: "RATE_LIMIT_EXCEEDED" } }, 429) : jsonResponse({ id: "prj_ok" })));
    const t = new RestTransport({
      apiKey: "sk-bab-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 3,
      backoffMs: 1,
    });

    const r = await t.createProject({ name: "N", description: "D" });
    expect(r.id).toBe("prj_ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws a typed BabouApiError on 401 without retrying", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: "UNAUTHORIZED", message: "bad key" } }, 401));
    const t = new RestTransport({ apiKey: "sk-bab-bad", fetchImpl: fetchImpl as unknown as typeof fetch, backoffMs: 1 });

    await expect(t.listProjects()).rejects.toBeInstanceOf(BabouApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("parses list responses whether wrapped in {data} or a bare array", async () => {
    const wrapped = new RestTransport({
      apiKey: "k",
      fetchImpl: (async () => jsonResponse({ data: [{ id: "prj_1", description: "x" }] })) as unknown as typeof fetch,
    });
    expect(await wrapped.listProjects()).toEqual([{ id: "prj_1", name: undefined, description: "x" }]);

    const bare = new RestTransport({
      apiKey: "k",
      fetchImpl: (async () => jsonResponse([{ id: "prj_2" }])) as unknown as typeof fetch,
    });
    expect((await bare.listProjects())[0]!.id).toBe("prj_2");
  });
});
