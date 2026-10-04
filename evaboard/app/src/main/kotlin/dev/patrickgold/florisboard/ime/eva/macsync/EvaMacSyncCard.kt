/*
 * evaBoard: the settings card for the clipboard link with the Mac (EvaMacSync): a switch, the
 * pairing code the Mac app shows, and one line saying what the link is doing.
 */

package dev.patrickgold.florisboard.ime.eva.macsync

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import dev.patrickgold.florisboard.app.FlorisPreferenceStore
import dev.patrickgold.jetpref.datastore.model.observeAsState
import kotlinx.coroutines.launch

@Composable
fun EvaMacSyncCard(modifier: Modifier = Modifier) {
    val prefs by FlorisPreferenceStore
    val scope = rememberCoroutineScope()
    val on by prefs.keyboard.evaMacSync.observeAsState()
    val savedCode by prefs.keyboard.evaMacSyncCode.observeAsState()
    val status by EvaMacSync.status.collectAsState()
    var code by remember { mutableStateOf(savedCode) }
    LaunchedEffect(savedCode) { if (MacSyncCipher.normalize(code) != MacSyncCipher.normalize(savedCode)) code = savedCode }

    Card(modifier = modifier) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = "Буфер обміну на Mac", style = MaterialTheme.typography.titleMedium)
                    Text(
                        text = if (on) status else "Уся історія буфера - і на телефоні, і на Mac (через домашній Wi-Fi)",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                Switch(checked = on, onCheckedChange = { scope.launch { prefs.keyboard.evaMacSync.set(it) } })
            }
            if (on) {
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = code,
                    onValueChange = { typed ->
                        code = typed.uppercase()
                        // saved once it is whole, so a half-typed code never starts a connection
                        val clean = MacSyncCipher.normalize(typed)
                        if (clean.length == 16 || clean.isEmpty()) {
                            scope.launch { prefs.keyboard.evaMacSyncCode.set(clean.chunked(4).joinToString("-")) }
                        }
                    },
                    label = { Text("Код з Mac (16 знаків)") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
