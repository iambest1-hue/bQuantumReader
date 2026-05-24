# Android 可复用参考文件

> 这些文件在 Kotlin 原生项目中不可直接引用，仅作**算法逻辑参考**。

---

## bilibili-api.js → WbiSign.kt + BiliApi.kt

**关键算法（必须严格复刻）：**

### WBI Mixin Key 计算
```
1. GET https://api.bilibili.com/x/web-interface/nav
2. 从响应取 data.wbi_img.img_url + data.wbi_img.sub_url
3. 从 URL 提取文件名（不含扩展名）作为 rawKey
4. 按 MIXIN_KEY_TABLE 索引从 rawKey 抽取字符，取前 32 位
```

### WBI 签名流程
```
1. 参数加 wts（Unix 秒时间戳）
2. 按 key 排序
3. 拼成 query string（encode 后）
4. MD5(query + mixinKey)
5. 请求带 w_rid（签名结果）+ wts
```

### MIXIN_KEY_TABLE（固定值，不要改）
```kotlin
val MIXIN_KEY_TABLE = intArrayOf(
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 37, 12, 52, 56, 7,
    0, 16, 38, 11, 6, 34, 55, 39, 57, 22, 1, 26, 44, 24, 51, 13,
    36, 20, 40, 4, 17, 48, 21, 30, 25, 41, 54, 59
)
```

### MD5（纯 Kotlin，无需依赖）
完整实现参考 `bilibili-api.js` 第 65-178 行的 `md5()` 函数。这是标准 MD5，可逐行翻译到 Kotlin。

### B站 API 端点（完整列表）
```
GET  https://api.bilibili.com/x/web-interface/view?bvid=
GET  https://api.bilibili.com/x/web-interface/nav
GET  https://api.bilibili.com/x/player/wbi/v2?bvid=&cid=&w_rid=&wts=
GET  https://api.bilibili.com/x/player/playurl?bvid=&cid=&qn=0&fnval=16
GET  https://api.bilibili.com/x/v2/reply/main?type=1&oid=&mode=3&ps=20
```

### 字幕转码
B站返回的时间戳是**秒**（float），需要 × 1000 转为毫秒：
```kotlin
data class SubtitleEntry(
    val from: Long,   // 秒 * 1000
    val to: Long,     // 秒 * 1000
    val content: String
)
```

### 请求头
```
Referer: https://www.bilibili.com/
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...
```

---

## markdown.js → MarkdownGen.kt

**Markdown 模板结构：**
```markdown
# {标题}
> 来源: {url}
> UP主: {upName} | 时长: {duration}

[00:00] 字幕内容第一行
[00:03] 字幕内容第二行
...

---
## 视频评论
> 共 {n} 条评论
- **用户名** (2024-01-01 12:00:00)
  评论内容
```

**时间戳格式化：** 毫秒 → `MM:SS` 或 `HH:MM:SS`

**文件名清理：** 移除 `< > : " / \ | ? *` 字符
