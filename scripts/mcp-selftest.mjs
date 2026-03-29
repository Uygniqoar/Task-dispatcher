import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const projectPath = repoRoot;

function nowIdFactory() {
  let id = 0;
  return () => (++id).toString();
}

async function main() {
  const mkd = await fs.mkdtemp(path.join(os.tmpdir(), "traego-mcp-selftest-"));
  const tasksFile = path.join(mkd, "tasks.json");

  const seed = {
    tasks: [
      {
        id: Date.now().toString(),
        prompt: "mcp-selftest",
        projectPath,
        status: "pending",
        createdAt: new Date().toISOString(),
      },
    ],
    projectStatus: {},
  };
  await fs.writeFile(tasksFile, JSON.stringify(seed, null, 2), "utf-8");

  const child = spawn(process.execPath, [path.join(repoRoot, "task-bridge.js")], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      TASKS_FILE_PATH: tasksFile,
    },
  });

  const rl = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let closed = false;
  const makeId = nowIdFactory();

  function send(msg) {
    child.stdin.write(JSON.stringify(msg) + "\n");
  }

  function request(method, params) {
    const id = makeId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout waiting response for id=${id} method=${method}`));
      }, 8000);
      pending.set(id, { resolve, reject, timer });
      send({ jsonrpc: "2.0", id, method, params });
    });
  }

  rl.on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!msg || msg.jsonrpc !== "2.0" || msg.id == null) return;
    const slot = pending.get(String(msg.id));
    if (!slot) return;
    clearTimeout(slot.timer);
    pending.delete(String(msg.id));
    if (msg.error) slot.reject(new Error(msg.error.message || "jsonrpc error"));
    else slot.resolve(msg.result);
  });

  child.on("close", (code) => {
    closed = true;
    for (const [, slot] of pending) {
      clearTimeout(slot.timer);
      slot.reject(new Error(`child closed with code=${code}`));
    }
    pending.clear();
  });

  await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "mcp-selftest", version: "0.0.0" },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

  const toolsList = await request("tools/list", {});
  const toolNames = new Set((toolsList?.tools || []).map((t) => t.name));
  for (const n of ["get_task", "complete_task", "ping"]) {
    if (!toolNames.has(n)) throw new Error(`missing tool: ${n}`);
  }

  await request("tools/call", { name: "ping", arguments: { projectPath } });

  const getTaskResult = await request("tools/call", { name: "get_task", arguments: { projectPath } });
  const text = getTaskResult?.content?.[0]?.text;
  const task = JSON.parse(text);

  await request("tools/call", {
    name: "complete_task",
    arguments: { taskId: task.id, summary: "mcp-selftest-ok" },
  });

  const after = JSON.parse(await fs.readFile(tasksFile, "utf-8"));
  const t = after.tasks.find((x) => x.id === task.id);
  if (!t) throw new Error("task not found in tasks.json after completion");
  if (t.status !== "completed") throw new Error(`unexpected task status: ${t.status}`);
  if (t.summary !== "mcp-selftest-ok") throw new Error("summary not saved");

  const hb = after.projectStatus?.[projectPath.toLowerCase()];
  if (!hb?.lastHeartbeat) throw new Error("heartbeat not updated");

  rl.close();
  if (!closed) child.kill();
  await fs.rm(mkd, { recursive: true, force: true });
  process.stdout.write("OK\n");
}

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + "\n");
  process.exitCode = 1;
});
