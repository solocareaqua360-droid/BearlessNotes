/*
 * evaBoard: the clipboard link with the Mac - what travels over the wire.
 *
 * The Mac app (evaboard/mac) listens on the home Wi-Fi and announces itself over Bonjour as
 * `_evaboard._tcp`; the phone finds it and connects. Every frame is
 *
 *     4-byte big-endian length | 12-byte nonce | AES-256-GCM ciphertext + 16-byte tag
 *
 * and the plaintext is one JSON message. The key is SHA-256 of "evaboard-sync-v1:" + the pairing code
 * the Mac shows (letters and digits only, upper case), so a phone without the code can neither read
 * nor write: a frame that does not decrypt ends the connection.
 *
 * Both sides keep the same list and merge it the same way (MacSyncMerge): an item is identified by a
 * hash of its content, so the same text copied on both sides is one item; a deletion is kept as a
 * "gone" mark with its time, and beats every copy of that content made before it.
 */

package dev.patrickgold.florisboard.ime.eva.macsync

import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

const val MAC_SYNC_SERVICE_TYPE = "_evaboard._tcp."
const val MAC_SYNC_PROTOCOL_VERSION = 1

/** One clipboard entry as both sides know it. [mod] orders changes that keep [ts] (pinning). */
@Serializable
data class SyncItem(
    val id: String,
    val kind: String = "text",
    val text: String,
    val ts: Long,
    val pinned: Boolean = false,
    val mod: Long = ts,
)

@Serializable
data class SyncMessage(
    @SerialName("t") val type: String,
    val device: String? = null,
    val v: Int? = null,
    val items: List<SyncItem>? = null,
    val item: SyncItem? = null,
    val fresh: Boolean? = null,
    val gone: Map<String, Long>? = null,
)

object MacSyncIds {
    /** The same text gives the same id on the phone and on the Mac. */
    fun forText(text: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
        return "t" + digest.joinToString("") { "%02x".format(it) }.take(32)
    }
}

class MacSyncCipher(code: String) {
    private val key = SecretKeySpec(
        MessageDigest.getInstance("SHA-256").digest(("evaboard-sync-v1:" + normalize(code)).toByteArray()),
        "AES",
    )
    private val random = SecureRandom()

    fun seal(plain: ByteArray): ByteArray {
        val nonce = ByteArray(12).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, nonce))
        return nonce + cipher.doFinal(plain)
    }

    /** Null when the frame was not sealed with this code. */
    fun open(sealed: ByteArray): ByteArray? {
        if (sealed.size < 12 + 16) return null
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed, 0, 12))
            cipher.doFinal(sealed, 12, sealed.size - 12)
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        fun normalize(code: String) = code.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' }
    }
}

/** The merge rules, the same as on the Mac (evaboard/mac/Sources/Store.swift). */
object MacSyncMerge {
    /** What [incoming] does to the list: null = nothing; otherwise the item to keep. */
    fun upsert(local: SyncItem?, goneAt: Long?, incoming: SyncItem): SyncItem? {
        if (goneAt != null && goneAt >= incoming.ts) return null
        if (local == null) return incoming
        if (incoming.ts > local.ts) return incoming
        if (incoming.ts == local.ts && incoming.mod > local.mod) return incoming
        return null
    }

    /** True when a deletion made at [at] removes [local]. */
    fun removes(local: SyncItem, at: Long) = local.ts <= at
}
