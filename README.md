# b量子速读 (bQuantumReader)

一款 Android 端的 B站 视频内容提取工具。粘贴视频链接，一键提取字幕并生成结构化 Markdown，支持预览、复制、分享和保存。

## 功能

- **链接解析** — 粘贴/输入 B站 视频链接，自动提取 bvid
- **视频信息** — 展示封面、标题、UP主、时长
- **字幕提取** — 调用 B站 CC 字幕 API（WBI 签名），提取带时间轴的字幕内容
- **Markdown 生成** — 将字幕自动整理为结构化 Markdown，含视频元信息和时间戳
- **结果操作** — 预览 Markdown、复制到剪贴板、分享到其他 APP、保存为 .md 文件
- **评论提取** — 同步获取视频热门评论
- **B站 登录** — 扫码登录以访问需要登录的内容

## 截图

（待补充）

## 技术栈

| 层 | 技术 |
|------|------|
| 语言 | Kotlin |
| UI | Jetpack Compose + Material 3 |
| 架构 | 单 Activity + ViewModel + Repository |
| 网络 | Retrofit + OkHttp |
| 图片 | Coil |
| 依赖注入 | Koin |
| 数据持久化 | DataStore Preferences |
| 最低 API | Android 10 (API 29) |
| 目标 API | Android 14 (API 34) |

## 快速开始

### 前置要求

- Android Studio Hedgehog (2023.1.1) 或更新
- JDK 17
- Android SDK 34

### 构建

```bash
git clone https://github.com/iambest1-hue/bQuantumReader.git
cd bQuantumReader
./gradlew assembleDebug
```

### 发布构建

发布签名的 APK 需要配置签名密钥。编辑 `app/build.gradle.kts` 中的 `signingConfigs` 块：

```kotlin
signingConfigs {
    create("release") {
        storeFile = file("your-keystore.jks")
        storePassword = "your-store-password"
        keyAlias = "your-key-alias"
        keyPassword = "your-key-password"
    }
}
```

然后将 `signingConfig` 重新添加到 `buildTypes.release` 中。

## 项目结构

```
app/
├── MainActivity.kt              # 单 Activity 入口
├── App.kt                       # Application + Koin 初始化
├── ui/
│   ├── screen/
│   │   ├── HomeScreen.kt        # 主页面
│   │   ├── SettingsScreen.kt    # 设置页
│   │   └── LoginViewModel.kt    # 登录逻辑
│   ├── component/               # UI 组件
│   └── theme/                   # Material3 主题
├── data/
│   ├── api/                     # B站 API（Retrofit + WBI 签名）
│   ├── model/                   # 数据模型
│   ├── repository/              # 数据仓库
│   └── local/                   # Cookie 存储、凭证管理
├── domain/
│   ├── LinkParser.kt            # URL 解析
│   └── MarkdownGen.kt           # Markdown 生成
└── util/                        # 工具类
```

## API 说明

本项目实现了 B站 API 的纯净 Kotlin 重写：

- WBI 签名算法（Mixin Key 提取 + 参数签名）
- 纯 Kotlin MD5 实现
- 视频信息、字幕列表、字幕内容、评论等接口

详见 `readme/` 目录下的详细文档。

## 许可证

（待定）
