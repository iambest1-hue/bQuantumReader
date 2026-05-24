package com.bquantum.bfastreader.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val LightColorScheme = lightColorScheme(
    primary = Pink,
    onPrimary = androidx.compose.ui.graphics.Color.White,
    primaryContainer = PinkLight,
    secondary = Blue,
    onSecondary = androidx.compose.ui.graphics.Color.White,
    surface = Surface,
    onSurface = OnSurface,
    background = androidx.compose.ui.graphics.Color.White,
    onBackground = OnSurface,
    outline = androidx.compose.ui.graphics.Color(0xFFE0E0E0),
    surfaceVariant = androidx.compose.ui.graphics.Color(0xFFF0F0F0),
)

private val DarkColorScheme = darkColorScheme(
    primary = Pink,
    onPrimary = androidx.compose.ui.graphics.Color.White,
    primaryContainer = PinkDark,
    secondary = Blue,
    onSecondary = androidx.compose.ui.graphics.Color.White,
    surface = SurfaceDark,
    onSurface = OnSurfaceDark,
    background = SurfaceDark,
    onBackground = OnSurfaceDark,
    outline = androidx.compose.ui.graphics.Color(0xFF3A3A3A),
    surfaceVariant = androidx.compose.ui.graphics.Color(0xFF2A2A2A),
)

@Composable
fun BFastReaderTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme,
        typography = Typography,
        content = content
    )
}
