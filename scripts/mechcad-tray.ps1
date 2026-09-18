#requires -Version 5.1
param(
  [switch]$NoBrowser,
  [int]$Port = 8001,
  [switch]$SkipShortcut,
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$PythonExe = Join-Path $Root ".venv\Scripts\python.exe"
$FrontendDir = Join-Path $Root "frontend"
$DistIndex = Join-Path $FrontendDir "dist\index.html"
$LogDir = Join-Path $Root "work\logs"
$LauncherLog = Join-Path $LogDir "mechcad-pro-launcher.log"
$IconPath = Join-Path $Root "assets\mechcad.ico"
$ScriptPath = Join-Path $PSScriptRoot "mechcad-tray.ps1"
$Url = "http://127.0.0.1:$Port/"
$HealthUrl = "http://127.0.0.1:$Port/api/health"
# 健康检查接受的服务名（产品更名前后都要认，避免启动器误判"服务未运行"）
$KnownServiceNames = @("varen-cad-api", "mechcad-ide-api")
$MutexName = "MechCAD-Launcher-$Port"
$Script:BackendProcess = $null
$Script:StartedBackend = $false
$Script:BackendOutLog = $null
$Script:BackendErrLog = $null

if (-not (Test-Path -LiteralPath $LogDir)) {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
}

function Write-LauncherLog([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $LauncherLog -Value $line -Encoding UTF8
}

function Show-Message([string]$Text) {
  [System.Windows.Forms.MessageBox]::Show(
    $Text,
    "Varen CAD IDE",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
}

function Show-Balloon([string]$Title, [string]$Text) {
  $notify = New-Object System.Windows.Forms.NotifyIcon
  $notify.Icon = [System.Drawing.SystemIcons]::Information
  $notify.Visible = $true
  $notify.BalloonTipTitle = $Title
  $notify.BalloonTipText = $Text
  $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
  $notify.ShowBalloonTip(3000)
  Start-Sleep -Milliseconds 2500
  $notify.Visible = $false
  $notify.Dispose()
}

function Test-Health {
  # 服务名在产品更名时由 mechcad-ide-api 改为 varen-cad-api。两个都接受，
  # 否则启动器永远认为服务没在运行：会重复启动 → 绑定 8001 失败 → 误报
  # "后端服务启动失败"（v0.23 修复）。
  try {
    $response = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 2
    return ($response.status -eq "ok" -and ($KnownServiceNames -contains $response.service))
  } catch {
    return $false
  }
}

function Test-PortInUse([int]$ListenPort) {
  # 用"能否连上"判断端口是否已被监听。bind 试探在 Windows 上不可靠：
  # 是否冲突取决于已监听 socket 的 SO_REUSEADDR/SO_EXCLUSIVEADDRUSE 组合，
  # 实测出现过同一端口时而判忙时而判闲；connect 直接回答"有没有人在听"。
  $client = $null
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $task = $client.ConnectAsync("127.0.0.1", $ListenPort)
    if (-not $task.Wait(600)) {
      return $false
    }
    return $client.Connected
  } catch {
    return $false
  } finally {
    if ($client) {
      try { $client.Close() } catch {}
    }
  }
}

function Get-LogTail([string]$Path, [int]$Lines = 16) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return ""
  }
  try {
    $content = Get-Content -LiteralPath $Path -Tail $Lines -ErrorAction Stop
    return (($content | ForEach-Object { $_ }) -join "`n").Trim()
  } catch {
    return ""
  }
}

function Test-PythonImports {
  $probe = "import dotenv, fastapi, uvicorn, PIL, yaml"
  try {
    $output = & $PythonExe -c $probe 2>&1 | Out-String
    return @{ ok = ($LASTEXITCODE -eq 0); detail = $output.Trim() }
  } catch {
    return @{ ok = $false; detail = $_.Exception.Message }
  }
}

function Ensure-Shortcut {
  if ($SkipShortcut) {
    return
  }
  $desktop = [Environment]::GetFolderPath("Desktop")
  if (-not $desktop) {
    return
  }
  $lnk = Join-Path $desktop "Varen CAD IDE.lnk"
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($lnk)
    $shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""
    $shortcut.WorkingDirectory = $Root
    $shortcut.Description = "Varen CAD IDE"
    if (Test-Path -LiteralPath $IconPath) {
      $shortcut.IconLocation = "$IconPath,0"
    }
    $shortcut.Save()
    Write-LauncherLog "shortcut refreshed: $lnk"
  } catch {
    Write-LauncherLog "shortcut creation failed: $($_.Exception.Message)"
  }
}

function Start-HiddenCommand([string]$CommandLine, [string]$WorkingDirectory) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec
  $psi.Arguments = "/d /s /c `"$CommandLine`""
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  return [System.Diagnostics.Process]::Start($psi)
}

function Resolve-NpmCmd {
  $command = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }
  $fallback = Join-Path $env:ProgramFiles "nodejs\npm.cmd"
  if (Test-Path -LiteralPath $fallback) {
    return $fallback
  }
  return $null
}

function Invoke-FrontendNpm([string]$NpmCmd, [string]$NpmArgs, [string]$OutLog, [string]$ErrLog) {
  $quotedNpm = "`"$NpmCmd`""
  $quotedOut = "`"$OutLog`""
  $quotedErr = "`"$ErrLog`""
  $commandLine = "$quotedNpm $NpmArgs > $quotedOut 2> $quotedErr"
  $process = Start-HiddenCommand $commandLine $FrontendDir
  $process.WaitForExit()
  return $process.ExitCode
}

function Start-Backend {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
  $outLog = Join-Path $LogDir "backend-pro-$Port-$stamp.out.log"
  $errLog = Join-Path $LogDir "backend-pro-$Port-$stamp.err.log"
  $Script:BackendOutLog = $outLog
  $Script:BackendErrLog = $errLog
  [Environment]::SetEnvironmentVariable("MECHCAD_PORT", [string]$Port)
  [Environment]::SetEnvironmentVariable("MECHCAD_HOST", "127.0.0.1")
  $quotedPython = "`"$PythonExe`""
  $quotedOut = "`"$outLog`""
  $quotedErr = "`"$errLog`""
  $commandLine = "$quotedPython -m backend.main > $quotedOut 2> $quotedErr"
  $process = Start-HiddenCommand $commandLine $Root
  $Script:BackendProcess = $process
  $Script:StartedBackend = $true
  Write-LauncherLog "backend started pid=$($process.Id) out=$outLog err=$errLog"
}

function Wait-BackendReady([int]$Attempts = 120) {
  for ($i = 0; $i -lt $Attempts; $i++) {
    if (Test-Health) {
      return $true
    }
    if ($Script:BackendProcess -and $Script:BackendProcess.HasExited) {
      Write-LauncherLog "backend process exited during startup code=$($Script:BackendProcess.ExitCode)"
      return $false
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Show-BackendFailure([string]$Title) {
  $detail = Get-LogTail $Script:BackendErrLog
  if (-not $detail) {
    $detail = Get-LogTail $Script:BackendOutLog
  }
  if ($detail) {
    Show-Message "$Title`n`n$detail`n`n完整日志：$LogDir"
  } else {
    Show-Message "$Title`n请查看日志目录：$LogDir"
  }
}

function Stop-Backend {
  if ($Script:BackendProcess -and -not $Script:BackendProcess.HasExited) {
    $targetPid = $Script:BackendProcess.Id
    try {
      & taskkill.exe /PID $targetPid /T /F 2>$null | Out-Null
    } catch {
      Write-LauncherLog "backend kill failed: $($_.Exception.Message)"
    }
    try {
      $Script:BackendProcess.WaitForExit(5000) | Out-Null
    } catch {
    }
  }
  $Script:BackendProcess = $null
  $Script:StartedBackend = $false
}

function Restart-BackendService {
  Stop-Backend
  Start-Sleep -Milliseconds 500
  Start-Backend
  if (Wait-BackendReady) {
    Show-Balloon "Varen CAD IDE" "服务已重启：$Url"
  } else {
    Show-BackendFailure "服务重启失败。"
  }
}

if ($CheckOnly) {
  $check = [ordered]@{
    python = Test-Path -LiteralPath $PythonExe
    dist = Test-Path -LiteralPath $DistIndex
    port = $Port
    health = Test-Health
  }
  $check | ConvertTo-Json -Compress
  exit 0
}

$mutex = New-Object System.Threading.Mutex($false, $MutexName)
$hasHandle = $mutex.WaitOne(0)
if (-not $hasHandle) {
  if (Test-Health) {
    if (-not $NoBrowser -and $env:MECHCAD_OPEN_BROWSER -ne "0") {
      Start-Process $Url
    }
    Show-Balloon "Varen CAD IDE" "Varen CAD 已在运行，已打开界面"
  } else {
    Show-Message "Varen CAD 已在运行，但服务尚未就绪。请稍后再试，或从系统托盘重启服务。"
  }
  $mutex.Dispose()
  exit 0
}

try {
  if (-not (Test-Path -LiteralPath $PythonExe)) {
    Show-Message "未找到 Python 环境：`n$PythonExe`n`n请先完成依赖安装，再启动 Varen CAD。"
    exit 1
  }

  $imports = Test-PythonImports
  if (-not $imports.ok) {
    Write-LauncherLog "python imports failed: $($imports.detail)"
    Show-Message "Python 依赖不完整，后端无法启动。`n`n请先运行：`n.\.venv\Scripts\python.exe -m pip install -r requirements.txt`n`n$($imports.detail)"
    exit 1
  }

  if (-not (Test-Path -LiteralPath $DistIndex)) {
    $npmCmd = Resolve-NpmCmd
    if (-not $npmCmd) {
      Show-Message "未找到 npm。请先安装 Node.js，并确保 npm.cmd 可用，再启动 Varen CAD。"
      exit 1
    }

    $tscCmd = Join-Path $FrontendDir "node_modules\.bin\tsc.cmd"
    if (-not (Test-Path -LiteralPath $tscCmd)) {
      Show-Balloon "Varen CAD IDE" "首次启动需要安装前端依赖，请稍候..."
      Write-LauncherLog "frontend node_modules missing, installing..."
      $installOut = Join-Path $LogDir "frontend-install-$Port.out.log"
      $installErr = Join-Path $LogDir "frontend-install-$Port.err.log"
      $installCode = Invoke-FrontendNpm $npmCmd "install" $installOut $installErr
      if ($installCode -ne 0 -or -not (Test-Path -LiteralPath $tscCmd)) {
        Show-Message "前端依赖安装失败，请查看日志：`n$installErr"
        exit 1
      }
      Write-LauncherLog "frontend npm install completed"
    }

    Show-Balloon "Varen CAD IDE" "首次启动需要构建前端界面，请稍候..."
    Write-LauncherLog "frontend dist missing, building..."
    $buildOut = Join-Path $LogDir "frontend-build-$Port.out.log"
    $buildErr = Join-Path $LogDir "frontend-build-$Port.err.log"
    $buildCode = Invoke-FrontendNpm $npmCmd "run build" $buildOut $buildErr
    if ($buildCode -ne 0 -or -not (Test-Path -LiteralPath $DistIndex)) {
      Show-Message "前端构建失败，请查看日志：`n$buildErr"
      exit 1
    }
    Write-LauncherLog "frontend build completed"
  }

  if (Test-Health) {
    Write-LauncherLog "reusing running backend on port $Port"
    Show-Balloon "Varen CAD IDE" "已连接正在运行的服务：$Url"
  } else {
    if (Test-PortInUse $Port) {
      Show-Message "端口 $Port 已被其他程序占用。`n请关闭占用程序，或使用 -Port 指定其他端口。"
      exit 1
    }
    Show-Balloon "Varen CAD IDE" "正在启动后端服务..."
    Start-Backend
    if (-not (Wait-BackendReady)) {
      # 复核：后端启动失败最常见的原因其实是"服务已经在跑"（健康检查超时或
      # 端口被占）。此时应复用而不是报"启动失败"——v0.23 前这里会让用户以为
      # 后台坏了。
      if (Test-Health -or (Test-PortInUse $Port)) {
        Write-LauncherLog "backend start failed but port $Port already serving; reusing"
        Show-Balloon "Varen CAD IDE" "服务已在运行：$Url"
        Stop-Backend
      } else {
        Show-BackendFailure "后端服务启动失败。"
        Stop-Backend
        exit 1
      }
    } else {
      Write-LauncherLog "backend ready on port $Port"
    }
  }

  Ensure-Shortcut

  if (-not $NoBrowser -and $env:MECHCAD_OPEN_BROWSER -ne "0") {
    Start-Process $Url
  }

  $tray = New-Object System.Windows.Forms.NotifyIcon
  if (Test-Path -LiteralPath $IconPath) {
    try {
      $tray.Icon = New-Object System.Drawing.Icon($IconPath)
    } catch {
      $tray.Icon = [System.Drawing.SystemIcons]::Application
    }
  } else {
    $tray.Icon = [System.Drawing.SystemIcons]::Application
  }
  $tray.Text = "Varen CAD IDE - 端口 $Port"
  $tray.Visible = $true

  $menu = New-Object System.Windows.Forms.ContextMenu
  $openItem = New-Object System.Windows.Forms.MenuItem("打开界面")
  $openItem.add_Click({ Start-Process $Url })
  $restartItem = New-Object System.Windows.Forms.MenuItem("重启服务")
  $restartItem.add_Click({ Restart-BackendService })
  $logItem = New-Object System.Windows.Forms.MenuItem("打开日志")
  $logItem.add_Click({ Start-Process explorer.exe $LogDir })
  $exitItem = New-Object System.Windows.Forms.MenuItem("退出")
  $exitItem.add_Click({
    Stop-Backend
    $tray.Visible = $false
    $tray.Dispose()
    $context.ExitThread()
  })
  $menu.MenuItems.AddRange(@($openItem, $restartItem, $logItem, $exitItem))
  $tray.ContextMenu = $menu

  Show-Balloon "Varen CAD IDE" "Varen CAD 已在后台运行：$Url"

  $context = New-Object System.Windows.Forms.ApplicationContext
  [System.Windows.Forms.Application]::Run($context)

  $tray.Visible = $false
  $tray.Dispose()
  Write-LauncherLog "launcher exited"
} finally {
  if ($hasHandle) {
    try { $mutex.ReleaseMutex() } catch {}
    $mutex.Dispose()
  }
}
