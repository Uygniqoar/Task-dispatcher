import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { exec } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TASKS_FILE = process.env.TASKS_FILE_PATH || path.join(__dirname, "tasks.json");

const appApi = express();
const appUi = express();
const API_PORT = process.env.API_PORT || 4100;
const UI_PORT = process.env.UI_PORT || 3200;

appApi.use(cors());
appApi.use(bodyParser.json());

appUi.use(cors());
appUi.use(bodyParser.json());
appUi.use(express.static(path.join(__dirname, "public")));

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

function registerApiRoutes(app) {
  function escapeSendKeysText(text) {
    return String(text)
      .replace(/\r\n|\r|\n/g, "{ENTER}")
      .replace(/\{/g, "{{}")
      .replace(/\}/g, "{}}")
      .replace(/\+/g, "{+}")
      .replace(/\^/g, "{^}")
      .replace(/%/g, "{%}")
      .replace(/~/g, "{~}");
  }

  function runEncodedPowerShell(script, callback) {
    const tmp = path.join(os.tmpdir(), `traego-${crypto.randomUUID()}.ps1`);
    fs.writeFile(tmp, `\ufeff${script}`, "utf8")
      .then(() => {
        exec(
          `powershell -NoProfile -ExecutionPolicy Bypass -STA -File "${tmp}"`,
          (error, stdout, stderr) => {
            fs.unlink(tmp).catch(() => {});
            callback(error, stdout, stderr);
          }
        );
      })
      .catch((err) => {
        callback(err, "", String(err));
      });
  }

  app.get("/api/health", async (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.get("/api/tasks", async (req, res) => {
    const data = await readTasks();
    res.json(data);
  });

  app.get("/api/config", (req, res) => {
    const bridgePath = path.join(__dirname, "task-bridge.js");
    const tasksPath = TASKS_FILE;

    const config = {
      mcpServers: {
        "traego": {
          command: "node",
          args: [bridgePath],
          env: {
            TASKS_FILE_PATH: tasksPath
          }
        }
      }
    };
    res.json(config);
  });

  app.get("/api/check-connection", async (req, res) => {
    const { projectPath } = req.query;
    if (!projectPath) {
      return res.status(400).json({ error: "projectPath is required" });
    }

    try {
      const normalizedPath = path.normalize(projectPath);
      const data = await readTasks();
      const stats = await fs.stat(normalizedPath);
      const projectStatus = data.projectStatus ? data.projectStatus[normalizedPath.toLowerCase()] : null;

      if (stats.isDirectory()) {
        res.json({
          status: "ok",
          message: "Path is a valid directory",
          path: normalizedPath,
          lastHeartbeat: projectStatus ? projectStatus.lastHeartbeat : null
        });
      } else {
        res.json({
          status: "warn",
          message: "Path exists but is not a directory",
          path: normalizedPath,
          lastHeartbeat: projectStatus ? projectStatus.lastHeartbeat : null
        });
      }
    } catch (error) {
      res.json({ status: "error", message: "Path does not exist or is inaccessible", error: error.message });
    }
  });

  app.post("/api/tasks", async (req, res) => {
    const { prompt, projectPath } = req.body;
    if (!prompt || !projectPath) {
      return res.status(400).json({ error: "Prompt and projectPath are required" });
    }

    const data = await readTasks();
    const newTask = {
      id: Date.now().toString(),
      prompt,
      projectPath: path.normalize(projectPath),
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    data.tasks.push(newTask);
    await writeTasks(data);
    res.json(newTask);
  });

  app.post("/api/tasks/:id/execute", async (req, res) => {
    const { id } = req.params;
    const data = await readTasks();
    const taskIndex = data.tasks.findIndex(t => t.id === id);

    if (taskIndex === -1) {
      return res.status(404).json({ error: "Task not found" });
    }

    const task = data.tasks[taskIndex];

    if (task.status !== "pending") {
      return res.status(409).json({ error: `Task is not pending (current: ${task.status})` });
    }

    const now = new Date().toISOString();
    task.status = "dispatching";
    task.dispatch = task.dispatch || {};
    task.dispatch.attempts = (task.dispatch.attempts || 0) + 1;
    task.dispatch.lastAttemptAt = now;
    task.dispatch.phase = "starting";
    task.dispatch.ok = null;
    task.dispatch.error = null;
    task.dispatch.details = null;
    task.startedAt = now;
    await writeTasks(data);

    const projectName = path.basename(task.projectPath);
    const sendText = escapeSendKeysText(
      `${task.prompt}\n\n请在完成后调用 @traego complete_task，taskId=${task.id}，并在 summary 里简述你做了什么。`
    );
    const soloKeys = process.env.TRAE_SOLO_KEYS || "^i";
    const resultPrefix = "TRAEGO_RESULT=";
    const psScript = `
      $ProgressPreference = "SilentlyContinue";
      $ErrorActionPreference = "SilentlyContinue";
      $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);
      if (-not $isAdmin) { Write-Output "${resultPrefix}NEED_ADMIN"; exit 3; }

      Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);

  public static uint GetForegroundProcessId() {
    IntPtr fg = GetForegroundWindow();
    if (fg == IntPtr.Zero) return 0;
    GetWindowThreadProcessId(fg, out uint pid);
    return pid;
  }

  public static string GetTitle(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero) return "";
    int len = GetWindowTextLength(hWnd);
    if (len <= 0) return "";
    var sb = new StringBuilder(len + 1);
    GetWindowText(hWnd, sb, sb.Capacity);
    return sb.ToString();
  }

  public static bool ForceForeground(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero) return false;
    ShowWindowAsync(hWnd, 9);
    IntPtr fg = GetForegroundWindow();
    uint fgTid = GetWindowThreadProcessId(fg, out _);
    uint curTid = GetCurrentThreadId();
    if (fgTid != curTid) AttachThreadInput(fgTid, curTid, true);
    AllowSetForegroundWindow(-1);
    BringWindowToTop(hWnd);
    bool ok = SetForegroundWindow(hWnd);
    SetFocus(hWnd);
    if (fgTid != curTid) AttachThreadInput(fgTid, curTid, false);
    return ok;
  }
}
"@ -ErrorAction SilentlyContinue;

      $wshell = New-Object -ComObject WScript.Shell;

      $candidates = @();
      try { $candidates += Get-Process -Name "Trae" -ErrorAction SilentlyContinue } catch {}
      try { $candidates += Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -like "*Trae*" } } catch {}

      $traeWindows = $candidates |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        Group-Object Id |
        ForEach-Object { $_.Group | Select-Object -First 1 } |
        ForEach-Object {
          $t = [Win32]::GetTitle([IntPtr]$_.MainWindowHandle);
          $_ | Add-Member -NotePropertyName "WindowTitle" -NotePropertyValue $t -Force;
          $_
        };

      if (-not $traeWindows -or $traeWindows.Count -eq 0) {
        Write-Output "${resultPrefix}TRAE_WINDOW_NOT_FOUND";
        exit 1;
      }

      $target = $traeWindows | Where-Object { $_.WindowTitle -like "*${projectName}*" } | Select-Object -First 1;
      if (-not $target) {
        $fgPid = [Win32]::GetForegroundProcessId();
        if ($fgPid -ne 0) { $target = $traeWindows | Where-Object { $_.Id -eq $fgPid } | Select-Object -First 1; }
      }
      if (-not $target) { $target = $traeWindows | Where-Object { $_.WindowTitle -like "*Trae*" } | Select-Object -First 1; }
      if (-not $target) { $target = $traeWindows | Select-Object -First 1; }

      function Try-Activate([object]$p) {
        if (-not $p) { return $false }
        if ($p.MainWindowHandle -eq 0) { return $false }
        $wshell.SendKeys("%");
        Start-Sleep -Milliseconds 80;
        [Win32]::ForceForeground([IntPtr]$p.MainWindowHandle) | Out-Null;
        Start-Sleep -Milliseconds 120;
        if ([Win32]::GetForegroundProcessId() -eq [uint32]$p.Id) { return $true }
        $ok = $wshell.AppActivate($p.Id);
        if (-not $ok -and $p.WindowTitle) { $ok = $wshell.AppActivate($p.WindowTitle); }
        Start-Sleep -Milliseconds 120;
        if ([Win32]::GetForegroundProcessId() -eq [uint32]$p.Id) { return $true }
        return [bool]$ok;
      }

      $ok = $false;
      for ($i = 0; $i -lt 6 -and -not $ok; $i++) {
        $ok = Try-Activate $target;
        if (-not $ok) { Start-Sleep -Milliseconds 250; }
      }

      if (-not $ok) {
        $summary = ($traeWindows | Select-Object -First 6 | ForEach-Object { "$($_.Id):$($_.MainWindowHandle):$($_.WindowTitle)" }) -join " | ";
        Write-Output "DETAILS fgPid=$([Win32]::GetForegroundProcessId()) targetId=$($target.Id) handle=$($target.MainWindowHandle) title=$($target.WindowTitle) candidates=$summary";
        Write-Output "${resultPrefix}APP_ACTIVATE_FAILED";
        exit 2;
      }

      Start-Sleep -Milliseconds 500;
      $wshell.SendKeys("${soloKeys}");
      Start-Sleep -Milliseconds 800;
      $wshell.SendKeys("${sendText}");
      Start-Sleep -Milliseconds 200;
      $wshell.SendKeys("{ENTER}");
      Write-Output "${resultPrefix}SENT";
      exit 0;
    `;

    runEncodedPowerShell(psScript, async (error, stdout, stderr) => {
      const combined = `${stdout || ""}\n${stderr || ""}`;
      const resultLine = combined
        .split(/\r?\n/)
        .find((l) => l.includes(resultPrefix));
      const resultCode = resultLine ? resultLine.split(resultPrefix).pop().trim() : null;

      if (error) {
        console.error(`Execution error: ${error}`);
        const refresh = await readTasks();
        const idx = refresh.tasks.findIndex(t => t.id === id);
        if (idx !== -1) {
          refresh.tasks[idx].dispatch = refresh.tasks[idx].dispatch || {};
          refresh.tasks[idx].dispatch.phase = "failed";
          refresh.tasks[idx].dispatch.ok = false;
          refresh.tasks[idx].dispatch.error =
            resultCode ||
            (String(stderr || "").match(/NEED_ADMIN|APP_ACTIVATE_FAILED|TRAE_WINDOW_NOT_FOUND/) || [])[0] ||
            "POWERSHELL_FAILED";
          refresh.tasks[idx].dispatch.details = String(stderr || stdout || "").slice(0, 2000) || null;
          refresh.tasks[idx].status = "pending";
          delete refresh.tasks[idx].startedAt;
          await writeTasks(refresh);
        }
        return res.status(500).json({ error: "Failed to trigger Trae automation. Is Trae running?", details: stderr });
      }
      const refresh = await readTasks();
      const idx = refresh.tasks.findIndex(t => t.id === id);
      if (idx !== -1) {
        refresh.tasks[idx].dispatch = refresh.tasks[idx].dispatch || {};
        refresh.tasks[idx].dispatch.phase = "sent";
        refresh.tasks[idx].dispatch.ok = true;
        refresh.tasks[idx].status = "in_progress";
        await writeTasks(refresh);
      }
      res.json({ success: true, message: "Task execution triggered in Trae" });
    });
  });

  app.post("/api/open-in-trae", async (req, res) => {
    const { projectPath } = req.body || {};
    if (!projectPath) {
      return res.status(400).json({ error: "projectPath is required" });
    }

    const projectName = path.basename(path.normalize(projectPath));
    const psScript = `
      $ProgressPreference = "SilentlyContinue";
      $ErrorActionPreference = "SilentlyContinue";
      $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);
      if (-not $isAdmin) { Write-Output "TRAEGO_RESULT=NEED_ADMIN"; exit 3; }

      Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);

  public static uint GetForegroundProcessId() {
    IntPtr fg = GetForegroundWindow();
    if (fg == IntPtr.Zero) return 0;
    GetWindowThreadProcessId(fg, out uint pid);
    return pid;
  }

  public static string GetTitle(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero) return "";
    int len = GetWindowTextLength(hWnd);
    if (len <= 0) return "";
    var sb = new StringBuilder(len + 1);
    GetWindowText(hWnd, sb, sb.Capacity);
    return sb.ToString();
  }

  public static bool ForceForeground(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero) return false;
    ShowWindowAsync(hWnd, 9);
    IntPtr fg = GetForegroundWindow();
    uint fgTid = GetWindowThreadProcessId(fg, out _);
    uint curTid = GetCurrentThreadId();
    if (fgTid != curTid) AttachThreadInput(fgTid, curTid, true);
    AllowSetForegroundWindow(-1);
    BringWindowToTop(hWnd);
    bool ok = SetForegroundWindow(hWnd);
    SetFocus(hWnd);
    if (fgTid != curTid) AttachThreadInput(fgTid, curTid, false);
    return ok;
  }
}
"@ -ErrorAction SilentlyContinue;

      $wshell = New-Object -ComObject WScript.Shell;

      $candidates = @();
      try { $candidates += Get-Process -Name "Trae" -ErrorAction SilentlyContinue } catch {}
      try { $candidates += Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -like "*Trae*" } } catch {}

      $traeWindows = $candidates |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        Group-Object Id |
        ForEach-Object { $_.Group | Select-Object -First 1 } |
        ForEach-Object {
          $t = [Win32]::GetTitle([IntPtr]$_.MainWindowHandle);
          $_ | Add-Member -NotePropertyName "WindowTitle" -NotePropertyValue $t -Force;
          $_
        };

      if (-not $traeWindows -or $traeWindows.Count -eq 0) { exit 1; }

      $target = $traeWindows | Where-Object { $_.WindowTitle -like "*${projectName}*" } | Select-Object -First 1;
      if (-not $target) {
        $fgPid = [Win32]::GetForegroundProcessId();
        if ($fgPid -ne 0) { $target = $traeWindows | Where-Object { $_.Id -eq $fgPid } | Select-Object -First 1; }
      }
      if (-not $target) { $target = $traeWindows | Where-Object { $_.WindowTitle -like "*Trae*" } | Select-Object -First 1; }
      if (-not $target) { $target = $traeWindows | Select-Object -First 1; }

      function Try-Activate([object]$p) {
        if (-not $p) { return $false }
        if ($p.MainWindowHandle -eq 0) { return $false }
        $wshell.SendKeys("%");
        Start-Sleep -Milliseconds 80;
        [Win32]::ForceForeground([IntPtr]$p.MainWindowHandle) | Out-Null;
        Start-Sleep -Milliseconds 120;
        if ([Win32]::GetForegroundProcessId() -eq [uint32]$p.Id) { return $true }
        $ok = $wshell.AppActivate($p.Id);
        if (-not $ok -and $p.WindowTitle) { $ok = $wshell.AppActivate($p.WindowTitle); }
        Start-Sleep -Milliseconds 120;
        if ([Win32]::GetForegroundProcessId() -eq [uint32]$p.Id) { return $true }
        return [bool]$ok;
      }

      $ok = $false;
      for ($i = 0; $i -lt 6 -and -not $ok; $i++) {
        $ok = Try-Activate $target;
        if (-not $ok) { Start-Sleep -Milliseconds 250; }
      }

      if (-not $ok) {
        $summary = ($traeWindows | Select-Object -First 6 | ForEach-Object { "$($_.Id):$($_.MainWindowHandle):$($_.WindowTitle)" }) -join " | ";
        Write-Output "DETAILS fgPid=$([Win32]::GetForegroundProcessId()) targetId=$($target.Id) handle=$($target.MainWindowHandle) title=$($target.WindowTitle) candidates=$summary";
        Write-Error "APP_ACTIVATE_FAILED";
        exit 2;
      }
      exit 0;
    `;

    runEncodedPowerShell(psScript, (error, stdout, stderr) => {
      if (error) {
        console.error(`Open-in-Trae error: ${error}`);
        return res.status(500).json({ error: "Failed to focus Trae window. Is Trae running?", details: stderr });
      }
      res.json({ success: true, message: "Trae focused" });
    });
  });

  app.delete("/api/tasks/:id", async (req, res) => {
    const { id } = req.params;
    const data = await readTasks();
    const initialCount = data.tasks.length;
    data.tasks = data.tasks.filter(t => t.id !== id);

    if (data.tasks.length < initialCount) {
      await writeTasks(data);
      res.json({ success: true, message: `Task ${id} deleted` });
    } else {
      res.status(404).json({ error: "Task not found" });
    }
  });

  app.post("/api/tasks/:id/reset", async (req, res) => {
    const { id } = req.params;
    const data = await readTasks();
    const idx = data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    data.tasks[idx].status = "pending";
    delete data.tasks[idx].startedAt;
    delete data.tasks[idx].dispatch;
    await writeTasks(data);
    res.json({ success: true, message: `Task ${id} reset to pending` });
  });
}

registerApiRoutes(appApi);
registerApiRoutes(appUi);

appApi.listen(API_PORT, "0.0.0.0", () => {
  console.log(`API Server running at http://0.0.0.0:${API_PORT}`);
});

appUi.listen(UI_PORT, "0.0.0.0", () => {
  console.log(`Management UI Server running at http://0.0.0.0:${UI_PORT}`);
});
