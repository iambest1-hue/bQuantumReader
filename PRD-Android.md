# b量子阅读 安卓端 - 产品需求文档（PRD）

## 一、产品概述

| 项 | 说明 |
|------|------|
| 产品名 | b量子阅读（Android） |
| 版本 | v0.1.0 |
| 定位 | B站视频内容提取工具，支持字幕提取和语音识别 |
| 平台 | Android 8.0+（API 26+） |
| 技术栈 | Kotlin + Jetpack Compose + Retrofit + OkHttp |

## 二、用户场景

1. 用户复制 B站 视频链接到 APP
2. 自动识别视频并加载信息（标题、UP主、时长）
3. 优先尝试提取 CC 字幕
4. 若无字幕，通过局域网连接电脑 Whisper 服务进行语音识别
5. 生成结构化 Markdown，可预览、分享、保存

## 三、功能清单

### P0 — 必须有

| 功能 | 描述 |
|------|------|
| 链接输入 | 粘贴/输入 B站视频链接，自动解析 bvid |
| 视频信息展示 | 封面、标题、UP主、时长 |
| 字幕提取 | 调用 B站 API 获取 CC 字幕，WBI 签名 |
| 结果预览 | Markdown 预览，展示时间戳 + 内容 |
| 结果操作 | 复制到剪贴板、分享到其他 APP、保存为 .md 文件 |

### P1 — 应该有

| 功能 | 描述 |
|------|------|
| 语音识别 | 连接电脑 Whisper 服务，音频 URL 发送给服务端转写 |
| 服务状态 | 局域网 Whisper 服务连接状态指示 |
| 设置页面 | 配置 Whisper 服务地址（默认 http://192.168.x.x:8787） |
| 评论提取 | 同步获取视频热门评论 |
| 操作进度 | 进度条 + 实时计时 |

### P2 — 可以有

| 功能 | 描述 |
|------|------|
| 历史记录 | 已提取过的视频列表 |
| 本地存储 | SQLite/Room 缓存已提取内容 |
| 本地 Whisper | 集成 whisper.cpp 离线语音识别 |
| 深色模式 | 跟随系统 |

## 四、页面结构

```
MainActivity
├── TopBar（b量子阅读 + 设置入口）
├── LinkInput（输入框 + 粘贴按钮 + 解析按钮）
├── VideoInfoCard（封面、标题、UP主、时长）
├── ActionButtons（提取字幕 / 语音识别）
├── WhisperStatusChip（服务状态指示）
├── ProgressBar（进度 + 计时）
└── ResultBottomSheet
    ├── 统计行（条数、字数、用时）
    ├── Markdown 预览（WebView 渲染）
    ├── 复制按钮
    ├── 分享按钮
    └── 保存按钮
```

## 五、数据流

```
用户输入 URL
    ↓
LinkParser → 提取 bvid
    ↓
BiliApi.getVideoInfo(bvid) → 视频元信息
    ↓
┌─ 提取字幕 ─────────────────────┐  ┌─ 语音识别 ────────────────────┐
│ BiliApi.getSubtitleList()      │  │ BiliApi.getAudioUrl()          │
│ BiliApi.getSubtitleContent()   │  │                                │
│ BiliApi.getComments()          │  │ WhisperClient.transcribe(      │
│                                │  │   audioUrl, serverUrl)         │
│ MarkdownGen.generate()         │  │                                │
└────────────────────────────────┘  └────────────────────────────────┘
    ↓                              ↓
ResultBottomSheet → 预览/复制/分享/保存
```

## 六、API 对接说明

### B站 API（Kotlin 重写）

参考 `shared/bilibili-api.js` 的逻辑：

- `/x/web-interface/view?bvid=` → 视频信息
- `/x/web-interface/nav` → WBI 密钥（img_url + sub_url）
- `/x/player/wbi/v2?bvid=&cid=&w_rid=&wts=` → 字幕列表（需 WBI 签名）
- 字幕 JSON URL → 字幕内容
- `/x/v2/reply/main` → 评论
- `/x/player/playurl?bvid=&cid=&qn=0&fnval=16` → 音频流地址

关键算法：
- **WBI Mixin Key**：从 nav API 获取 img_url/sub_url，按 MIXIN_KEY_TABLE 索引抽取前 32 位
- **WBI 签名**：参数 + wts 时间戳 → 排序拼接 → MD5(str + mixinKey)
- **MD5**：纯 Kotlin 实现（不用额外依赖）

### Whisper 服务（无需修改）

服务端 `whisper_server/server.py` 完整复用，APP 通过 HTTP 调用：

```
POST http://192.168.x.x:8787/transcribe
Body: {"audio_url": "https://...", "language": "zh"}
Response: {"segments": [{"from": 0, "to": 3500, "content": "文本"}]}
```

## 七、技术约束

- **Android 8.0+**：OkHttp 默认支持 TLS 1.2+
- **网络权限**：`INTERNET`、`ACCESS_NETWORK_STATE`
- **文件存储**：`MediaStore` 或 `SAF` 保存 Markdown
- **剪贴板**：Android 10+ 需要前台 APP 才能读取
- **局域网通信**：HTTP 明文需配置 `network_security_config.xml` 放行 localhost

## 八、非功能需求

- 首次提取应在 3 秒内返回（字幕模式）
- 语音识别时间取决于音频长度和 Whisper 模型
- APK 体积 < 10MB（不含本地 Whisper 模型）
- 支持 Android 8.0 ~ 15
