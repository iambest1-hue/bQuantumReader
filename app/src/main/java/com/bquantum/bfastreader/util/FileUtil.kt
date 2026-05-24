package com.bquantum.bfastreader.util

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File

object FileUtil {
    fun saveMarkdown(context: Context, content: String, filename: String): File {
        val file = File(context.cacheDir, filename)
        file.writeText(content)
        return file
    }

    fun createShareIntent(context: Context, file: File, mimeType: String = "text/markdown"): Intent {
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            file
        )
        return Intent(Intent.ACTION_SEND).apply {
            type = mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }
}
