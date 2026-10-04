/*
 * evaBoard: TEMPORARY development updater - remove before evaBoard is finished.
 *
 * Shows an «Оновити evaBoard» card at the top of the settings home screen. It
 * looks up the newest GitHub release tagged `evaboard-vX.Y.Z` on the
 * BearlessNotes repo, downloads its APK into the cache and hands it to
 * Android's installer, which asks the user once to confirm the update.
 *
 * It is the only reason evaBoard holds the INTERNET and
 * REQUEST_INSTALL_PACKAGES permissions. To remove it: delete this folder, the
 * EvaDevUpdateCard() call in HomeScreen.kt, the two permissions and the
 * `eva_update` path in res/xml/file_paths.xml (all marked "dev updater").
 */

package dev.patrickgold.florisboard.ime.eva.devupdate

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import dev.patrickgold.florisboard.BuildConfig
import dev.patrickgold.florisboard.app.FlorisPreferenceStore
import dev.patrickgold.florisboard.ime.eva.EvaBlur
import dev.patrickgold.florisboard.ime.eva.EvaScreenshots
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import dev.patrickgold.jetpref.datastore.model.observeAsState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

private const val RELEASES_URL =
    "https://api.github.com/repos/solocareaqua360-droid/BearlessNotes/releases?per_page=30"
private const val TAG_PREFIX = "evaboard-v"

private data class EvaRelease(val version: String, val apkUrl: String)

private sealed interface UpdateState {
    data object Idle : UpdateState
    data object Checking : UpdateState
    data object UpToDate : UpdateState
    data class Available(val release: EvaRelease) : UpdateState
    data class Downloading(val percent: Int) : UpdateState
    data class Failed(val message: String) : UpdateState
}

/** evaBoard: the link-previews switch, with what it costs said plainly. */
@Composable
fun EvaLinkPreviewsCard(modifier: Modifier = Modifier) {
    val prefs by FlorisPreferenceStore
    val scope = rememberCoroutineScope()
    val wanted by prefs.keyboard.evaLinkPreviews.observeAsState()
    Card(modifier = modifier) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = "Прев'ю посилань у буфері", style = MaterialTheme.typography.titleMedium)
                Text(
                    text = "Картинка й назва беруться з інтернету: скопійовані посилання відкриваються на їхніх сайтах",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            Switch(checked = wanted, onCheckedChange = { scope.launch { prefs.keyboard.evaLinkPreviews.set(it) } })
        }
    }
}

/** evaBoard: the screenshots-to-clipboard switch; turning it on asks for the photos permission. */
@Composable
fun EvaScreenshotsCard(modifier: Modifier = Modifier) {
    val prefs by FlorisPreferenceStore
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val wanted by prefs.keyboard.evaScreenshotsToClipboard.observeAsState()
    var granted by remember { mutableStateOf(EvaScreenshots.hasPermission(context)) }
    val askPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        granted = ok
        if (ok) scope.launch { prefs.keyboard.evaScreenshotsToClipboard.set(true) }
    }
    Card(modifier = modifier) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = "Скріншоти в буфер обміну", style = MaterialTheme.typography.titleMedium)
                Text(
                    text = when {
                        wanted && !granted -> "Немає дозволу на фото - увімкніть ще раз"
                        else -> "Кожен новий знімок; відредагований замінює свій оригінал"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                )
                // The last file names seen - shows which naming an edited save uses.
                val recent by EvaScreenshots.recentNames.collectAsState()
                if (wanted && recent.isNotEmpty()) {
                    Text(
                        text = "Останні:\n" + recent.joinToString("\n"),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            Switch(
                checked = wanted && granted,
                onCheckedChange = { on ->
                    if (on && !EvaScreenshots.hasPermission(context)) {
                        askPermission.launch(EvaScreenshots.permission)
                    } else {
                        scope.launch { prefs.keyboard.evaScreenshotsToClipboard.set(on) }
                    }
                },
            )
        }
    }
}

/** evaBoard: the see-through ground switch, saying whether Android will also blur behind it. */
@Composable
fun EvaBlurCard(modifier: Modifier = Modifier) {
    val prefs by FlorisPreferenceStore
    val scope = rememberCoroutineScope()
    val wanted by prefs.keyboard.evaBlur.observeAsState()
    val available by EvaBlur.enabled.collectAsState()
    Card(modifier = modifier) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = "Прозора підкладка", style = MaterialTheme.typography.titleMedium)
                Text(
                    text = if (available) {
                        "Крізь клавіатуру видно застосунок, розмито"
                    } else {
                        "Крізь клавіатуру видно застосунок (розмиття Android тут не дозволяє)"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            Switch(checked = wanted, onCheckedChange = { scope.launch { prefs.keyboard.evaBlur.set(it) } })
        }
    }
}

@Composable
fun EvaDevUpdateCard(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf<UpdateState>(UpdateState.Idle) }
    val current = BuildConfig.VERSION_NAME.substringBefore("-")

    Card(modifier = modifier) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "Оновити evaBoard",
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                text = when (val s = state) {
                    UpdateState.Idle -> "Зараз стоїть версія $current"
                    UpdateState.Checking -> "Перевіряю…"
                    UpdateState.UpToDate -> "Стоїть найновіша версія $current"
                    is UpdateState.Available -> "Є нова версія ${s.release.version} (зараз $current)"
                    is UpdateState.Downloading -> "Завантажую… ${s.percent}%"
                    is UpdateState.Failed -> s.message
                },
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(modifier = Modifier.height(12.dp))
            val s = state
            when {
                s is UpdateState.Available -> Button(onClick = {
                    if (!context.packageManager.canRequestPackageInstalls()) {
                        state = UpdateState.Failed(
                            "Дозвольте evaBoard встановлювати програми і натисніть «Перевірити» ще раз"
                        )
                        context.startActivity(
                            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                                .setData(Uri.parse("package:${context.packageName}"))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                        return@Button
                    }
                    scope.launch {
                        try {
                            val apk = download(context, s.release) { state = UpdateState.Downloading(it) }
                            state = UpdateState.Idle
                            install(context, apk)
                        } catch (e: Exception) {
                            state = UpdateState.Failed("Не вдалося завантажити: ${e.message}")
                        }
                    }
                }) { Text("Оновити до ${s.release.version}") }

                s is UpdateState.Checking || s is UpdateState.Downloading -> Unit

                else -> Button(onClick = {
                    state = UpdateState.Checking
                    scope.launch {
                        state = try {
                            val newest = findNewest()
                            if (newest != null && isNewer(newest.version, current)) {
                                UpdateState.Available(newest)
                            } else {
                                UpdateState.UpToDate
                            }
                        } catch (e: Exception) {
                            UpdateState.Failed("Не вдалося перевірити: ${e.message}")
                        }
                    }
                }) { Text("Перевірити") }
            }
        }
    }
}

/**
 * Opens [url], retrying a few times while GitHub answers with a 5xx: its download servers
 * hand out short runs of 503 even when everything is "operational".
 */
private suspend fun openWithRetry(url: String, accept: String? = null): HttpURLConnection {
    var lastCode = 0
    repeat(5) { attempt ->
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = true
        accept?.let { conn.setRequestProperty("Accept", it) }
        lastCode = conn.responseCode
        if (lastCode in 200..299) return conn
        conn.disconnect()
        if (lastCode < 500) throw IOException("GitHub відповів $lastCode")
        delay(1500L * (attempt + 1))
    }
    throw IOException("GitHub тимчасово не відповідає ($lastCode), спробуйте ще раз")
}

private suspend fun findNewest(): EvaRelease? = withContext(Dispatchers.IO) {
    val conn = openWithRetry(RELEASES_URL, accept = "application/vnd.github+json")
    val body = conn.inputStream.bufferedReader().use { it.readText() }
    Json.parseToJsonElement(body).jsonArray.mapNotNull { el ->
        val release = el.jsonObject
        val tag = release["tag_name"]?.jsonPrimitive?.content ?: return@mapNotNull null
        if (!tag.startsWith(TAG_PREFIX)) return@mapNotNull null
        val apk = release["assets"]?.jsonArray
            ?.map { it.jsonObject }
            ?.firstOrNull { it["name"]?.jsonPrimitive?.content?.endsWith(".apk") == true }
            ?: return@mapNotNull null
        val url = apk["browser_download_url"]?.jsonPrimitive?.content ?: return@mapNotNull null
        EvaRelease(tag.removePrefix(TAG_PREFIX), url)
    }.reduceOrNull { a, b -> if (isNewer(b.version, a.version)) b else a }
}

private fun isNewer(candidate: String, current: String): Boolean {
    val a = candidate.split(".").map { it.toIntOrNull() ?: 0 }
    val b = current.split(".").map { it.toIntOrNull() ?: 0 }
    for (i in 0 until maxOf(a.size, b.size)) {
        val x = a.getOrElse(i) { 0 }
        val y = b.getOrElse(i) { 0 }
        if (x != y) return x > y
    }
    return false
}

private suspend fun download(context: Context, release: EvaRelease, onProgress: (Int) -> Unit): File {
    val dir = File(context.cacheDir, "eva-update").apply { mkdirs() }
    dir.listFiles()?.forEach { it.delete() }
    val file = File(dir, "evaboard-${release.version}.apk")
    withContext(Dispatchers.IO) {
        val conn = openWithRetry(release.apkUrl)
        val total = conn.contentLengthLong
        conn.inputStream.use { input ->
            file.outputStream().use { output ->
                val buffer = ByteArray(64 * 1024)
                var done = 0L
                var lastPercent = -1
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    output.write(buffer, 0, n)
                    done += n
                    if (total > 0) {
                        val percent = (done * 100 / total).toInt()
                        if (percent != lastPercent) {
                            lastPercent = percent
                            withContext(Dispatchers.Main) { onProgress(percent) }
                        }
                    }
                }
            }
        }
    }
    return file
}

private fun install(context: Context, apk: File) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.provider.file", apk)
    context.startActivity(
        Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    )
}
