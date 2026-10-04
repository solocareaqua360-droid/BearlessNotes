/*
 * evaBoard: link previews on clipboard cards. A copied link that is the whole clip gets the page's
 * picture and title instead of a bare address: YouTube from its thumbnail, TikTok from its public
 * oEmbed, any other site from the picture it names for sharing (the og:image tag). Where there is
 * nothing to show, the card shows the link shortened.
 *
 * This is the one place the keyboard goes onto the network: it opens the links the user copied,
 * so those sites learn of them. Hence it is off until the user switches it on
 * (keyboard__eva_link_previews), and everything it fetches is kept in the cache folder.
 */

package dev.patrickgold.florisboard.ime.clipboard

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.florisboard.lib.snygg.ui.SnyggText
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest

class LinkPreview(val title: String?, val image: ImageBitmap?, val host: String)

object EvaLinkPreviews {
    private const val USER_AGENT = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 evaBoard"
    private const val TIMEOUT_MS = 6_000
    private const val MAX_PAGE_BYTES = 400_000
    private const val MAX_IMAGE_BYTES = 3_000_000
    private const val IMAGE_SIDE = 480
    /** A link that gave nothing is not asked again for this long. */
    private const val RETRY_AFTER_MS = 60 * 60 * 1000L

    private val memory = HashMap<String, LinkPreview?>()

    /** [text] if the whole clip is one http(s) address, else null. */
    fun singleUrl(text: String?): String? {
        val t = text?.trim() ?: return null
        if (t.length > 2000 || t.any { it.isWhitespace() }) return null
        if (!t.startsWith("http://", true) && !t.startsWith("https://", true)) return null
        return t
    }

    /** The link without scheme and "www.", for a card with nothing better to show. */
    fun shortLink(url: String): String =
        url.replace(Regex("^https?://(www\\.)?", RegexOption.IGNORE_CASE), "").trimEnd('/')

    suspend fun load(context: Context, url: String): LinkPreview? = withContext(Dispatchers.IO) {
        synchronized(memory) { if (memory.containsKey(url)) return@withContext memory[url] }
        val dir = File(context.cacheDir, "eva-link-previews").apply { mkdirs() }
        val key = sha1(url)
        val jpg = File(dir, "$key.jpg")
        val txt = File(dir, "$key.txt")
        val none = File(dir, "$key.none")
        val host = runCatching { URI(url).host?.removePrefix("www.") }.getOrNull() ?: shortLink(url)

        val cached: LinkPreview? = when {
            jpg.exists() || txt.exists() -> LinkPreview(
                title = txt.takeIf { it.exists() }?.readText()?.ifBlank { null },
                image = jpg.takeIf { it.exists() }?.let { BitmapFactory.decodeFile(it.path)?.asImageBitmap() },
                host = host,
            )
            none.exists() && System.currentTimeMillis() - none.lastModified() < RETRY_AFTER_MS -> null
            else -> {
                val fetched = runCatching { fetch(url, host) }.getOrNull()
                if (fetched == null || (fetched.title == null && fetched.image == null)) {
                    none.writeText("-")
                    null
                } else {
                    fetched.title?.let { txt.writeText(it) }
                    fetched.image?.let { img ->
                        jpg.outputStream().use { out -> img.asAndroidBitmap().compress(Bitmap.CompressFormat.JPEG, 85, out) }
                    }
                    fetched
                }
            }
        }
        synchronized(memory) { memory[url] = cached }
        cached
    }

    private fun fetch(url: String, host: String): LinkPreview? {
        val youtubeId = Regex("""(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/)|youtu\.be/)([\w-]{11})""")
            .find(url)?.groupValues?.get(1)
        val secure = url.replaceFirst(Regex("^http://", RegexOption.IGNORE_CASE), "https://")
        return when {
            youtubeId != null -> {
                val title = runCatching {
                    JSONObject(getText("https://www.youtube.com/oembed?format=json&url=" + URLEncoder.encode(secure, "UTF-8")))
                        .optString("title").ifBlank { null }
                }.getOrNull()
                val image = getImage("https://img.youtube.com/vi/$youtubeId/hqdefault.jpg")
                LinkPreview(title, image, host)
            }
            host.endsWith("tiktok.com") -> {
                val json = JSONObject(getText("https://www.tiktok.com/oembed?url=" + URLEncoder.encode(secure, "UTF-8")))
                LinkPreview(
                    title = json.optString("title").ifBlank { null },
                    image = json.optString("thumbnail_url").ifBlank { null }?.let { getImage(it) },
                    host = host,
                )
            }
            else -> {
                val html = getText(secure, MAX_PAGE_BYTES)
                val title = meta(html, "og:title") ?: meta(html, "twitter:title")
                    ?: Regex("<title[^>]*>([^<]*)</title>", RegexOption.IGNORE_CASE).find(html)?.groupValues?.get(1)
                        ?.let { unescape(it).trim() }?.ifBlank { null }
                val imageUrl = (meta(html, "og:image") ?: meta(html, "twitter:image"))
                    ?.let { runCatching { URL(URL(secure), it).toString() }.getOrNull() }
                LinkPreview(title, imageUrl?.let { getImage(it) }, host)
            }
        }
    }

    private fun open(url: String): HttpURLConnection {
        val u = URL(url)
        require(u.protocol == "https" || u.protocol == "http") { "not a web address" }
        return (u.openConnection() as HttpURLConnection).apply {
            connectTimeout = TIMEOUT_MS
            readTimeout = TIMEOUT_MS
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", USER_AGENT)
            setRequestProperty("Accept-Language", "uk,en;q=0.8")
        }
    }

    private fun readLimited(input: InputStream, limit: Int): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (out.size() < limit) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    private fun getText(url: String, limit: Int = 200_000): String {
        val conn = open(url)
        return try {
            check(conn.responseCode in 200..299) { "HTTP ${conn.responseCode}" }
            String(readLimited(conn.inputStream, limit), Charsets.UTF_8)
        } finally {
            conn.disconnect()
        }
    }

    private fun getImage(url: String): ImageBitmap? {
        val conn = open(url)
        return try {
            if (conn.responseCode !in 200..299) return null
            val bytes = readLimited(conn.inputStream, MAX_IMAGE_BYTES)
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= IMAGE_SIDE) sample *= 2
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
                ?.asImageBitmap()
        } finally {
            conn.disconnect()
        }
    }

    /** The content of the <meta property|name="[name]"> tag, whichever order its attributes come in. */
    private fun meta(html: String, name: String): String? {
        for (tag in Regex("<meta\\s[^>]*>", RegexOption.IGNORE_CASE).findAll(html)) {
            val attrs = Regex("""([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')""").findAll(tag.value)
                .associate { it.groupValues[1].lowercase() to (it.groupValues[2].ifEmpty { it.groupValues[3] }) }
            if (attrs["property"].equals(name, true) || attrs["name"].equals(name, true)) {
                return attrs["content"]?.let { unescape(it).trim() }?.ifBlank { null }
            }
        }
        return null
    }

    private fun unescape(s: String) = s.replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'")
        .replace("&apos;", "'").replace("&lt;", "<").replace("&gt;", ">")

    private fun sha1(s: String) =
        MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
}

/** A card for a copied link: the page's picture with its title over the bottom, or the title, or the short link. */
@Composable
fun LinkPreviewCard(url: String) {
    val context = LocalContext.current
    val preview by produceState<LinkPreview?>(null, url) { value = EvaLinkPreviews.load(context, url) }
    val shown = preview
    val short = EvaLinkPreviews.shortLink(url)
    when {
        shown?.image != null -> Box(Modifier.fillMaxSize().clipToBounds()) {
            Image(
                modifier = Modifier.fillMaxSize(),
                bitmap = shown.image,
                contentDescription = null,
                contentScale = ContentScale.Crop,
            )
            Box(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.72f))))
                    .padding(start = 10.dp, end = 10.dp, top = 22.dp, bottom = 8.dp),
            ) {
                Text(
                    text = shown.title ?: shown.host,
                    color = Color.White,
                    fontSize = 14.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        shown?.title != null -> Column {
            SnyggText(modifier = Modifier.fillMaxWidth(), text = shown.title)
            SnyggText(modifier = Modifier.fillMaxWidth(), text = shown.host)
        }
        else -> SnyggText(modifier = Modifier.fillMaxWidth(), text = short)
    }
}
