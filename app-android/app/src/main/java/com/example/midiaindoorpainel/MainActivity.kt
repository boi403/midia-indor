package com.example.midiaindoorpainel

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.example.midiaindoorpainel.ui.theme.MyApplicationMidiaindorTheme

// tempo máximo que a splash fica na tela esperando o painel carregar, mesmo
// se a rede estiver lenta ou o servidor não responder de primeira
private const val SPLASH_MAX_WAIT_MS = 4000L

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val splashScreen = installSplashScreen()
        super.onCreate(savedInstanceState)

        var keepSplashOnScreen = true
        splashScreen.setKeepOnScreenCondition { keepSplashOnScreen }
        Handler(Looper.getMainLooper()).postDelayed({ keepSplashOnScreen = false }, SPLASH_MAX_WAIT_MS)

        setContent {
            MyApplicationMidiaindorTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    var serverUrl by remember { mutableStateOf(PanelPrefs.getServerUrl(this)) }
                    var showSettings by remember { mutableStateOf(serverUrl.isNullOrBlank()) }
                    if (showSettings) {
                        // nada pra esperar aqui: é um formulário nativo, não o painel web
                        LaunchedEffect(Unit) { keepSplashOnScreen = false }
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
                            onPageReady = { keepSplashOnScreen = false },
                        )
                    }
                }
            }
        }
    }
}
