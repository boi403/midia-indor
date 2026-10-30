package com.example.midiaindoorpainel

import android.content.Context
import java.net.URL

private const val PREFS_NAME = "midia_indoor_painel_prefs"
private const val KEY_SERVER_URL = "server_url"

object PanelPrefs {
    fun getServerUrl(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_SERVER_URL, null)?.takeIf { it.isNotBlank() }
    }

    fun setServerUrl(context: Context, url: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(KEY_SERVER_URL, url).apply()
    }

    fun clearServerUrl(context: Context) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().remove(KEY_SERVER_URL).apply()
    }
}

/** Aceita "192.168.0.10:3000" ou uma URL completa; normaliza para "http://host:porta". */
fun normalizeServerUrl(raw: String): String? {
    var value = raw.trim()
    if (value.isEmpty()) return null
    if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://$value"
    value = value.trimEnd('/')
    return runCatching { URL(value); value }.getOrNull()
}
