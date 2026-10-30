package com.example.midiaindoorpainel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

@Composable
fun SettingsScreen(initialUrl: String, onConfirm: (String) -> Unit) {
    var text by remember { mutableStateOf(initialUrl) }
    var error by remember { mutableStateOf<String?>(null) }
    val invalidUrlMessage = stringResource(R.string.settings_error)

    Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier.widthIn(max = 480.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(stringResource(R.string.settings_title), style = MaterialTheme.typography.headlineMedium)
            Text(stringResource(R.string.settings_hint), style = MaterialTheme.typography.bodyMedium)
            OutlinedTextField(
                value = text,
                onValueChange = {
                    text = it
                    error = null
                },
                label = { Text(stringResource(R.string.settings_url_label)) },
                placeholder = { Text(stringResource(R.string.settings_url_placeholder)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = {
                    val normalized = normalizeServerUrl(text)
                    if (normalized == null) {
                        error = invalidUrlMessage
                    } else {
                        onConfirm(normalized)
                    }
                },
                modifier = Modifier.align(Alignment.End),
            ) { Text(stringResource(R.string.settings_connect)) }
        }
    }
}
