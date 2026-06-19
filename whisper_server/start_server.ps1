# b量子阅读 - Whisper 语音识别服务启动脚本
# Whisper ASR Service Launcher
param(
    [string]$Model = $env:WHISPER_MODEL,
    [string]$Device = $env:WHISPER_DEVICE,
    [string]$ComputeType = $env:WHISPER_COMPUTE_TYPE,
    [int]$Port = 8787,
    [switch]$Repair
)

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Set-Location $scriptDir
$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "============================================" -ForegroundColor Magenta
Write-Host "  b量子阅读 - Whisper 语音识别服务" -ForegroundColor White
Write-Host "  Whisper ASR Service" -ForegroundColor DarkGray
Write-Host "============================================" -ForegroundColor Magenta
Write-Host ""

# ====== 查找 Python / Find Python ======
Write-Host "[1/4] 查找 Python 环境 / Finding Python..." -ForegroundColor Cyan
$pyCmd = $null

# 优先使用 .venv（如果存在）
$venvPython = Join-Path $scriptDir ".venv\Scripts\python.exe"
if (Test-Path $venvPython) {
    Write-Host "        发现 .venv 环境，优先使用" -ForegroundColor DarkGray
    $pyCmd = $venvPython
} else {
    # 候选列表：python3, python, py（launcher）, 以及已安装目录
    $candidates = @()
    foreach ($cmd in @("python3", "python", "py")) {
        $r = Get-Command $cmd -ErrorAction SilentlyContinue
        if ($r) { $candidates += $cmd }
    }
    foreach ($pattern in @("$env:LocalAppData\Programs\Python\Python3*", "$env:ProgramFiles\Python3*")) {
        $dirs = Get-Item $pattern -ErrorAction SilentlyContinue | Sort-Object Name -Descending
        foreach ($dir in $dirs) {
            $exe = Join-Path $dir.FullName "python.exe"
            if (Test-Path $exe) { $candidates += $exe }
        }
    }

    # 逐个验证：版本号 + pip 同时可用
    foreach ($c in $candidates) {
        $ver = & $c --version 2>&1
        if ($LASTEXITCODE -ne 0) { continue }
        $pipVer = & $c -m pip --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $pyCmd = $c
            break
        }
        Write-Host "       $c 已找到但无 pip（可能是 Store 版本），跳过..." -ForegroundColor DarkGray
    }
}

if (-not $pyCmd) {
    Write-Host "[FAIL] 未找到可用的 Python / No usable Python found" -ForegroundColor Red
    Write-Host ""
    Write-Host "请安装 Python 3.8+ : https://python.org" -ForegroundColor Yellow
    Write-Host "安装时务必勾选 Add Python to PATH" -ForegroundColor Yellow
    Write-Host "如果已安装但 pip 不可用，请运行: python -m ensurepip" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[ OK ] $pyCmd" -ForegroundColor Green
& $pyCmd --version
Write-Host ""

# ====== 检查依赖 / Check Dependencies ======
Write-Host "[2/4] 检查依赖包 / Checking dependencies..." -ForegroundColor Cyan
$missing = $false

# 如果用了 .venv，跳过依赖检查（venv 保证已安装）
if ($pyCmd -eq $venvPython) {
    Write-Host "       .venv 环境，跳过依赖检查" -ForegroundColor DarkGray
} else {
    $flaskCheck = & $pyCmd -c "import flask; print(flask.__version__)" 2>&1
    if ($LASTEXITCODE -ne 0) {
        $missing = $true
    } else {
        Write-Host "       flask: $flaskCheck" -ForegroundColor DarkGray
    }

    $fwCheck = & $pyCmd -c "import faster_whisper; print('OK')" 2>&1
    if ($LASTEXITCODE -ne 0) {
        $missing = $true
    } else {
        Write-Host "       faster-whisper: OK" -ForegroundColor DarkGray
    }

    if ($missing) {
        Write-Host "[INFO] 正在安装依赖包 / Installing dependencies..." -ForegroundColor Yellow
        & $pyCmd -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[FAIL] 安装失败 / Install failed" -ForegroundColor Red
            Write-Host "手动执行: cd whisper_server && pip install -r requirements.txt" -ForegroundColor Yellow
            Read-Host "Press Enter to exit"
            exit 1
        }
        Write-Host "[ OK ] 依赖安装完成 / Dependencies installed" -ForegroundColor Green
    } else {
        Write-Host "[ OK ] 依赖已就绪 / Dependencies ready" -ForegroundColor Green
    }
}
Write-Host ""

# ====== 加载配置 / Config ======
Write-Host "[3/4] 加载配置 / Loading config..." -ForegroundColor Cyan

# 模型 / 设备 / 精度
if ($Model) { $env:WHISPER_MODEL = $Model } elseif (-not $env:WHISPER_MODEL) { $env:WHISPER_MODEL = "small" }
if ($Device) { $env:WHISPER_DEVICE = $Device } elseif (-not $env:WHISPER_DEVICE) { $env:WHISPER_DEVICE = "cpu" }
if ($ComputeType) { $env:WHISPER_COMPUTE_TYPE = $ComputeType } elseif (-not $env:WHISPER_COMPUTE_TYPE) { $env:WHISPER_COMPUTE_TYPE = "int8" }

# HF_ENDPOINT 国内镜像（如未手动设置）
if (-not $env:HF_ENDPOINT) {
    $env:HF_ENDPOINT = "https://hf-mirror.com"
    Write-Host "       HF镜像: $env:HF_ENDPOINT (自动设置)" -ForegroundColor Gray
}

# 读取 runtime.json（如果端口被 server 自动改写过）
$runtimePath = Join-Path $scriptDir "runtime.json"
if (Test-Path $runtimePath) {
    try {
        $runtime = Get-Content $runtimePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($runtime.port -and $runtime.port -ne $Port) {
            Write-Host "       runtime 端口: $($runtime.port) (端口动态调整)" -ForegroundColor Yellow
            $env:WHISPER_PORT = $runtime.port.ToString()
        } else {
            $env:WHISPER_PORT = $Port.ToString()
        }
    } catch {
        $env:WHISPER_PORT = $Port.ToString()
    }
} else {
    $env:WHISPER_PORT = $Port.ToString()
}

Write-Host "       模型/Model : $env:WHISPER_MODEL" -ForegroundColor Gray
Write-Host "       设备/Device: $env:WHISPER_DEVICE" -ForegroundColor Gray
Write-Host "       精度/Prec  : $env:WHISPER_COMPUTE_TYPE" -ForegroundColor Gray
Write-Host "       端口/Port  : $env:WHISPER_PORT" -ForegroundColor Gray
Write-Host ""

# ====== 启动 / Start ======
Write-Host "[4/4] 启动服务 / Starting server..." -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Magenta
Write-Host "  首次运行将自动下载模型，请耐心等待" -ForegroundColor Yellow
Write-Host "  First run will auto-download the model" -ForegroundColor Yellow
Write-Host "  按 Ctrl+C 停止服务 / Ctrl+C to stop" -ForegroundColor Gray
Write-Host "============================================" -ForegroundColor Magenta
Write-Host ""

& $pyCmd server.py
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] 服务异常退出 / Server exited with code $LASTEXITCODE" -ForegroundColor Red
}

Write-Host ""
Read-Host "按 Enter 退出 / Press Enter to exit"
