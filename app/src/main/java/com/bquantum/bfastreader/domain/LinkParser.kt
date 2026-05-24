package com.bquantum.bfastreader.domain

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

class LinkParser(private val okHttpClient: OkHttpClient) {
    private val BVID_REGEX = Regex("BV1[a-zA-Z0-9]{9}")
    private val AID_REGEX = Regex("av\\d+", RegexOption.IGNORE_CASE)
    private val B23_REGEX = Regex("b23\\.tv/\\w+")

    fun extractBvid(input: String): String? {
        // 先尝试直接匹配 BV 号或 av 号
        BVID_REGEX.find(input)?.value?.let { return it }
        AID_REGEX.find(input)?.value?.let { return it.lowercase() }
        // 检查 b23.tv 短链
        B23_REGEX.find(input)?.value?.let { return "b23:$it" }
        return null
    }

    fun hasShortLink(input: String): Boolean = B23_REGEX.containsMatchIn(input)

    /** 解析 b23.tv 短链，获取真实 BV 号 */
    suspend fun resolveShortUrl(shortUrl: String): String? {
        return withContext(Dispatchers.IO) {
            try {
                val url = if (shortUrl.startsWith("http")) shortUrl
                else "https://$shortUrl"
                val request = Request.Builder()
                    .url(url)
                    .header("User-Agent", UA)
                    .build()
                val response = okHttpClient.newCall(request).execute()
                // 从重定向 URL 或响应体中提取 BV 号
                val finalUrl = response.request.url.toString()
                response.close()
                BVID_REGEX.find(finalUrl)?.value
                    ?: AID_REGEX.find(finalUrl)?.value?.lowercase()
            } catch (_: Exception) {
                null
            }
        }
    }

    companion object {
        private const val UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
}
