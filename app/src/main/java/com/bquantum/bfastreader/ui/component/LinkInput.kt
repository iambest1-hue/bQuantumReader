package com.bquantum.bfastreader.ui.component

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.input.ImeAction
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

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
    ) {
        OutlinedTextField(
            value = url,
            onValueChange = onUrlChange,
            modifier = Modifier.weight(1f),
            placeholder = { Text("粘贴 B站视频链接或 BV 号") },
            singleLine = true,
            enabled = enabled,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { onParse() }),
            trailingIcon = {
                if (url.isNotEmpty()) {
                    IconButton(onClick = { onUrlChange("") }) {
                        Icon(Icons.Default.Clear, contentDescription = "清除")
                    }
                }
            }
        )

        IconButton(
            onClick = {
                clipboardManager.getText()?.text?.let { onUrlChange(it) }
            },
            modifier = Modifier
                .padding(start = 4.dp)
                .padding(top = 8.dp)
        ) {
            Icon(Icons.Default.ContentPaste, contentDescription = "粘贴")
        }

        FilledIconButton(
            onClick = onParse,
            enabled = enabled && url.isNotBlank(),
            modifier = Modifier
                .padding(start = 4.dp)
                .padding(top = 8.dp)
        ) {
            Icon(Icons.Default.Search, contentDescription = "解析")
        }
    }
}
