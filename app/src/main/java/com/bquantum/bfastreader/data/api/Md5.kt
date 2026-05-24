package com.bquantum.bfastreader.data.api

object Md5 {
    fun hash(input: String): String {
        val bytes = input.toByteArray(Charsets.UTF_8)
        return md5(bytes)
    }

    private fun md5(bytes: ByteArray): String {
        val padded = padMessage(bytes)
        val words = IntArray(padded.size / 4)
        for (i in padded.indices step 4) {
            words[i / 4] = (padded[i].toInt() and 0xff) or
                    ((padded[i + 1].toInt() and 0xff) shl 8) or
                    ((padded[i + 2].toInt() and 0xff) shl 16) or
                    ((padded[i + 3].toInt() and 0xff) shl 24)
        }

        var a0 = 0x67452301
        var b0 = 0xefcdab89.toInt()
        var c0 = 0x98badcfe.toInt()
        var d0 = 0x10325476

        val s = intArrayOf(
            7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
            5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
            4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
            6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
        )

        val k = intArrayOf(
            0xd76aa478.toInt(), 0xe8c7b756.toInt(), 0x242070db, 0xc1bdceee.toInt(),
            0xf57c0faf.toInt(), 0x4787c62a, 0xa8304613.toInt(), 0xfd469501.toInt(),
            0x698098d8.toInt(), 0x8b44f7af.toInt(), 0xffff5bb1.toInt(), 0x895cd7be.toInt(),
            0x6b901122, 0xfd987193.toInt(), 0xa679438e.toInt(), 0x49b40821,
            0xf61e2562.toInt(), 0xc040b340.toInt(), 0x265e5a51, 0xe9b6c7aa.toInt(),
            0xd62f105d.toInt(), 0x02441453, 0xd8a1e681.toInt(), 0xe7d3fbc8.toInt(),
            0x21e1cde6, 0xc33707d6.toInt(), 0xf4d50d87.toInt(), 0x455a14ed,
            0xa9e3e905.toInt(), 0xfcefa3f8.toInt(), 0x676f02d9, 0x8d2a4c8a.toInt(),
            0xfffa3942.toInt(), 0x8771f681.toInt(), 0x6d9d6122, 0xfde5380c.toInt(),
            0xa4beea44.toInt(), 0x4bdecfa9, 0xf6bb4b60.toInt(), 0xbebfbc70.toInt(),
            0x289b7ec6, 0xeaa127fa.toInt(), 0xd4ef3085.toInt(), 0x04881d05,
            0xd9d4d039.toInt(), 0xe6db99e5.toInt(), 0x1fa27cf8, 0xc4ac5665.toInt(),
            0xf4292244.toInt(), 0x432aff97, 0xab9423a7.toInt(), 0xfc93a039.toInt(),
            0x655b59c3, 0x8f0ccc92.toInt(), 0xffeff47d.toInt(), 0x85845dd1.toInt(),
            0x6fa87e4f, 0xfe2ce6e0.toInt(), 0xa3014314.toInt(), 0x4e0811a1,
            0xf7537e82.toInt(), 0xbd3af235.toInt(), 0x2ad7d2bb, 0xeb86d391.toInt()
        )

        var i = 0
        while (i < words.size) {
            var a = a0
            var b = b0
            var c = c0
            var d = d0

            for (j in 0..63) {
                val f: Int
                val g: Int
                when {
                    j < 16 -> {
                        f = (b and c) or (b.inv() and d)
                        g = j
                    }
                    j < 32 -> {
                        f = (d and b) or (d.inv() and c)
                        g = (5 * j + 1) % 16
                    }
                    j < 48 -> {
                        f = b xor c xor d
                        g = (3 * j + 5) % 16
                    }
                    else -> {
                        f = c xor (b or d.inv())
                        g = (7 * j) % 16
                    }
                }

                val temp = d
                d = c
                c = b
                b = b + leftRotate(a + f + k[j] + words[i + g], s[j])
                a = temp
            }

            a0 += a
            b0 += b
            c0 += c
            d0 += d
            i += 16
        }

        return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0)
    }

    private fun padMessage(bytes: ByteArray): ByteArray {
        val msgLen = bytes.size
        val bitLen = msgLen * 8L

        val padLen = if ((msgLen + 9) % 64 == 0) 64 else 64 - (msgLen + 9) % 64
        val totalLen = msgLen + 1 + padLen + 8
        val padded = ByteArray(totalLen)

        bytes.copyInto(padded)
        padded[msgLen] = 0x80.toByte()

        for (i in 0..7) {
            padded[totalLen - 8 + i] = ((bitLen ushr (i * 8)) and 0xff).toByte()
        }

        return padded
    }

    private fun leftRotate(x: Int, n: Int): Int =
        (x shl n) or (x ushr (32 - n))

    private fun toHex(n: Int): String {
        val chars = CharArray(8)
        for (i in 0..3) {
            val b = (n ushr (i * 8)) and 0xff
            chars[i * 2] = "0123456789abcdef"[b shr 4]
            chars[i * 2 + 1] = "0123456789abcdef"[b and 0xf]
        }
        return String(chars)
    }
}
