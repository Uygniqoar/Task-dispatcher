import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TASKS_FILE = process.env.TASKS_FILE_PATH || path.join(__dirname, "tasks.json");

const server = new Server(
  {
    name: "TaskConnector",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

async function readTasks() {
  try {
    const data = await fs.readFile(TASKS_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    return { tasks: [] };
  }
}

async function writeTasks(data) {
  await fs.writeFile(TASKS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_task",
        description: "Get the next pending task for a project and mark it as in_progress.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "The absolute path of the current project.",
            },
          },
        },
      },
      {
        name: "complete_task",
        description: "Mark a task as completed with an optional summary of changes.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "The ID of the task to complete.",
            },
            summary: {
              type: "string",
              description: "A summary of what was accomplished, files changed, and logic implemented.",
            },
          },
          required: ["taskId"],
        },
      },
      {
        name: "ping",
        description: "Update the heartbeat for the current project to show it is connected.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "The absolute path of the current project.",
            },
          },
        },
      },
    ],
  };
});

function resolveProjectPath(args) {
  const candidate =
    typeof args?.projectPath === "string" && args.projectPath.trim()
      ? args.projectPath.trim()
      : process.env.PROJECT_PATH || process.env.WORKSPACE_PATH || process.cwd();
  return path.normalize(candidate);
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const data = await readTasks();
  if (!data.projectStatus) data.projectStatus = {};

  if (name === "ping" || name === "get_task") {
    const projectPath = resolveProjectPath(args);
    console.error(`Heartbeat update from Trae for: ${projectPath}`);

    // Update heartbeat for this project
    data.projectStatus[projectPath.toLowerCase()] = {
      lastHeartbeat: new Date().toISOString(),
      path: projectPath
    };
    await writeTasks(data);
    
    if (name === "ping") {
      return {
        content: [{ type: "text", text: `Heartbeat updated for ${projectPath}` }],
      };
    }
  }

  if (name === "get_task") {
    const projectPath = resolveProjectPath(args);
    console.error(`Trae is checking for tasks in: ${projectPath}`);

    const taskIndex = data.tasks.findIndex(
      (t) => path.normalize(t.projectPath).toLowerCase() === projectPath.toLowerCase() && t.status === "pending"
    );

    if (taskIndex !== -1) {
      const task = data.tasks[taskIndex];
      // Mark as in_progress when fetched
      task.status = "in_progress";
      task.startedAt = new Date().toISOString();
      console.error(`Found pending task for ${projectPath}: ${task.id}. Marking as in_progress.`);
      
      await writeTasks(data);
      
      return {
        content: [{ type: "text", text: JSON.stringify(task) }],
      };
    } else {
      return {
        content: [{ type: "text", text: "No pending tasks found for this project." }],
      };
    }
  }

  if (name === "complete_task") {
    console.error(`Trae is completing task: ${args.taskId}`);
    const taskIndex = data.tasks.findIndex((t) => t.id === args.taskId);
    if (taskIndex !== -1) {
      data.tasks[taskIndex].status = "completed";
      data.tasks[taskIndex].completedAt = new Date().toISOString();
      if (args.summary) {
        data.tasks[taskIndex].summary = args.summary;
      }
      await writeTasks(data);
      return {
        content: [{ type: "text", text: `Task ${args.taskId} marked as completed.` }],
      };
    } else {
      return {
        content: [{ type: "text", text: `Task with ID ${args.taskId} not found.` }],
      };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("TaskConnector MCP server running on stdio");
