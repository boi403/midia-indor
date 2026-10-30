package com.example.midiaindoorpainel

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.example.midiaindoorpainel.ui.theme.MyApplicationMidiaindorTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            MyApplicationMidiaindorTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    var serverUrl by remember { mutableStateOf(PanelPrefs.getServerUrl(this)) }
                    var showSettings by remember { mutableStateOf(serverUrl.isNullOrBlank()) }
                    if (showSettings) {
                        SettingsScreen(initialUrl = serverUrl ?: "") { url ->
                            PanelPrefs.setServerUrl(this, url)
                            serverUrl = url
                            showSettings = false
                        }
                    } else {
                        PanelScreen(
                            serverUrl = serverUrl!!,
                            // só abre a tela de configuração; o endereço salvo só muda se o usuário confirmar um novo
                            onRequestSettings = { showSettings = true },
                        )
                    }
                }
            }
        }
    }
}
