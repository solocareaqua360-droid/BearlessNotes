/*
 * evaBoard: the clipboard history, mirrored with the Mac over the home Wi-Fi.
 *
 * The whole visible history travels, not only the last copy: what is copied on either side shows up
 * in both lists, and a deletion, a clear or a pin on either side is repeated on the other. When the
 * two meet again after a while apart (another network, the phone asleep), they swap their full lists
 * and merge them. Items the phone marks as sensitive (passwords) never leave it.
 *
 * A fresh copy on either side also becomes the other side's own clipboard: Cmd+V on the Mac pastes
 * what was just copied on the phone, and Paste in any phone app takes what was just copied on the Mac.
 * Items that only arrive with the full list (after time apart) join the history and nothing more.
 *
 * The phone side is a client: it looks for the Mac over Bonjour (MAC_SYNC_SERVICE_TYPE), remembers
 * the last address that worked and tries that first. The wire format is in MacSyncProtocol.kt; the
 * Mac app is evaboard/mac.
 *
 * Text, pictures and files travel; a picture's bytes go in a message of their own ("need" / "blob"),
 * a file's in parts ("need" / "part"), so a full list stays small. Videos stay on the phone.
 *
 * Everything that touches the list runs on one thread ([serial]); the socket reads and writes have
 * their own coroutines.
 */

package dev.patrickgold.florisboard.ime.eva.macsync

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.provider.Settings
import dev.patrickgold.florisboard.app.FlorisPreferenceStore
import dev.patrickgold.florisboard.clipboardManager
import dev.patrickgold.florisboard.ime.clipboard.ClipboardHistory
import dev.patrickgold.florisboard.ime.clipboard.provider.ClipboardFileStorage
import dev.patrickgold.florisboard.ime.clipboard.provider.ClipboardItem
import dev.patrickgold.florisboard.ime.clipboard.provider.ClipboardMediaProvider
import dev.patrickgold.florisboard.ime.clipboard.provider.ItemType
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import kotlin.coroutines.resume
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

object EvaMacSync {
    private const val FRESH_MS = 15_000L
    private const val GONE_KEEP_MS = 30L * 24 * 60 * 60 * 1000
    private const val MAX_FRAME = 32 * 1024 * 1024
    private const val MAX_IMAGE = 20 * 1024 * 1024
    private const val MAX_FILE = 2L * 1024 * 1024 * 1024
    private const val PART = 512 * 1024

    private val _status = MutableStateFlow("Вимкнено")
    /** One line for the settings card. */
    val status = _status.asStateFlow()

    @OptIn(ExperimentalCoroutinesApi::class)
    private val serial = Dispatchers.IO.limitedParallelism(1)
    private val scope = CoroutineScope(SupervisorJob() + serial)
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }

    private lateinit var app: Context
    private var started = false

    // the list as last agreed with the Mac, by item id
    private val known = HashMap<String, SyncItem>()
    // deletions: item id -> when
    private val gone = HashMap<String, Long>()
    // the keyboard's own history rows, by item id (to update or delete them)
    private val rows = HashMap<String, ClipboardItem>()
    // a picture's id is the hash of its bytes: worked out once per stored file
    private val imageIds = HashMap<String, String>()
    // pictures from the Mac whose bytes were asked for: id -> (item, was it a fresh copy)
    private val waiting = HashMap<String, Pair<SyncItem, Boolean>>()
    // items from the Mac written a moment ago, before they show up in the history: id -> when
    private val arriving = HashMap<String, Long>()
    // files from the Mac on their way in, part by part
    private class Incoming(val item: SyncItem, val fresh: Boolean, val temp: File) {
        val digest: java.security.MessageDigest = java.security.MessageDigest.getInstance("SHA-256")
        var next = 0
    }
    private val inbound = HashMap<String, Incoming>()
    // file parts going out: a small queue, so a big file is read only as fast as it is sent
    private var bulk: Channel<SyncMessage>? = null
    private var sessionScope: CoroutineScope? = null
    private var historyLoaded = false
    private var lastHost: String? = null
    private var outgoing: Channel<SyncMessage>? = null
    private var linkJob: Job? = null
    private var saveJob: Job? = null

    @Serializable
    private data class Saved(val known: List<SyncItem> = emptyList(), val gone: Map<String, Long> = emptyMap(), val host: String? = null)

    private val stateFile get() = File(app.filesDir, "eva-macsync.json")

    @OptIn(FlowPreview::class)
    fun start(context: Context) {
        if (started) return
        started = true
        app = context.applicationContext
        scope.launch {
            load()
            val clipboard by app.clipboardManager()
            launch {
                // A re-copy is a delete and an insert in a row: wait for both before comparing.
                clipboard.historyFlow.debounce(400).collect { onHistory(it) }
            }
            val prefs by FlorisPreferenceStore
            combine(prefs.keyboard.evaMacSync.asFlow(), prefs.keyboard.evaMacSyncCode.asFlow()) { on, code ->
                on to MacSyncCipher.normalize(code)
            }.distinctUntilChanged().collect { (on, code) ->
                linkJob?.cancel()
                linkJob = null
                when {
                    !on -> _status.value = "Вимкнено"
                    code.length < 16 -> _status.value = "Введіть код, який показує Mac"
                    else -> linkJob = CoroutineScope(SupervisorJob() + Dispatchers.IO).launch { runLink(code) }
                }
            }
        }
    }

    // ---- the list -------------------------------------------------------------------------------

    private fun onHistory(history: ClipboardHistory) {
        if (history === ClipboardHistory.EMPTY) return // before the database has loaded
        historyLoaded = true
        val now = System.currentTimeMillis()
        val current = HashMap<String, ClipboardItem>()
        val shapes = HashMap<String, SyncItem>()
        for (item in history.all) {
            if (item.isSensitive) continue
            val shape = shapeOf(item) ?: continue
            val other = current[shape.id]
            if (other == null || item.creationTimestampMs > other.creationTimestampMs) {
                current[shape.id] = item
                shapes[shape.id] = shape
            }
        }
        rows.clear()
        rows.putAll(current)
        arriving.keys.removeAll(current.keys)

        for ((id, item) in current) {
            val ts = item.creationTimestampMs
            val was = known[id]
            if (was == null) {
                // still here although deleted after it was copied: that deletion is on its way
                if ((gone[id] ?: Long.MIN_VALUE) >= ts) continue
                gone.remove(id)
                val added = shapes[id]!!
                known[id] = added
                send(SyncMessage(type = "upsert", item = added, fresh = now - ts < FRESH_MS))
            } else if (was.ts != ts || was.pinned != item.isPinned) {
                val changed = was.copy(ts = ts, pinned = item.isPinned, mod = maxOf(now, was.mod + 1))
                known[id] = changed
                send(SyncMessage(type = "upsert", item = changed, fresh = ts > was.ts && now - ts < FRESH_MS))
            }
        }
        // what came from the Mac a moment ago may not have reached the database yet: not a deletion
        val removed = known.keys - current.keys - arriving.filterValues { now - it < 10_000L }.keys
        if (removed.isNotEmpty()) {
            val marks = removed.associateWith { now }
            for (id in removed) known.remove(id)
            gone.putAll(marks)
            send(SyncMessage(type = "gone", gone = marks))
        }
        scheduleSave()
    }

    /** What a history row looks like on the wire; null for rows that do not travel (videos). */
    private fun shapeOf(item: ClipboardItem): SyncItem? {
        val ts = item.creationTimestampMs
        return when (item.type) {
            ItemType.TEXT -> {
                val text = item.text?.takeIf { it.isNotEmpty() } ?: return null
                SyncItem(id = MacSyncIds.forText(text), text = text, ts = ts, pinned = item.isPinned, mod = ts)
            }
            ItemType.IMAGE -> {
                val uri = item.uri ?: return null
                val id = imageIds.getOrPut(uri.toString()) {
                    val bytes = imageBytes(item) ?: return null
                    if (bytes.size > MAX_IMAGE) return null
                    MacSyncIds.forBytes(bytes)
                }
                val mime = item.mimeTypes.firstOrNull { it.startsWith("image/") } ?: "image/png"
                SyncItem(id = id, kind = "image", text = "", mime = mime, ts = ts, pinned = item.isPinned, mod = ts)
            }
            ItemType.FILE -> {
                val uri = item.uri ?: return null
                val id = imageIds.getOrPut(uri.toString()) {
                    EvaFiles.open(app, uri)?.use { MacSyncIds.forStream(it) } ?: return null
                }
                val info = EvaFiles.info(app, uri, item.text ?: "file")
                if (info.size > MAX_FILE) return null
                SyncItem(
                    id = id, kind = "file", text = item.text ?: info.name, mime = item.mimeTypes.firstOrNull() ?: info.mime,
                    size = info.size.takeIf { it >= 0 }, ts = ts, pinned = item.isPinned, mod = ts,
                )
            }
            else -> null
        }
    }

    private fun imageBytes(item: ClipboardItem): ByteArray? = try {
        val uri = item.uri!!
        if (uri.authority == ClipboardMediaProvider.AUTHORITY) {
            ClipboardFileStorage.getFileForId(app, ContentUris.parseId(uri)).readBytes()
        } else {
            app.contentResolver.openInputStream(uri)?.use { it.readBytes() }
        }
    } catch (_: Exception) {
        null
    }

    private fun applyUpsert(incoming: SyncItem, fresh: Boolean = false) {
        if (incoming.kind != "text" && incoming.kind != "image" && incoming.kind != "file") return
        val keep = MacSyncMerge.upsert(known[incoming.id], gone[incoming.id], incoming) ?: return
        gone.remove(incoming.id)
        val clipboard by app.clipboardManager()
        val row = rows[incoming.id]
        if (row != null) {
            known[incoming.id] = keep
            clipboard.evaUpdateClip(row.copy(creationTimestampMs = keep.ts, isPinned = keep.pinned))
            if (fresh) makePrimary(row.copy(creationTimestampMs = keep.ts, isPinned = keep.pinned), keep)
        } else if (keep.kind == "text") {
            known[incoming.id] = keep
            arriving[keep.id] = System.currentTimeMillis()
            val item = ClipboardItem(
                type = ItemType.TEXT,
                text = keep.text,
                uri = null,
                creationTimestampMs = keep.ts,
                isPinned = keep.pinned,
                mimeTypes = listOf("text/plain"),
            )
            clipboard.insertClip(item)
            if (fresh) makePrimary(item, keep)
        } else if (keep.kind == "image") {
            // a picture: its bytes come separately, asked for here and written when they arrive
            waiting[keep.id] = keep to fresh
            send(SyncMessage(type = "need", ids = listOf(keep.id)))
        } else if (!inbound.containsKey(keep.id) && (keep.size ?: 0) <= MAX_FILE) {
            // a file: its content comes in parts (applyPart)
            inbound[keep.id] = Incoming(keep, fresh, File(app.cacheDir, "eva-macsync-in-${keep.id}").apply { delete() })
            send(SyncMessage(type = "need", ids = listOf(keep.id)))
        }
        scheduleSave()
    }

    private fun applyBlob(id: String, data: String) {
        val (keep, fresh) = waiting.remove(id) ?: return
        val bytes = try { Base64.decode(data, Base64.NO_WRAP) } catch (_: Exception) { return }
        if (MacSyncIds.forBytes(bytes) != id) return
        // the keyboard keeps pictures through its own media provider, which copies them in from a file
        val temp = File(app.cacheDir, "eva-macsync-$id")
        val uri = try {
            temp.writeBytes(bytes)
            val values = ContentValues(3).apply {
                put(OpenableColumns.DISPLAY_NAME, "Mac")
                put(ClipboardMediaProvider.Columns.MediaUri, Uri.fromFile(temp).toString())
                put(ClipboardMediaProvider.Columns.MimeTypes, keep.mime ?: "image/png")
            }
            app.contentResolver.insert(ClipboardMediaProvider.IMAGE_CLIPS_URI, values)
        } catch (_: Exception) {
            null
        } finally {
            temp.delete()
        } ?: return
        imageIds[uri.toString()] = id
        known[id] = keep
        arriving[id] = System.currentTimeMillis()
        val item = ClipboardItem(
            type = ItemType.IMAGE,
            text = null,
            uri = uri,
            creationTimestampMs = keep.ts,
            isPinned = keep.pinned,
            mimeTypes = listOf(keep.mime ?: "image/png"),
        )
        val clipboard by app.clipboardManager()
        clipboard.insertClip(item)
        if (fresh) makePrimary(item, keep)
        scheduleSave()
    }

    // copied on the Mac just now: also the phone's own clipboard, so any app's Paste takes it.
    // Set as the keyboard's primary clip first, so the system's change callback sees nothing new
    // and does not add it to the history a second time.
    private fun makePrimary(item: ClipboardItem, keep: SyncItem) {
        if (System.currentTimeMillis() - keep.ts > 60_000L) return
        val clipboard by app.clipboardManager()
        clipboard.updatePrimaryClip(item)
    }

    private fun sendBlobs(ids: List<String>) {
        for (id in ids) {
            val row = rows[id] ?: continue
            if (row.type == ItemType.FILE) {
                sendFile(id, row)
                continue
            }
            if (row.type != ItemType.IMAGE) continue
            val bytes = imageBytes(row) ?: continue
            if (bytes.size > MAX_IMAGE) continue
            send(SyncMessage(type = "blob", id = id, data = Base64.encodeToString(bytes, Base64.NO_WRAP)))
        }
    }

    /** Streams a file in parts on the bulk queue, off the list's thread. */
    private fun sendFile(id: String, row: ClipboardItem) {
        val out = bulk ?: return
        val uri = row.uri ?: return
        sessionScope?.launch(Dispatchers.IO) {
            try {
                EvaFiles.open(app, uri)?.use { input ->
                    var current = readPart(input)
                    var seq = 0
                    while (true) {
                        // one part read ahead, so the last part can say it is the last
                        val next = if (current.size == PART) readPart(input) else ByteArray(0)
                        val last = next.isEmpty()
                        out.send(SyncMessage(type = "part", id = id, seq = seq, last = last, data = Base64.encodeToString(current, Base64.NO_WRAP)))
                        if (last) break
                        current = next
                        seq++
                    }
                }
            } catch (_: Exception) {
            }
        }
    }

    /** Up to one part's worth of bytes; fewer only at the end of the file. */
    private fun readPart(input: java.io.InputStream): ByteArray {
        val buffer = ByteArray(PART)
        var filled = 0
        while (filled < PART) {
            val n = input.read(buffer, filled, PART - filled)
            if (n < 0) break
            filled += n
        }
        return if (filled == PART) buffer else buffer.copyOf(filled)
    }

    private fun applyPart(message: SyncMessage) {
        val id = message.id ?: return
        val job = inbound[id] ?: return
        if (message.seq != job.next) { // a part went missing: start again next time
            inbound.remove(id)?.temp?.delete()
            return
        }
        val bytes = try { Base64.decode(message.data ?: "", Base64.NO_WRAP) } catch (_: Exception) { return }
        job.digest.update(bytes)
        job.temp.appendBytes(bytes)
        job.next++
        if (message.last != true) return
        inbound.remove(id)
        val hash = "f" + job.digest.digest().joinToString("") { "%02x".format(it) }.take(32)
        val keep = job.item
        val uri = if (hash == id) EvaFiles.saveDownload(app, job.temp, keep.text.ifBlank { "file" }, keep.mime ?: EvaFiles.mimeFor(keep.text)) else null
        job.temp.delete()
        if (uri == null) return
        imageIds[uri.toString()] = id
        known[id] = keep
        arriving[id] = System.currentTimeMillis()
        val clipboard by app.clipboardManager()
        clipboard.insertClip(
            ClipboardItem(
                type = ItemType.FILE,
                text = keep.text,
                uri = uri,
                creationTimestampMs = keep.ts,
                isPinned = keep.pinned,
                mimeTypes = listOf(keep.mime ?: EvaFiles.mimeFor(keep.text)),
            )
        )
        if (job.fresh) {
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                android.widget.Toast.makeText(app, "Файл з Mac у «Завантаженнях»: ${keep.text}", android.widget.Toast.LENGTH_SHORT).show()
            }
        }
        scheduleSave()
    }

    private fun applyGone(marks: Map<String, Long>) {
        val clipboard by app.clipboardManager()
        for ((id, at) in marks) {
            gone[id] = maxOf(gone[id] ?: Long.MIN_VALUE, at)
            waiting.remove(id)
            inbound.remove(id)?.temp?.delete()
            val local = known[id] ?: continue
            if (MacSyncMerge.removes(local, at)) {
                known.remove(id)
                rows.remove(id)?.let { clipboard.deleteClip(it, onlyIfUnpinned = false) }
            }
        }
        scheduleSave()
    }

    private fun handle(message: SyncMessage, onHello: (String) -> Unit) {
        when (message.type) {
            "hello" -> onHello(message.device ?: "Mac")
            "snapshot" -> {
                message.gone?.let { applyGone(it) }
                message.items?.forEach { applyUpsert(it) }
            }
            "upsert" -> message.item?.let { applyUpsert(it, fresh = message.fresh == true) }
            "gone" -> message.gone?.let { applyGone(it) }
            "need" -> message.ids?.let { sendBlobs(it) }
            "blob" -> if (message.id != null && message.data != null) applyBlob(message.id, message.data)
            "part" -> applyPart(message)
        }
    }

    private fun send(message: SyncMessage) {
        outgoing?.trySend(message)
    }

    // ---- saving ---------------------------------------------------------------------------------

    private fun load() {
        try {
            if (!stateFile.exists()) return
            val saved = json.decodeFromString(Saved.serializer(), stateFile.readText())
            saved.known.forEach { known[it.id] = it }
            gone.putAll(saved.gone)
            lastHost = saved.host
        } catch (_: Exception) {
        }
    }

    private fun scheduleSave() {
        saveJob?.cancel()
        saveJob = scope.launch {
            delay(1000)
            val cutoff = System.currentTimeMillis() - GONE_KEEP_MS
            gone.entries.removeAll { it.value < cutoff }
            try {
                val temp = File(stateFile.path + ".tmp")
                temp.writeText(json.encodeToString(Saved.serializer(), Saved(known.values.toList(), HashMap(gone), lastHost)))
                temp.renameTo(stateFile)
            } catch (_: Exception) {
            }
        }
    }

    // ---- the link -------------------------------------------------------------------------------

    private suspend fun runLink(code: String) {
        val cipher = MacSyncCipher(code)
        var wait = 2_000L
        while (currentCoroutineContext().isActive) {
            if (!withContext(serial) { historyLoaded }) {
                _status.value = "Чекаю на буфер обміну…"
                delay(1000)
                continue
            }
            _status.value = "Шукаю Mac у мережі…"
            val remembered = withContext(serial) { lastHost }
            var socket = remembered?.let { connect(it) }
            if (socket == null) socket = discover()?.let { connect(it) }
            if (socket == null) {
                _status.value = "Mac не знайдено - він у цій самій мережі Wi-Fi?"
                delay(wait)
                wait = minOf(wait * 2, 60_000L)
                continue
            }
            val outcome = runSession(socket, cipher)
            try { socket.close() } catch (_: Exception) {}
            if (outcome == Outcome.WRONG_CODE) {
                _status.value = "Код не підходить - перевірте його на Mac"
                delay(60_000L)
            } else {
                wait = 2_000L
                _status.value = "Звʼязок перервано, підключаюсь знову…"
                delay(wait)
            }
        }
    }

    private enum class Outcome { CLOSED, WRONG_CODE }

    private fun connect(host: String): Socket? {
        val port = host.substringAfterLast('|').toIntOrNull() ?: return null
        val address = host.substringBeforeLast('|')
        return try {
            Socket().apply {
                connect(InetSocketAddress(InetAddress.getByName(address), port), 4000)
                tcpNoDelay = true
                soTimeout = 45_000
            }
        } catch (_: Exception) {
            null
        }
    }

    /** Looks for the Mac over Bonjour for a few seconds: "address|port", or null. */
    @Suppress("DEPRECATION")
    private suspend fun discover(): String? {
        val nsd = app.getSystemService(NsdManager::class.java) ?: return null
        var listener: NsdManager.DiscoveryListener? = null
        try {
            return withTimeoutOrNull(12_000L) {
                suspendCancellableCoroutine { cont ->
                    var resolving = false
                    val found = object : NsdManager.DiscoveryListener {
                        override fun onDiscoveryStarted(serviceType: String) {}
                        override fun onDiscoveryStopped(serviceType: String) {}
                        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                            if (cont.isActive) cont.resume(null)
                        }
                        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
                        override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
                        override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                            // one resolve at a time: Android refuses a second while one runs
                            if (resolving) return
                            resolving = true
                            nsd.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                                    resolving = false
                                }
                                override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                                    val host = serviceInfo.host?.hostAddress
                                    if (host != null && cont.isActive) cont.resume("$host|${serviceInfo.port}")
                                    else resolving = false
                                }
                            })
                        }
                    }
                    listener = found
                    try {
                        nsd.discoverServices(MAC_SYNC_SERVICE_TYPE.trimEnd('.'), NsdManager.PROTOCOL_DNS_SD, found)
                    } catch (_: Exception) {
                        listener = null
                        if (cont.isActive) cont.resume(null)
                    }
                }
            }
        } finally {
            listener?.let { try { nsd.stopServiceDiscovery(it) } catch (_: Exception) {} }
        }
    }

    private suspend fun runSession(socket: Socket, cipher: MacSyncCipher): Outcome = coroutineScope {
        val input = DataInputStream(BufferedInputStream(socket.getInputStream()))
        val output = DataOutputStream(BufferedOutputStream(socket.getOutputStream()))
        val channel = Channel<SyncMessage>(Channel.UNLIMITED)
        val parts = Channel<SyncMessage>(4)
        val host = "${socket.inetAddress.hostAddress}|${socket.port}"

        val writer = launch(Dispatchers.IO) {
            try {
                while (true) {
                    // list changes go before file parts: select prefers its first clause
                    val message = select<SyncMessage?> {
                        channel.onReceiveCatching { it.getOrNull() }
                        parts.onReceiveCatching { it.getOrNull() }
                    } ?: break
                    val sealed = cipher.seal(json.encodeToString(SyncMessage.serializer(), message).toByteArray())
                    output.writeInt(sealed.size)
                    output.write(sealed)
                    output.flush()
                }
            } catch (_: Exception) {
                try { socket.close() } catch (_: Exception) {}
            }
        }
        // our hello and our whole list go first; from then on every change follows on its own
        withContext(serial) {
            outgoing = channel
            bulk = parts
            sessionScope = this@coroutineScope
            channel.trySend(SyncMessage(type = "hello", device = deviceName(), v = MAC_SYNC_PROTOCOL_VERSION))
            channel.trySend(SyncMessage(type = "snapshot", items = known.values.toList(), gone = HashMap(gone)))
        }
        val pinger = launch(Dispatchers.IO) {
            while (isActive) {
                delay(15_000L)
                channel.trySend(SyncMessage(type = "ping"))
            }
        }

        var outcome = Outcome.CLOSED
        var trusted = false
        try {
            while (true) {
                val size = input.readInt()
                if (size <= 0 || size > MAX_FRAME) break
                val sealed = ByteArray(size)
                input.readFully(sealed)
                val plain = cipher.open(sealed)
                if (plain == null) {
                    if (!trusted) outcome = Outcome.WRONG_CODE
                    break
                }
                trusted = true
                val message = try {
                    json.decodeFromString(SyncMessage.serializer(), plain.decodeToString())
                } catch (_: Exception) {
                    continue
                }
                withContext(serial) {
                    handle(message) { device ->
                        _status.value = "Підключено до $device"
                        lastHost = host
                        scheduleSave()
                    }
                }
            }
        } catch (_: Exception) {
        } finally {
            withContext(kotlinx.coroutines.NonCancellable + serial) {
                if (outgoing === channel) outgoing = null
                if (bulk === parts) {
                    bulk = null
                    sessionScope = null
                }
                // files half-received start again on the next connection
                inbound.values.forEach { it.temp.delete() }
                inbound.clear()
                waiting.clear()
            }
            channel.close()
            parts.close()
            pinger.cancel()
            writer.cancel()
        }
        outcome
    }

    private fun deviceName(): String =
        Settings.Global.getString(app.contentResolver, Settings.Global.DEVICE_NAME)?.takeIf { it.isNotBlank() }
            ?: Build.MODEL
}
