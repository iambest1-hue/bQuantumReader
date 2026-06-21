# b量子速读 - Whisper 一键安装脚本
# Install Whisper ASR Service: venv + deps + model + ffmpeg + native host

param(
    [string]$ExtensionId = "",
    [switch]$Repair
)

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Set-Location $scriptDir
$ErrorActionPreference = "Continue"

# ── 辅助函数 ──
function Write-Step($num, $label) { Write-Host "`n[$num/6] $label" -ForegroundColor Cyan }
function Write-OK($msg) { Write-Host "   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "   $msg" -ForegroundColor Red }
function Write-Info($msg) { Write-Host "     $msg" -ForegroundColor DarkGray }

$installState = @{
    installed_at = (Get-Date -Format "o")
    venv_python  = $null
    model_path   = $null
    ffmpeg_path  = $null
    extension_id = $ExtensionId
    native_host_registered = $false
    errors       = @()
}

function Save-State {
    $installState | ConvertTo-Json -Depth 4 | Out-File -FilePath (Join-Path $scriptDir "install_state.json") -Encoding UTF8
}

# ═══════════════ Banner ═══════════════
Write-Host ""
Write-Host "============================================" -ForegroundColor Magenta
Write-Host "  b量子速读 - Whisper 一键安装" -ForegroundColor White
Write-Host "  One-Click Install" -ForegroundColor DarkGray
if ($Repair) { Write-Host "  [修复模式]" -ForegroundColor Yellow }
Write-Host "============================================" -ForegroundColor Magenta
Write-Host ""

# ═══════════════ Step 1: Python ═══════════════
Write-Step 1 "检测 Python 3.8+"
$pyCmd = $null

# 先看当前目录是否有 .venv（修复模式）
$venvPython = Join-Path $scriptDir ".venv\Scripts\python.exe"
if ($Repair -and (Test-Path $venvPython)) {
    Write-OK ".venv 已存在，跳过 Python 检测"
    $pyCmd = $venvPython
} else {
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
    foreach ($c in $candidates) {
        $ver = & $c --version 2>&1
        if ($LASTEXITCODE -ne 0) { continue }
        $pipVer = & $c -m pip --version 2>&1
        if ($LASTEXITCODE -eq 0) { $pyCmd = $c; break }
    }
}

if (-not $pyCmd) {
    Write-Fail "未找到 Python 3.8+"
    Write-Warn "请从 https://python.org 下载安装，务必勾选 Add Python to PATH"
    $installState.errors += "python_not_found"
    Save-State
    Write-Host "`n安装中断。安装 Python 后重新运行此脚本。" -ForegroundColor Yellow
    exit 1
}
Write-OK "$pyCmd"
& $pyCmd --version
Save-State

# ═══════════════ Step 2: venv ═══════════════
Write-Step 2 "创建虚拟环境 (.venv)"
if (Test-Path $venvPython) {
    if ($Repair) {
        Write-Info "正在重建 .venv..."
        Remove-Item -Recurse -Force (Join-Path $scriptDir ".venv") -ErrorAction SilentlyContinue
        & $pyCmd -m venv (Join-Path $scriptDir ".venv")
        if ($LASTEXITCODE -ne 0) { Write-Fail "重建 .venv 失败"; exit 1 }
    } else {
        Write-OK ".venv 已存在，跳过"
    }
} else {
    & $pyCmd -m venv (Join-Path $scriptDir ".venv")
    if ($LASTEXITCODE -ne 0) { Write-Fail "创建 .venv 失败"; exit 1 }
    Write-OK "已创建 .venv"
}

# 切到 venv 的 python
$pyCmd = $venvPython
$installState.venv_python = $pyCmd
Save-State

# ═══════════════ Step 3: 安装依赖 ═══════════════
Write-Step 3 "安装 Python 依赖包"

Write-Info "升级 pip..."
& $pyCmd -m pip install --upgrade pip -q -i https://pypi.tuna.tsinghua.edu.cn/simple
Write-Info "安装依赖 (使用清华镜像)..."
& $pyCmd -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
if ($LASTEXITCODE -ne 0) {
    Write-Warn "清华镜像失败，尝试默认源..."
    & $pyCmd -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "依赖安装失败"
        $installState.errors += "pip_install_failed"
        Save-State
        exit 1
    }
}

# 验证
$check = & $pyCmd -c "import flask,faster_whisper,requests; print('OK')" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-OK "所有依赖安装成功"
} else {
    Write-Fail "依赖验证失败: $check"
    $installState.errors += "import_check_failed"
    Save-State
    exit 1
}
Save-State

# ═══════════════ Step 4: 预下载模型 ═══════════════
Write-Step 4 "预下载语音识别模型 (small ~500MB)"
Write-Info "模型缓存目录: $env:USERPROFILE\.cache\ctranslate2\"
Write-Info "使用国内镜像: https://hf-mirror.com"
Write-Host ""

$env:HF_ENDPOINT = "https://hf-mirror.com"
$modelCheck = & $pyCmd -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8')" 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-OK "模型下载完成"
    $installState.model_path = "$env:USERPROFILE\.cache\ctranslate2\small"
} else {
    Write-Warn "模型预下载失败（可在首次启动时自动下载）"
    Write-Info "失败信息: $modelCheck"
    $installState.errors += "model_download_failed"
}
Save-State

# ═══════════════ Step 5: ffmpeg + Native Host ═══════════════
Write-Step 5 "检测 ffmpeg 与注册 Native Host"

# ── ffmpeg ──
$ffmpegPath = (Get-Command "ffmpeg" -ErrorAction SilentlyContinue).Source
if (-not $ffmpegPath) {
    $localFfmpeg = Join-Path $scriptDir "bin\ffmpeg.exe"
    if (Test-Path $localFfmpeg) {
        $ffmpegPath = $localFfmpeg
        Write-OK "ffmpeg: $ffmpegPath (项目内置)"
    } else {
        Write-Warn "未找到 ffmpeg"
        Write-Info "尝试下载 ffmpeg..."
        # 创建 bin 目录
        $binDir = Join-Path $scriptDir "bin"
        New-Item -ItemType Directory -Force -Path $binDir | Out-Null

        try {
            $ffmpegUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
            $zipPath = Join-Path $env:TEMP "ffmpeg.zip"
            Invoke-WebRequest -Uri $ffmpegUrl -OutFile $zipPath -TimeoutSec 60 -ErrorAction Stop
            Expand-Archive -Path $zipPath -DestinationPath (Join-Path $env:TEMP "ffmpeg_extract") -Force -ErrorAction Stop
            # 找 ffmpeg.exe
            $extracted = Get-ChildItem -Recurse -Filter "ffmpeg.exe" -Path (Join-Path $env:TEMP "ffmpeg_extract") | Select-Object -First 1
            if ($extracted) {
                Copy-Item $extracted.FullName (Join-Path $binDir "ffmpeg.exe") -Force
                Remove-Item -Recurse -Force (Join-Path $env:TEMP "ffmpeg_extract") -ErrorAction SilentlyContinue
                Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
                $ffmpegPath = Join-Path $binDir "ffmpeg.exe"
                Write-OK "ffmpeg 已下载到: $ffmpegPath"
            } else {
                throw "未找到 ffmpeg.exe"
            }
        } catch {
            Write-Warn "ffmpeg 下载失败: $_"
            Write-Info "可手动下载 https://ffmpeg.org/ 放入 bin\ffmpeg.exe"
            $installState.errors += "ffmpeg_download_failed"
        }
    }
} else {
    Write-OK "ffmpeg: $ffmpegPath (系统)"
}
$installState.ffmpeg_path = $ffmpegPath
Save-State

# ── Native Host 注册 ──
Write-Info "注册 Native Messaging Host..."
$templatePath = Join-Path $scriptDir "com.bquantum.whisper.json.template"
$nativeJsonPath = Join-Path $scriptDir "com.bquantum.whisper.json"

if (-not (Test-Path $templatePath)) {
    Write-Fail "找不到模板文件: $templatePath"
    $installState.errors += "template_not_found"
} elseif (-not $ExtensionId) {
    Write-Warn "未提供扩展 ID，跳过 Native Host 注册"
    Write-Info "请从 Chrome 扩展管理页复制扩展 ID，重新运行:"
    Write-Info "  install.bat -ExtensionId <你的扩展ID>"
    $installState.errors += "extension_id_missing"
} else {
    try {
        $template = Get-Content $templatePath -Raw -Encoding UTF8
        # 用真实路径替换占位符（Windows 路径需要双反斜杠或正斜杠）
        $nativeHostPy = (Join-Path $scriptDir "native_host.py") -replace '\\', '\\'
        $json = $template -replace '\{\{PATH\}\}', $nativeHostPy
        $json = $json -replace '\{\{EXTENSION_ID\}\}', $ExtensionId

        # 写入项目目录（供参考/排查）
        Set-Content -Path $nativeJsonPath -Value $json -Encoding UTF8

        # 写入 Chrome NativeMessagingHosts 目录
        $chromeDir = "$env:USERPROFILE\AppData\Local\Google\Chrome\User Data\NativeMessagingHosts"
        if (-not (Test-Path $chromeDir)) {
            New-Item -ItemType Directory -Force -Path $chromeDir | Out-Null
        }
        $chromeJson = Join-Path $chromeDir "com.bquantum.whisper.json"
        Set-Content -Path $chromeJson -Value $json -Encoding UTF8

        $installState.native_host_registered = $true
        Write-OK "Native Host 已注册到: $chromeJson"
    } catch {
        Write-Warn "Native Host 注册失败: $_"
        $installState.errors += "native_host_registration_failed"
    }
}
Save-State

# ═══════════════ Step 6: 自检 ═══════════════
Write-Step 6 "运行自检"

$allOk = $true

# 检查 venv
if (Test-Path $venvPython) {
    Write-OK "Python 虚拟环境正常"
} else {
    Write-Fail ".venv 未找到"
    $allOk = $false
}

# 检查依赖
$importCheck = & $pyCmd -c "import flask,faster_whisper,requests; print('OK')" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-OK "Python 依赖正常"
} else {
    Write-Fail "Python 依赖缺失: $importCheck"
    $allOk = $false
}

# 检查模型
$modelCache = "$env:USERPROFILE\.cache\ctranslate2\small"
if (Test-Path (Join-Path $modelCache "model.bin")) -or (Test-Path (Join-Path $modelCache "model")) {
    Write-OK "语音模型已缓存"
} else {
    Write-Warn "语音模型未缓存（首次启动会自动下载）"
}

# 检查 ffmpeg
if ($ffmpegPath -and (Test-Path $ffmpegPath)) {
    Write-OK "ffmpeg 正常"
} else {
    Write-Warn "ffmpeg 未安装（转录需要）"
}

# 检查 Native Host
if ($installState.native_host_registered) {
    Write-OK "Native Host 已注册"
} else {
    Write-Warn "Native Host 未注册（一键启动不可用，但双击 start_server.bat 仍可使用）"
}

Write-Host ""
if ($allOk -and $installState.errors.Count -eq 0) {
    Write-Host "✅ 安装完成！所有步骤通过。" -ForegroundColor Green
    Write-Host "   请重启 Chrome 浏览器，然后点击扩展的「🚀 一键启动」按钮。" -ForegroundColor White
} else {
    Write-Host "⚠ 安装完成，但有 $($installState.errors.Count) 个告警/错误：" -ForegroundColor Yellow
    $installState.errors | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    Write-Host "   多数问题不影响扩展使用，但某些功能可能受限。" -ForegroundColor Yellow
    Write-Host "   修复后重新运行: install.bat -Repair" -ForegroundColor Yellow
}

Save-State
Write-Host ""
Read-Host "按 Enter 退出 / Press Enter to exit"
