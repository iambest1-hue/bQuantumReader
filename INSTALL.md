# b量子速读 - 安装指南

从B站视频提取字幕/评论，支持语音识别，生成 Markdown 知识库。

---

## 一、安装 Chrome 扩展

1. 解压 `b量子速读.zip` 到你想要的位置（如 `D:\extensions\b量子速读\`）

2. 打开 Chrome 浏览器，地址栏输入 `chrome://extensions/` 回车

3. 打开右上角 **「开发者模式」** 开关

4. 点击左上角 **「加载已解压的扩展程序」**

5. 选择解压后的 `b量子速读` 文件夹，确定

6. 扩展图标会出现在 Chrome 工具栏右上角（拼图图标里可以固定）


> **注意**：解压后的文件夹**不要删除或移动**，否则扩展会失效。

---

## 二、使用字幕提取（无需额外配置）

1. 打开任意 B站 视频页面：`https://www.bilibili.com/video/BV...`

2. 点击 Chrome 工具栏的扩展图标

3. 点击 **「提取字幕」**，等待完成

4. 点击 **「下载 Markdown」** 保存文件

---

## 三、安装语音识别服务（一键安装）

如果视频没有 CC 字幕，可以通过本地 Whisper 服务进行语音转文字。

### 快速安装

1. 打开扩展窗口，点击 **「🔧 安装向导」**（Whisper 未连接时会显示）

2. 安装向导会自动填入你的扩展 ID

3. 点击 **「📋 复制安装命令」** 按钮

4. 打开文件管理器，进入 `whisper_server` 目录

5. 在目录地址栏输入 `cmd` 回车打开命令提示符

6. 粘贴并回车运行安装命令

7. 等待安装完成（自动创建虚拟环境、安装依赖、下载模型、注册本地服务）

8. 安装完成后点击向导中的 **「🔄 检查安装状态」**，确认 5 项全部 ✅

9. **重启 Chrome 浏览器**

### 启动服务

- 打开扩展窗口，点击 **「🚀 一键启动」** 按钮

- 首次启动会自动下载语音识别模型（约 500MB），请耐心等待，扩展会显示下载进度

- 看到绿色圆点 **`● Whisper: 已连接`** 表示就绪

> **提示**：你也可以直接双击 `whisper_server/start_server.bat` 启动服务（无需安装向导）。

### 验证连接

扩展中看到绿色圆点 `● Whisper: 已连接` 即配置成功。

---

## 四、配置说明（可选）

### 模型选择

通过环境变量可调整模型大小（越大越准越慢）：

| 模型 | 大小 | 速度 | 适用场景 |
|------|------|------|---------|
| `tiny` | ~80MB | 最快 | 测试/低配电脑 |
| `base` | ~150MB | 快 | 日常使用 |
| `small` | ~500MB | 中等 | 默认推荐 |
| `medium` | ~1.5GB | 慢 | 高质量需求 |
| `large-v3` | ~3GB | 最慢 | 最高精度 |

设置方式（启动服务前执行）：
```powershell
$env:WHISPER_MODEL="base"
```
或编辑 `start_server.ps1` 修改默认值。

### GPU 加速

有 NVIDIA 显卡可启用 CUDA 加速：
```powershell
$env:WHISPER_DEVICE="cuda"
$env:WHISPER_COMPUTE_TYPE="float16"
```
需额外安装 CUDA 工具包和 cuDNN。

---

## 五、常见问题

**Q: 扩展图标灰色/点不了？**
A: 只在 B站 视频页面 (`bilibili.com/video/...`) 有效，其他页面不工作。

**Q: 提取字幕失败？**
A: 刷新 B站 页面后重试。部分视频可能没有 CC 字幕，需用语音识别。

**Q: 语音识别很慢？**
A: CPU 模式下 small 模型处理 10 分钟音频约需 3-5 分钟。可换用 `base` 模型提速。

**Q: 端口 8787 被占用？**
A: 新版服务会自动寻找空闲端口（8788、8789...），扩展也会自动同步地址。无需手动配置。

**Q: 服务启动失败怎么办？**
A: 查看日志文件 `whisper_server/logs/server.log`。运行 `install.bat -Repair` 可修复安装。

**Q: 处理中需要一直保持扩展窗口打开吗？**
A: 不需要。新版支持后台运行，关闭窗口后转录仍会继续，重新打开扩展可查看结果。

**Q: 一键启动按钮点了没反应？**
A: 请先运行安装向导完成安装，并重启 Chrome。如仍然失败，可双击 `start_server.bat` 手动启动。

---

## 六、故障排查

### 看日志

- 服务日志：`whisper_server/logs/server.log`
- 启动日志：`whisper_server/logs/server_stdout.log`
- 原生进程日志：`whisper_server/logs/native_host.log`

### 重装修复

```powershell
cd whisper_server
install.bat -ExtensionId <你的扩展ID> -Repair
```

### 手动注册 Native Host

如果安装脚本未自动注册，手动复制：
1. 打开 `whisper_server` 目录
2. 复制 `com.bquantum.whisper.json.template` 为 `com.bquantum.whisper.json`
3. 修改文件中的 `{{PATH}}` 为 `native_host.py` 的绝对路径
4. 修改 `{{EXTENSION_ID}}` 为你的扩展 ID
5. 将 `com.bquantum.whisper.json` 复制到：
   `%USERPROFILE%\AppData\Local\Google\Chrome\User Data\NativeMessagingHosts\`

### 手动安装（无安装向导）

```bash
cd whisper_server
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
set HF_ENDPOINT=https://hf-mirror.com
.venv\Scripts\python -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8')"
```

---

## 文件结构

```
b量子速读/
├── manifest.json          # 扩展配置
├── background/            # 后台服务
├── content/               # 页面注入
├── popup/                 # 主界面 + 安装向导
├── options/               # 设置页
├── offscreen/             # 后台转录
├── shared/                # 公共模块
├── help/                  # 帮助页
├── icons/                 # 图标
└── whisper_server/        # 语音识别服务
    ├── server.py          # 服务主程序
    ├── native_host.py     # 原生消息主机（一键启动）
    ├── install.ps1        # 一键安装脚本
    ├── install.bat        # 安装脚本入口
    ├── start_server.bat   # 手动启动入口
    ├── start_server.ps1   # 启动脚本
    ├── requirements.txt   # Python 依赖
    ├── utils.py           # 共享工具
    ├── .venv/             # 虚拟环境（安装后生成）
    ├── bin/               # 内置工具（ffmpeg 等）
    └── logs/              # 日志文件
```
