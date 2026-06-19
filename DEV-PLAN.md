# b量子阅读 安卓端 - 开发计划

## 总体架构

```
app/
├── MainActivity.kt                    # 单 Activity
├── ui/
│   ├── theme/                         # Material3 主题（粉色 #fb7299）
│   ├── screen/
│   │   ├── HomeScreen.kt              # 主页面
│   │   ├── SettingsScreen.kt          # 设置页
│   │   └── HistoryScreen.kt           # 历史记录（P2）
│   ├── component/
│   │   ├── LinkInput.kt               # 链接输入组件
│   │   ├── VideoInfoCard.kt           # 视频信息卡片
│   │   ├── ActionButtons.kt           # 操作按钮组
│   │   ├── WhisperStatusChip.kt       # Whisper 状态指示
│   │   ├── ProgressSection.kt         # 进度区域
│   │   └── ResultBottomSheet.kt       # 结果预览弹窗
├── data/
│   ├── api/
│   │   ├── BiliApi.kt                 # B站 API（Retrofit）
│   │   ├── WbiSign.kt                 # WBI 签名算法
│   │   └── Md5.kt                     # 纯 Kotlin MD5
│   ├── model/
│   │   ├── VideoInfo.kt               # 视频信息
│   │   ├── Subtitle.kt                # 字幕条目
│   │   ├── WhisperSegment.kt          # 语音识别片段
│   │   └── Comment.kt                 # 评论
│   ├── repository/
│   │   └── VideoRepository.kt         # 数据仓库
│   ├── local/
│   │   ├── AppDatabase.kt             # Room 数据库（P2）
│   │   └── HistoryDao.kt              # 历史记录 DAO（P2）
├── domain/
│   ├── MarkdownGen.kt                 # Markdown 生成器
│   ├── LinkParser.kt                  # URL 解析（提取 bvid）
│   └── WhisperClient.kt               # Whisper 服务 HTTP 客户端
├── util/
│   ├── ClipboardUtil.kt               # 剪贴板工具
│   ├── FileUtil.kt                    # 文件保存
│   └── NetworkUtil.kt                 # 网络状态检测
└── di/                                # 依赖注入（Hilt/Koin）
```

## 开发阶段

### 阶段一：基础框架 + 字幕提取（3天）

| 任务 | 产出 |
|------|------|
| Android Studio 创建 Compose 项目 | Gradle 配置、主题、MainActivity |
| LinkParser | URL 正则匹配提取 bvid |
| BiliApi + WbiSign + Md5 | 参考 `shared/bilibili-api.js` 重写 |
| VideoInfoCard | 封面 + 标题 + UP主 + 时长 |
| 字幕提取流程 | API 调用链 → Markdown 生成 |
| ResultBottomSheet | Markdown 预览 + 复制 + 分享 |

### 阶段二：语音识别 + 设置（2天）

| 任务 | 产出 |
|------|------|
| WhisperClient | HTTP POST /transcribe，参考 `shared/asr.js` |
| WhisperStatusChip | 连接检测 GET /status |
| SettingsScreen | DataStore 存储服务地址 |
| 语音识别流程 | 获取音频 URL → 发送给 Whisper → 显示结果 |
| ProgressSection | 进度条 + 实时计时 + 取消按钮 |

### 阶段三：评论 + 增强（1天）

| 任务 | 产出 |
|------|------|
| 评论提取 | B站评论 API + Markdown 集成 |
| 文件保存 | SAF 保存 .md 到下载目录 |
| 错误处理 | 网络异常、超时、B站 API 限流 |
| 网络配置 | `network_security_config.xml` 放行局域网 HTTP |

### 阶段四：P2 功能（2天，可选）

| 任务 | 产出 |
|------|------|
| Room 数据库 + HistoryDao | 历史记录持久化 |
| HistoryScreen | 已提取视频列表 |
| 深色模式 | Material3 dynamic color |

## 关键依赖

```kotlin
// build.gradle.kts
implementation("com.squareup.retrofit2:retrofit:2.9.0")
implementation("com.squareup.retrofit2:converter-gson:2.9.0")
implementation("com.squareup.okhttp3:okhttp:4.12.0")
implementation("androidx.compose.material3:material3")
implementation("androidx.datastore:datastore-preferences")
implementation("io.coil-kt:coil-compose:2.5.0")        // 封面加载
implementation("com.google.accompanist:accompanist-webview:0.34.0") // Markdown 渲染
```

## 可复用参考文件映射

| Chrome 扩展文件 | Android 对应 | 复用方式 |
|---------------|-------------|---------|
| `shared/bilibili-api.js` | `WbiSign.kt` + `BiliApi.kt` | WBI 签名算法、MD5、API 端点、参数名 |
| `shared/markdown.js` | `MarkdownGen.kt` | Markdown 模板结构、时间戳格式化逻辑 |
| `shared/asr.js` | `WhisperClient.kt` | /status、/transcribe API 协议 |
| `whisper_server/server.py` | 不变（电脑端） | 完整复用，零修改 |
| `popup/popup.js` | `HomeScreen.kt` 逻辑 | 交互流程参考 |
| `popup/popup.html` | Compose UI | 布局结构参考 |

## 验证方法

1. 真机 USB 连接 → Android Studio Run
2. 粘贴 B站 链接 → 点击提取字幕 → 3 秒内显示结果
3. 电脑启动 Whisper → 手机点语音识别 → 等待完成
4. 复制/分享/保存 Markdown 测试
5. `adb logcat -s BLiang` 查看日志
