package com.bquantum.bfastreader.domain

object LinkParser {
    private val BVID_REGEX = Regex("BV1[a-zA-Z0-9]{9}")
    private val AID_REGEX = Regex("av\\d+", RegexOption.IGNORE_CASE)

    fun extractBvid(input: String): String? {
        val trimmed = input.trim()
        BVID_REGEX.find(trimmed)?.value?.let { return it }
        AID_REGEX.find(trimmed)?.value?.let { return it.lowercase() }
        return null
    }
}
