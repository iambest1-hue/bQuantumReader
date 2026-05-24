package com.bquantum.bfastreader

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.bquantum.bfastreader.ui.screen.HomeScreen
import com.bquantum.bfastreader.ui.screen.SettingsScreen
import com.bquantum.bfastreader.ui.theme.BFastReaderTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            BFastReaderTheme {
                var showSettings by remember { mutableStateOf(false) }

                if (showSettings) {
                    BackHandler { showSettings = false }
                    SettingsScreen(onBack = { showSettings = false })
                } else {
                    HomeScreen(onSettings = { showSettings = true })
                }
            }
        }
    }
}
