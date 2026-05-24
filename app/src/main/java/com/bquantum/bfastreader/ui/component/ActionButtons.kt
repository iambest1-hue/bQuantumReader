package com.bquantum.bfastreader.ui.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Subtitles
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun ActionButtons(
    hasVideo: Boolean,
    isExtracting: Boolean,
    onExtractSubtitles: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Button(
            onClick = onExtractSubtitles,
            enabled = hasVideo && !isExtracting,
            modifier = Modifier.weight(1f)
        ) {
            Icon(
                Icons.Default.Subtitles,
                contentDescription = null,
                modifier = Modifier.size(18.dp)
            )
            Text(" 提取字幕", modifier = Modifier.padding(start = 4.dp))
        }

        OutlinedButton(
            onClick = { /* 即将上线 */ },
            enabled = false,
            modifier = Modifier.weight(1f),
            colors = ButtonDefaults.outlinedButtonColors(
                disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
            )
        ) {
            Icon(
                Icons.Default.Mic,
                contentDescription = null,
                modifier = Modifier.size(18.dp)
            )
            Text(" 语音识别", modifier = Modifier.padding(start = 4.dp))
        }
    }
}
