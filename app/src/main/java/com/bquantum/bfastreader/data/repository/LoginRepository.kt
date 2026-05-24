package com.bquantum.bfastreader.data.repository

import com.bquantum.bfastreader.data.api.QrCodeResponse
import com.bquantum.bfastreader.data.api.QrPollResponse
import com.bquantum.bfastreader.data.local.BiliCredential
import com.bquantum.bfastreader.data.local.CookieProvider
import com.google.gson.Gson
import okhttp3.OkHttpClient
import okhttp3.Request

class LoginRepository(
    private val okHttpClient: OkHttpClient,
    private val gson: Gson
) {
    private val cookieProvider: CookieProvider
        get() {
            val jar = okHttpClient.cookieJar
            // 拿到 DI 注入的 CookieProvider 实例
            return jar as? CookieProvider
                ?: throw IllegalStateException("CookieJar is not CookieProvider")
        }

    suspend fun generateQrCode(): QrCodeResponse {
        warmUp()

        // 尝试新版端点
        val primaryUrl = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main-fe-header"
        val result = tryGenerate(primaryUrl)
        if (result != null && result.code == 0 && result.data != null) return result

        // 降级：尝试不带 source 参数
        val noSourceUrl = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate"
        val result2 = tryGenerate(noSourceUrl)
        if (result2 != null && result2.code == 0 && result2.data != null) return result2

        // 降级：尝试旧版端点
        val legacyUrl = "https://passport.bilibili.com/qrcode/getLoginUrl"
        val result3 = tryGenerate(legacyUrl)
        if (result3 != null && result3.code == 0 && result3.data != null) return result3

        // 全部失败，返回最后一个错误
        return result ?: result2 ?: result3 ?: QrCodeResponse(-1, "所有端点均失败", null)
    }

    private suspend fun tryGenerate(url: String): QrCodeResponse? {
        return try {
            val request = Request.Builder()
                .url(url)
                .header("User-Agent", UA)
                .header("Referer", "https://www.bilibili.com/")
                .build()
            val body = okHttpClient.newCall(request).execute().body?.string() ?: return null
            gson.fromJson(body, QrCodeResponse::class.java)
        } catch (_: Exception) {
            null
        }
    }

    private fun warmUp() {
        try {
            val request = Request.Builder()
                .url("https://www.bilibili.com/")
                .header("User-Agent", UA)
                .build()
            okHttpClient.newCall(request).execute().close()
        } catch (_: Exception) { }
    }

    suspend fun pollQrCode(qrcodeKey: String): QrPollResponse {
        val request = Request.Builder()
            .url("https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=$qrcodeKey")
            .header("User-Agent", UA)
            .header("Referer", "https://www.bilibili.com/")
            .build()
        val body = okHttpClient.newCall(request).execute().body?.string() ?: ""
        return gson.fromJson(body, QrPollResponse::class.java)
    }

    /** 从 CookieJar 中提取 B站 登录凭证 */
    fun extractCredential(): BiliCredential {
        return BiliCredential(
            sessdata = cookieProvider.getCookie("SESSDATA") ?: "",
            biliJct = cookieProvider.getCookie("bili_jct") ?: "",
            buvid3 = cookieProvider.getCookie("buvid3") ?: "",
            dedeuserId = cookieProvider.getCookie("DedeUserID") ?: ""
        )
    }

    companion object {
        private const val UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    }
}
