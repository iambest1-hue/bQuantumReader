package com.bquantum.bfastreader.ui.component

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

sealed class MarkdownElement {
    data class Header(val text: String, val level: Int) : MarkdownElement()
    data class Metadata(val text: String) : MarkdownElement()
    data class TimestampEntry(val timestamp: String, val content: String) : MarkdownElement()
    data object Divider : MarkdownElement()
    data class Stats(val text: String) : MarkdownElement()
    data object EmptyLine : MarkdownElement()
    data class BodyText(val text: String) : MarkdownElement()
}

object MarkdownParser {
    fun parse(markdown: String): List<MarkdownElement> {
        return markdown.lines().map { line ->
            when {
                line.startsWith("# ") -> MarkdownElement.Header(line.removePrefix("# "), 1)
                line.startsWith("## ") -> MarkdownElement.Header(line.removePrefix("## "), 2)
                line.startsWith("> ") -> MarkdownElement.Metadata(line.removePrefix("> "))
                line == "---" -> MarkdownElement.Divider
                line.isBlank() -> MarkdownElement.EmptyLine
                line.matches(Regex("^\\[\\d{1,2}:\\d{2}(?::\\d{2})?] .*")) -> {
                    val match = Regex("^\\[(\\d{1,2}:\\d{2}(?::\\d{2})?)] (.*)").find(line)
                    if (match != null) {
                        MarkdownElement.TimestampEntry(match.groupValues[1], match.groupValues[2])
                    } else {
                        MarkdownElement.BodyText(line)
                    }
                }
                else -> MarkdownElement.BodyText(line)
            }
        }
    }
}

@Composable
fun MarkdownPreview(
    markdown: String,
    modifier: Modifier = Modifier
) {
    val elements = MarkdownParser.parse(markdown)

    LazyColumn(modifier = modifier.fillMaxSize()) {
        items(elements) { element ->
            when (element) {
                is MarkdownElement.Header -> {
                    Text(
                        text = element.text,
                        style = if (element.level == 1) {
                            MaterialTheme.typography.headlineMedium
                        } else {
                            MaterialTheme.typography.titleMedium
                        },
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = if (element.level == 1) 4.dp else 8.dp, bottom = 4.dp)
                    )
                }
                is MarkdownElement.Metadata -> {
                    Text(
                        text = element.text,
                        style = MaterialTheme.typography.bodySmall,
                        fontStyle = FontStyle.Italic,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 1.dp)
                    )
                }
                is MarkdownElement.TimestampEntry -> {
                    Text(
                        text = "[${element.timestamp}] ${element.content}",
                        style = MaterialTheme.typography.bodyMedium.copy(
                            fontSize = 14.sp,
                            lineHeight = 20.sp
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 2.dp)
                    )
                }
                is MarkdownElement.Divider -> {
                    HorizontalDivider(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                    )
                }
                is MarkdownElement.EmptyLine -> {
                    Text(
                        text = "",
                        modifier = Modifier.padding(vertical = 2.dp)
                    )
                }
                is MarkdownElement.Stats -> {
                    Text(
                        text = element.text,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 1.dp)
                    )
                }
                is MarkdownElement.BodyText -> {
                    Text(
                        text = element.text,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 1.dp)
                    )
                }
            }
        }
    }
}
