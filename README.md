# bQuantumReader (b量子阅读)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-blue)

从 B站视频提取 CC 字幕和评论，支持本地 Whisper 语音识别，生成结构化 Markdown 知识库。

> A Chrome extension to extract Bilibili subtitles and comments with local Whisper ASR support. Generates structured Markdown.

---

## 功能特性

- **字幕提取** — 自动获取 B站 CC 字幕，带时间戳生成 Markdown
- **评论提取** — 同步获取热门评论，集成到输出文档
- **语音识别** — 支持本地 Whisper 服务（faster-whisper），无需上传，保护隐私
- **一键启动** — 原生消息主机 + 安装向导，零配置启动 Whisper
- **后台转录** — 关闭弹窗后仍继续处理，随时回来查看结果
- **独立窗口** — 可脱离 Chrome 工具栏独立操作

## 快速开始

### 前置条件

- Chrome 浏览器（推荐最新版）
- Python 3.8+（仅语音识别需要）

### 安装步骤

1. 下载本项目，解压或 `git clone`
2. 打开 Chrome，进入 `chrome://extensions/`
3. 打开右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择项目文件夹
5. 打开任意 B站 视频，点击扩展图标开始使用

> 详细安装指南见 [INSTALL.md](INSTALL.md)，语音识别服务安装见其中第三节。

## 项目结构

```
bQuantumReader/
├── manifest.json              # Chrome 扩展配置 (MV3)
├── background/                # Service Worker (消息路由、API 调用)
├── content/                   # 页面注入脚本 (B站视频信息提取)
├── popup/                     # 主界面 + 安装向导
│   ├── popup.html/js/css
│   └── install_wizard.html/js
├── options/                   # 设置页面
├── offscreen/                 # 后台转录文档
├── shared/                    # 公共模块
│   ├── bilibili-api.js        # B站 API 封装 (WBI 签名)
│   ├── asr.js                 # Whisper ASR 通信协议
│   └── markdown.js            # Markdown 生成器
├── help/                      # 帮助页面
├── icons/                     # 扩展图标
└── whisper_server/            # 语音识别服务 (Python/Flask)
    ├── server.py              # Flask HTTP 服务
    ├── native_host.py         # Native Messaging 主机进程
    ├── install.ps1 / .bat     # 一键安装脚本
    └── start_server.ps1 / .bat# 启动脚本
```

## 语音识别

支持本地 Whisper 服务，数据无需上传，完全本地处理。

| 模型 | 大小 | 速度 | 适用场景 |
|------|------|------|---------|
| tiny | ~80MB | 最快 | 测试/低配电脑 |
| base | ~150MB | 快 | 日常使用 |
| small | ~500MB | 中等 | 默认推荐 |
| medium | ~1.5GB | 慢 | 高质量需求 |
| large-v3 | ~3GB | 最慢 | 最高精度 |

## 技术栈

- **Chrome Extension** — Manifest V3, 纯 JavaScript
- **Whisper 服务** — Python Flask, faster-whisper (CTranslate2)
- **通信** — Native Messaging API, HTTP REST

## 开发计划

- [ ] Android 客户端 (Kotlin + Jetpack Compose)
- [ ] Chrome Web Store 上架
- [ ] 多语言界面支持

## 自愿捐助

如果这个项目对你有帮助，欢迎请作者喝杯咖啡 ☕

| 微信 | 支付宝 |
|------|--------|
| ![微信收款码](assets/donate/wechat.jpg) | ![支付宝收款码](assets/donate/alipay.jpg) |

## 许可证

[MIT License](LICENSE)
