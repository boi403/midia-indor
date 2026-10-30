package com.example.midiaindoorpainel

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.MimeTypeMap
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

private const val RETRY_DELAY_MS = 5000L

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun PanelScreen(serverUrl: String, onRequestSettings: () -> Unit) {
    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    var pendingFileCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    val allowedOrigin = remember(serverUrl) {
        Uri.parse(serverUrl).let { "${it.scheme}://${it.authority}" }
    }

    val filePicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri: Uri? ->
        pendingFileCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        pendingFileCallback = null
    }

    // volta no histórico do painel antes de sair do app, como um navegador faria
    val activity = LocalContext.current as? Activity
    BackHandler(enabled = true) {
        val webView = webViewRef
        if (webView != null && webView.canGoBack()) webView.goBack() else activity?.finish()
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Surface(tonalElevation = 2.dp) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceBetween,
            ) {
                Text("Mídia Indoor", style = MaterialTheme.typography.titleMedium, modifier = Modifier.align(Alignment.CenterVertically))
                TextButton(onClick = onRequestSettings) { Text("Trocar servidor") }
            }
        }

        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                val handler = Handler(Looper.getMainLooper())
                WebView(context).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    setBackgroundColor(Color.WHITE)
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    // o painel já declara <meta name="viewport" width=device-width> e tem seu
                    // próprio CSS responsivo; overview/wide-viewport são para sites SEM isso e
                    // forçam um zoom "desktop encolhido" que não bate com o layout mobile do site.
                    settings.textZoom = 100
                    settings.cacheMode = WebSettings.LOAD_DEFAULT
                    webViewClient = object : WebViewClient() {
                        override fun onReceivedError(
                            view: WebView,
                            request: WebResourceRequest,
                            error: WebResourceError,
                        ) {
                            if (request.isForMainFrame) {
                                handler.postDelayed({ view.loadUrl(serverUrl) }, RETRY_DELAY_MS)
                            }
                        }

                        // mantém a navegação dentro do painel configurado; qualquer outro destino
                        // (link, redirect ou conteúdo injetado) abre fora, onde o endereço fica visível
                        override fun shouldOverrideUrlLoading(
                            view: WebView,
                            request: WebResourceRequest,
                        ): Boolean {
                            val origin = "${request.url.scheme}://${request.url.authority}"
                            if (origin == allowedOrigin) return false
                            return runCatching {
                                view.context.startActivity(
                                    android.content.Intent(android.content.Intent.ACTION_VIEW, request.url),
                                )
                            }.isSuccess
                        }
                    }
                    webChromeClient = object : WebChromeClient() {
                        // necessário para o upload de logo/imagens em Configurações funcionar dentro do app
                        override fun onShowFileChooser(
                            webView: WebView,
                            filePathCallback: ValueCallback<Array<Uri>>,
                            fileChooserParams: FileChooserParams,
                        ): Boolean {
                            pendingFileCallback?.onReceiveValue(null)
                            pendingFileCallback = filePathCallback
                            val mimes = fileChooserParams.acceptTypes.orEmpty()
                                .flatMap { it.split(',') }
                                .map { it.trim() }
                                .mapNotNull { type ->
                                    when {
                                        type.contains('/') -> type
                                        type.startsWith('.') -> MimeTypeMap.getSingleton()
                                            .getMimeTypeFromExtension(type.removePrefix(".").lowercase())
                                        else -> null
                                    }
                                }
                                .distinct()
                            return try {
                                filePicker.launch(if (mimes.isEmpty()) arrayOf("*/*") else mimes.toTypedArray())
                                true
                            } catch (e: ActivityNotFoundException) {
                                pendingFileCallback?.onReceiveValue(null)
                                pendingFileCallback = null
                                false
                            }
                        }
                    }
                    loadUrl(serverUrl)
                    webViewRef = this
                }
            },
        )
    }
}
