package com.bquantum.bfastreader.ui.component

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.unit.dp

@Composable
fun LinkInput(
    url: String,
    onUrlChange: (String) -> Unit,
    onParse: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    val clipboardManager = LocalClipboardManager.current

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
    ) {
        OutlinedTextField(
            value = url,
            onValueChange = onUrlChange,
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("粘贴 B站视频链接或 BV 号\n支持 b23.tv 短链接、分享文本") },
            minLines = 3,
            maxLines = 5,
            enabled = enabled
        )

        Spacer(modifier = Modifier.height(4.dp))

        Row(modifier = Modifier.fillMaxWidth()) {
            IconButton(
                onClick = {
                    clipboardManager.getText()?.text?.let { onUrlChange(it) }
                },
                modifier = Modifier.padding(end = 4.dp)
            ) {
                Icon(
                    Icons.Default.ContentPaste,
                    contentDescription = "粘贴",
                    modifier = Modifier.size(20.dp)
                )
            }

            IconButton(
                onClick = { onUrlChange("") },
                enabled = url.isNotEmpty(),
                modifier = Modifier.padding(end = 4.dp)
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = "清除",
                    modifier = Modifier.size(20.dp)
                )
            }

            FilledIconButton(
                onClick = onParse,
                enabled = enabled && url.isNotBlank(),
                modifier = Modifier.padding(start = 8.dp)
            ) {
                Icon(Icons.Default.Search, contentDescription = "解析")
            }
        }
    }
}
