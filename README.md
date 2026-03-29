<div align="center">
  <h1>🚀 traego</h1>
  <p><b>为 Trae IDE 量身定制的跨项目自动化任务派发与调度总线</b></p>

  <p>
    <a href="#✨-特性">特性</a> •
    <a href="#🏗️-核心架构">架构</a> •
    <a href="#🚀-快速开始">快速开始</a> •
    <a href="#💡-使用指南">使用指南</a> •
    <a href="#🛠️-mcp-工具说明">工具说明</a> •
    <a href="#❓-常见问题">FAQ</a>
  </p>
</div>

---

## 📖 简介

**traego** 旨在解决多项目、多窗口场景下的 Trae 任务派发痛点。
它基于“文件即总线”的极简架构，结合 Model Context Protocol (MCP)，允许你在统一的 Web 管理面板中跨项目下发任务，并通过系统级自动化（Windows PowerShell）自动唤起并驱动目标项目窗口内的 Trae AI 助手（Solo 模式）自动执行开发任务。

## ✨ 特性

- **🎯 统一管理面板**：提供清晰直观的 Web UI，集中化管理、派发与监控所有项目任务。
- **🤖 自动唤起执行**：借助后端的 PowerShell 自动化能力，自动寻找对应项目窗口、置前并自动填充 Prompt 执行（免去手动复制粘贴的烦恼）。
- **🔌 MCP 深度集成**：内置 `task-bridge.js` MCP Server，Trae 能够自主获取任务、汇报进度和执行摘要（Summary）。
- **⚡ 零侵入架构**：通过本地 `tasks.json` 作为轻量级消息总线，无需数据库依赖，极易部署与迁移。
- **🛡️ 鲁棒的系统交互**：内置多层窗口激活策略（基于 Win32 API 与 WScript.Shell），有效应对多桌面、权限隔离等复杂 Windows 场景。

## 🏗️ 核心架构

traego 的运行依赖三个核心组件：

1. **总线 (Event Bus - `tasks.json`)**：唯一的本地数据源，所有任务状态、心跳及执行日志都在此流转。
2. **控制端 (Management UI - `server.js` + `index.html`)**：运行在 Node.js 上的 Express 服务端与前端面板，负责任务下发、状态展示及触发系统级自动化脚本。
3. **执行端 (MCP Server - `task-bridge.js`)**：配置在 Trae 内的 MCP 桥接程序，赋予 Trae 读写 `tasks.json` 的能力，实现任务的自动接取与完成汇报。

---

## 🚀 快速开始

### 1. 环境要求
- Node.js (v18+ 推荐)
- Windows 操作系统 (自动化唤起依赖 PowerShell 及 Win32 API)
- Trae IDE

### 2. 安装部署

克隆项目并安装依赖：

```bash
git clone https://github.com/Uygniqoar/Task-dispatcher.git traego
cd traego
npm install
```

### 3. 启动管理面板

*(注意：由于自动化脚本需要操控系统窗口，建议在管理员权限的终端下启动此服务)*

```bash
npm run start-ui
```

服务启动后，在浏览器访问 [http://localhost:3200](http://localhost:3200) 即可进入控制台。

### 4. 配置 Trae MCP

在管理面板侧边栏点击 **“MCP 配置”** 复制 JSON，或者手动在 Trae 的 MCP 配置中添加以下内容：

```json
{
  "mcpServers": {
    "traego": {
      "command": "node",
      "args": ["c:/Users/rao/Desktop/IRDP/Task-dispatcher/task-bridge.js"],
      "env": {
        "TASKS_FILE_PATH": "c:/Users/rao/Desktop/IRDP/Task-dispatcher/tasks.json"
      }
    }
  }
}
```

*(⚠️ 务必确保 `args` 和 `TASKS_FILE_PATH` 替换为你本机的实际绝对路径)*

---

## 💡 使用指南

### 基本派发流程

1. **下发任务**：在管理面板中输入目标**项目路径**（例如：`C:\Projects\MyWebApp`）和具体的**任务描述 (Prompt)**，点击下发。
2. **自动触发**：
   - 后端会自动检索标题包含该项目名的 Trae 窗口。
   - 自动将该窗口置于前台，唤出 Solo 模式。
   - 自动输入带有上下文的指令并发送执行。
3. **闭环反馈**：Trae 执行完毕后，会自动调用 MCP 工具将任务标记为 `completed`，并在面板中展示包含文件修改和逻辑说明的执行简报（Summary）。

### 自动驾驶模式 (Auto-Pilot)

为了让 Trae 拥有更高的自主性，强烈建议在 Trae 的 **Settings -> Features -> User Instructions** 中添加以下系统提示词（System Prompt）：

> "你已连接到 traego MCP 工具。每当你启动或空闲时，请优先调用 `get_task` 检查是否有待处理任务。如果有 pending 任务，请直接开始开发，无需询问我。开发完成后，务必调用 `complete_task` 汇报进度，并在 `summary` 参数中简述你所做的修改。"

---

## 🛠️ MCP 工具说明

traego 为 Trae 提供了以下 MCP Tools（工具全名通常形如 `mcp_traego_<tool>`）：

- **`mcp_traego_get_task`**
  - **参数**: `projectPath` (当前项目的绝对路径)
  - **作用**: 获取指定项目下排队中的第一个 `pending` 任务，并自动将其状态锁定为 `in_progress`。
  
- **`mcp_traego_complete_task`**
  - **参数**: `taskId` (任务 ID), `summary` (可选，执行简报)
  - **作用**: 将指定任务标记为已完成，回传执行成果。

- **`mcp_traego_ping`**
  - **参数**: `projectPath`
  - **作用**: 刷新项目心跳，管理面板可通过此接口判断目标项目窗口内的 Trae 是否已成功挂载 MCP。

---

## ❓ 常见问题 (FAQ)

### Q1: 管理面板提示“无法激活 Trae 窗口 (APP_ACTIVATE_FAILED)”？
这通常是因为权限不匹配或系统限制了后台程序抢夺焦点。
**解决方案**：
1. 确保 Trae 主窗口没有最小化到托盘。如果使用了 Windows 虚拟桌面，请确保当前处于 Trae 所在的桌面。
2. **权限对齐**：如果 Trae 是以管理员权限运行的，启动管理面板的终端也必须是管理员权限，否则 PowerShell 无法向其发送按键指令。

### Q2: 任务列表中显示“路径正确但 Trae 未心跳”？
说明管理面板未检测到该项目路径下的 MCP 调用记录。
**解决方案**：
1. 确认 Trae MCP 配置中的 `TASKS_FILE_PATH` 路径是否正确。
2. 在该项目对应的 Trae 窗口中，呼出 Solo 模式，手动输入并执行一次 `@traego ping`，面板状态即会自动刷新为绿色已连接。

### Q3: 为什么发送到 Trae 的中文变成了乱码或缺失？
traego 在自动化注入指令时会自动处理大部分字符的转义（如大括号、特殊符号）。如果遇到系统级输入法干扰，请确保当前系统的默认输入状态为英文半角，或检查 `server.js` 中的 `escapeSendKeysText` 逻辑。

---

<div align="center">
  <p>Made with ❤️ by the traego Contributors.</p>
</div>
