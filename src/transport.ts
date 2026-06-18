/**
 * How we talk to Babou. Two implementations behind one interface:
 *   - RestTransport: the real REST API (https://api.babou.ai/api/v1), with
 *     bearer auth, retry/backoff on 429/5xx, and a request timeout.
 *   - MockTransport: in-memory, deterministic ids, records an ordered call log.
 *     Lets the whole contract be verified with zero credentials.
 *
 * Note: there is deliberately NO export method on this interface. This client
 * can only assemble a DRAFT. Publishing stays a human action in the dashboard.
 */
import type { BabouProject, CallRecord } from "./types.js";

export interface DraftTransport {
  listProjects(): Promise<BabouProject[]>;
  createProject(input: { name: string; description: string }): Promise<{ id: string }>;
  addChapter(projectId: string, input: { name: string; duration: number }): Promise<{ id: string }>;
  addPrompt(
    projectId: string,
    chapterId: string,
    input: { content: string },
  ): Promise<{ prompt_id: string; status: string }>;
  getCalls(): CallRecord[];
}

export class BabouApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "BabouApiError";
  }
}

export interface RestOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  backoffMs?: number;
  timeoutMs?: number;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class RestTransport implements DraftTransport {
  private readonly calls: CallRecord[] = [];
  private readonly apiKey: string;
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly timeoutMs: number;

  constructor(o: RestOptions) {
    this.apiKey = o.apiKey;
    this.base = (o.baseUrl ?? "https://api.babou.ai/api/v1").replace(/\/+$/, "");
    this.f = o.fetchImpl ?? fetch;
    this.maxRetries = o.maxRetries ?? 4;
    this.backoffMs = o.backoffMs ?? 500;
    this.timeoutMs = o.timeoutMs ?? 30_000;
  }

  getCalls(): CallRecord[] {
    return this.calls;
  }

  private async req(method: string, path: string, body?: unknown): Promise<any> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await this.f(`${this.base}${path}`, {
          method,
          signal: ctrl.signal,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (res.ok) return await safeJson(res);

        if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
          await sleep(this.backoffMs * 2 ** attempt);
          continue;
        }
        const detail = await safeJson(res).catch(() => ({}));
        throw new BabouApiError(
          detail?.error?.message || detail?.message || `Babou ${method} ${path} -> ${res.status}`,
          res.status,
          detail?.error?.code || detail?.code,
        );
      } catch (err) {
        lastErr = err;
        if (err instanceof BabouApiError) throw err;
        // network/abort error: retry if attempts remain
        if (attempt < this.maxRetries) {
          await sleep(this.backoffMs * 2 ** attempt);
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr ?? new Error("Babou request failed");
  }

  async listProjects(): Promise<BabouProject[]> {
    this.calls.push({ tool: "ListProjects", args: {} });
    const data = await this.req("GET", "/projects");
    const arr: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.projects)
          ? data.projects
          : [];
    return arr.map((p) => ({ id: p.id, name: p.name, description: p.description }));
  }

  async createProject(input: { name: string; description: string }): Promise<{ id: string }> {
    this.calls.push({ tool: "CreateProject", args: input });
    const data = await this.req("POST", "/projects", input);
    return { id: data.id };
  }

  async addChapter(projectId: string, input: { name: string; duration: number }): Promise<{ id: string }> {
    this.calls.push({ tool: "AddChapter", args: { projectId, ...input } });
    const data = await this.req("POST", `/projects/${projectId}/chapters`, input);
    return { id: data.id };
  }

  async addPrompt(
    projectId: string,
    chapterId: string,
    input: { content: string },
  ): Promise<{ prompt_id: string; status: string }> {
    this.calls.push({ tool: "AddPrompt", args: { projectId, chapterId, ...input } });
    const data = await this.req("POST", `/projects/${projectId}/chapters/${chapterId}/prompt`, input);
    return { prompt_id: data.prompt_id, status: data.status };
  }
}

/** Deterministic, credential-free stand-in. Powers REPLAY mode and the tests. */
export class MockTransport implements DraftTransport {
  private readonly calls: CallRecord[] = [];
  private readonly projects: BabouProject[];
  private seq = 0;

  constructor(seedProjects: BabouProject[] = []) {
    this.projects = [...seedProjects];
  }

  getCalls(): CallRecord[] {
    return this.calls;
  }

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_mock${String(this.seq).padStart(17, "0")}`;
  }

  async listProjects(): Promise<BabouProject[]> {
    this.calls.push({ tool: "ListProjects", args: {} });
    return this.projects;
  }

  async createProject(input: { name: string; description: string }): Promise<{ id: string }> {
    this.calls.push({ tool: "CreateProject", args: input });
    const id = this.id("prj");
    this.projects.push({ id, ...input });
    return { id };
  }

  async addChapter(projectId: string, input: { name: string; duration: number }): Promise<{ id: string }> {
    this.calls.push({ tool: "AddChapter", args: { projectId, ...input } });
    return { id: this.id("cht") };
  }

  async addPrompt(
    projectId: string,
    chapterId: string,
    input: { content: string },
  ): Promise<{ prompt_id: string; status: string }> {
    this.calls.push({ tool: "AddPrompt", args: { projectId, chapterId, ...input } });
    return { prompt_id: this.id("int"), status: "processing" };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
