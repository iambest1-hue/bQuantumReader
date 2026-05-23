# b量子阅读 - 安装指南

从B站视频提取字幕/评论，支持语音识别，生成 Markdown 知识库。

---

## 一、安装 Chrome 扩展

1. 解压 `b量子阅读.zip` 到你想要的位置（如 `D:\extensions\b量子阅读\`）

2. 打开 Chrome 浏览器，地址栏输入 `chrome://extensions/` 回车

3. 打开右上角 **「开发者模式」** 开关

4. 点击左上角 **「加载已解压的扩展程序」**

5. 选择解压后的 `b量子阅读` 文件夹，确定

6. 扩展图标会出现在 Chrome 工具栏右上角（拼图图标里可以固定）

> **注意**：解压后的文件夹**不要删除或移动**，否则扩展会失效。

---

## 二、使用字幕提取（无需额外配置）

1. 打开任意 B站 视频页面：`https://www.bilibili.com/video/BV...`

2. 点击 Chrome 工具栏的扩展图标

3. 点击 **「提取字幕」**，等待完成

4. 点击 **「下载 Markdown」** 保存文件

---

## 三、安装语音识别服务（可选）

如果视频没有 CC 字幕，可以通过本地 Whisper 服务进行语音转文字。

### 3.1 安装 Python

- 需要 **Python 3.8+**
- 下载：https://www.python.org/downloads/
- 安装时务必勾选 ✅ **「Add Python to PATH」**

验证安装：打开终端（CMD），输入 `python --version`，应显示版本号。

### 3.2 安装依赖

在终端中进入扩展目录的 `whisper_server` 文件夹：

```bash
cd 解压目录\whisper_server
pip install -r requirements.txt
```

> 如果下载慢，使用国内镜像：
> ```bash
> pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
> ```

### 3.3 启动服务

**方法一：双击启动（推荐）**

直接双击 `whisper_server\start_server.bat`，会自动检测 Python、安装依赖、启动服务。

**方法二：命令行启动**

```bash
cd 解压目录\whisper_server
python server.py
```

首次运行会自动下载语音识别模型（约 500MB），请耐心等待。

看到以下输出表示启动成功：
```
Model loaded successfully
 * Running on http://0.0.0.0:8787
```

### 3.4 验证连接

浏览器访问 `http://localhost:8787/status`，返回 JSON 即表示正常。

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

设置方式（Windows PowerShell，启动前执行）：
```powershell
$env:WHISPER_MODEL="base"
```

### GPU 加速

有 NVIDIA 显卡可启用 CUDA 加速：
```powershell
$env:WHISPER_DEVICE="cuda"
$env:WHISPER_COMPUTE_TYPE="float16"
```

需额外安装 CUDA 工具包和 cuDNN。

### 下载加速

模型从 HuggingFace 下载，可用国内镜像：
```powershell
$env:HF_ENDPOINT="https://hf-mirror.com"
```

---

## 五、常见问题

**Q: 扩展图标灰色/点不了？**
A: 只在 B站视频页面 (`bilibili.com/video/...`) 有效，其他页面不工作。

**Q: 提取字幕失败？**
A: 刷新 B站 页面后重试。部分视频可能没有 CC 字幕，需用语音识别。

**Q: 语音识别很慢？**
A: CPU 模式下 small 模型处理 10 分钟音频约需 3-5 分钟。可换用 `base` 模型提速。

**Q: 端口 8787 被占用？**
A: 设置 `$env:WHISPER_PORT="8788"` 换端口，并在扩展设置页同步修改地址。

**Q: 需要一直保持扩展窗口打开吗？**
A: 是的，提取/识别过程中不要关闭扩展窗口，完成后会有通知提醒。

---

## 文件结构

```
b量子阅读/
├── manifest.json          # 扩展配置
├── background/            # 后台服务
├── content/               # 页面注入
├── popup/                 # 主界面
├── options/               # 设置页
├── offscreen/             # 后台转录
├── shared/                # 公共模块
├── help/                  # 帮助页
├── icons/                 # 图标
└── whisper_server/        # 语音识别服务
    ├── server.py
    ├── requirements.txt
    ├── start_server.bat   # 一键启动
    └── start_server.ps1
```
