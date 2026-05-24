package com.bquantum.bfastreader.data.local

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

class CookieProvider : CookieJar {
    private val store = mutableListOf<Cookie>()

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        return store.filter { cookie -> cookie.matches(url) }
    }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        // 去重：相同 name+domain 的 cookie 替换旧的
        for (cookie in cookies) {
            store.removeAll { it.name == cookie.name && it.domain == cookie.domain }
            store.add(cookie)
        }
    }

    fun getCookie(name: String): String? {
        return store.find { it.name == name }?.value
    }

    fun getAllCookies(): List<Cookie> = store.toList()

    fun clear() = store.clear()
}
