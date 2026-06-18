/**
 * A local stand-in for Babou's MCP server (https://api.babou.ai/mcp).
 *
 * It exposes the same five tools Babou documents, mirrors the verified REST
 * request bodies exactly, returns realistic prj_/cht_/int_ ids, and appends
 * every call to a JSONL log. This lets a real agent drive "Babou" end-to-end
 * with zero credentials — and lets CI assert exactly what the agent did.
 *
 * It also implements ExportProject *on purpose*: the agent is told never to
 * call it and isn't allow-listed for it, so its absence in the log is a
 * meaningful, machine-checkable proof — not just a tool we forgot to build.
 *
 * IMPORTANT: never write to stdout here. stdout is the MCP JSON-RPC channel;
 * all logging goes to a file.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const LOG = process.env.BABOU_MOCK_LOG ?? "mock-calls.jsonl";

function rid(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("base64url").slice(0, 21)}`;
}

function record(tool: string, args: unknown): void {
  appendFileSync(LOG, JSON.stringify({ tool, args, ts: Date.now() }) + "\n");
}

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

const server = new McpServer({ name: "babou-mock", version: "0.1.0" });

server.registerTool(
  "ListProjects",
  { description: "List all your projects.", inputSchema: {} },
  async () => {
    record("ListProjects", {});
    // A fresh mock has no prior projects; the agent should then create one.
    return ok({ data: [] });
  },
);

server.registerTool(
  "CreateProject",
  {
    description: "Create a new project with a name and description.",
    inputSchema: { name: z.string(), description: z.string().optional() },
  },
  async ({ name, description }) => {
    record("CreateProject", { name, description });
    return ok({ id: rid("prj"), name, description });
  },
);

server.registerTool(
  "AddChapter",
  {
    description: "Add a chapter to a project with a name and optional duration (seconds).",
    inputSchema: { projectId: z.string(), name: z.string(), duration: z.number().optional() },
  },
  async ({ projectId, name, duration }) => {
    record("AddChapter", { projectId, name, duration });
    return ok({ id: rid("cht"), name, duration });
  },
);

server.registerTool(
  "AddPrompt",
  {
    description: "Submit a prompt to a chapter, describing what to build.",
    inputSchema: {
      projectId: z.string(),
      chapterId: z.string(),
      content: z.string(),
      force: z.boolean().optional(),
    },
  },
  async ({ projectId, chapterId, content, force }) => {
    record("AddPrompt", { projectId, chapterId, content, force });
    return ok({ prompt_id: rid("int"), status: "processing", estimated_time: 60 });
  },
);

server.registerTool(
  "ExportProject",
  {
    description: "Export a completed project to a downloadable video file.",
    inputSchema: { projectId: z.string() },
  },
  async ({ projectId }) => {
    // Present so its non-use is provable. The pipeline must never reach here.
    record("ExportProject", { projectId });
    return ok({ id: rid("exp"), status: "exporting", estimated_time: 300 });
  },
);

await server.connect(new StdioServerTransport());
