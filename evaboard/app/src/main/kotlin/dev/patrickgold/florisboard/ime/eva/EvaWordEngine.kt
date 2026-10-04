/*
 * evaBoard: the word-suggestion engine.
 *
 * Completes the word being typed from a frequency dictionary (assets/ime/eva-dict, one list per
 * language - see tools/build-dictionaries.py) and from the words the user has typed before.
 * Everything learned stays on the phone, in the app's own files; nothing is sent anywhere.
 *
 * Stage 1: completion and learning words. Pairs of neighbouring words are recorded already
 * (for the next-word prediction that comes in stage 2) but not yet used.
 *
 * The dictionary data derives from FrequencyWords by Hermit Dave (CC-BY-SA-4.0), see
 * assets/ime/eva-dict/LICENSE.txt.
 */

package dev.patrickgold.florisboard.ime.eva

import android.content.Context
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.ln
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class EvaWordEngine(private val context: Context) {
    /** One language: the dictionary sorted for prefix search, plus what the user taught the keyboard. */
    private class Lang(val code: String) {
        var words: Array<String> = emptyArray()
        var counts: IntArray = IntArray(0)
        var maxLog = 1.0
        val learned = ConcurrentHashMap<String, Int>()
        val pairs = ConcurrentHashMap<String, Int>()

        // the text before the cursor at the last call, to notice that a separator was just typed
        var lastBefore = ""
        var dirty = false
    }

    private val langs = HashMap<String, Lang>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val saveJobs = HashMap<String, Job>()

    private fun lang(code: String): Lang? {
        if (code != "uk" && code != "en" && code != "ru") return null
        synchronized(langs) {
            langs[code]?.let { return it }
            val lang = Lang(code)
            load(lang)
            langs[code] = lang
            return lang
        }
    }

    private fun load(lang: Lang) {
        val entries = ArrayList<Pair<String, Int>>(40000)
        try {
            context.assets.open("ime/eva-dict/${lang.code}.txt").bufferedReader().useLines { lines ->
                for (line in lines) {
                    val tab = line.indexOf('\t')
                    if (tab <= 0) continue
                    val count = line.substring(tab + 1).toIntOrNull() ?: continue
                    entries.add(line.substring(0, tab) to count)
                }
            }
        } catch (_: Exception) {
        }
        entries.sortBy { it.first }
        lang.words = Array(entries.size) { entries[it].first }
        lang.counts = IntArray(entries.size) { entries[it].second }
        lang.maxLog = ln(1.0 + (lang.counts.maxOrNull() ?: 1))
        readCounts(File(context.filesDir, "eva-words-${lang.code}.txt"), lang.learned)
        readCounts(File(context.filesDir, "eva-pairs-${lang.code}.txt"), lang.pairs)
    }

    private fun readCounts(file: File, into: MutableMap<String, Int>) {
        if (!file.exists()) return
        try {
            file.forEachLine { line ->
                val tab = line.lastIndexOf('\t')
                if (tab > 0) line.substring(tab + 1).toIntOrNull()?.let { into[line.substring(0, tab)] = it }
            }
        } catch (_: Exception) {
        }
    }

    /** Warms the language up on a background thread so the first keystroke does not wait for the file. */
    fun preload(code: String) {
        scope.launch { lang(code) }
    }

    /**
     * Completions for [composing], best first. [before] is the text before the cursor (used only to
     * learn); [private] switches learning off.
     */
    fun suggest(code: String, composing: String, before: String, private: Boolean, max: Int): List<String> {
        val lang = lang(code) ?: return emptyList()
        if (!private) learnFrom(lang, before)
        if (composing.isEmpty() || !composing.any { it.isLetter() }) return emptyList()

        val prefix = normalize(composing)
        val scored = ArrayList<Pair<Double, String>>()
        val seen = HashSet<String>()

        var i = lowerBound(lang.words, prefix)
        while (i < lang.words.size && lang.words[i].startsWith(prefix)) {
            val word = lang.words[i]
            if (word != prefix) {
                val taught = lang.learned[word] ?: 0
                scored.add(score(lang, ln(1.0 + lang.counts[i]) / lang.maxLog, taught) to word)
                seen.add(word)
            }
            i++
        }
        for ((word, taught) in lang.learned) {
            if (word != prefix && word.startsWith(prefix) && word !in seen) {
                scored.add(score(lang, 0.0, taught) to word)
            }
        }
        scored.sortByDescending { it.first }
        return scored.asSequence().take(max).map { shapeLike(composing, it.second, lang.code) }.toList()
    }

    /** A word the user accepted from the row: counts as typed, with a little extra weight. */
    fun accepted(code: String, word: String, private: Boolean) {
        if (private) return
        val lang = lang(code) ?: return
        learnWord(lang, normalize(word), 2)
    }

    /** The user dismissed a suggestion for good (long press): forget it. */
    fun forget(code: String, word: String): Boolean {
        val lang = lang(code) ?: return false
        val key = normalize(word)
        val removed = lang.learned.remove(key) != null
        if (removed) markDirty(lang)
        return removed
    }

    // A separator typed right after a word means the word is finished: learn it, and the pair it makes
    // with the word before it. The previous text must be this text minus the separator, so moving the
    // cursor around old text teaches nothing.
    private fun learnFrom(lang: Lang, before: String) {
        val previous = lang.lastBefore
        lang.lastBefore = before
        if (before.length != previous.length + 1 || !before.startsWith(previous)) return
        if (before.last().isLetterOrDigit() || before.last() == '\'' || before.last() == 'ʼ') return
        val words = lastWords(previous, 2)
        val word = words.lastOrNull() ?: return
        if (previous.length > 0 && !previous.last().isLetter() && previous.last() != '\'' && previous.last() != 'ʼ') return
        if (word.length < 2 || word.any { it.isDigit() }) return
        learnWord(lang, word, 1)
        if (words.size == 2) {
            val key = words[0] + " " + words[1]
            lang.pairs[key] = (lang.pairs[key] ?: 0) + 1
            markDirty(lang)
        }
    }

    private fun lastWords(text: String, n: Int): List<String> {
        val out = ArrayList<String>()
        var end = text.length
        while (out.size < n && end > 0) {
            while (end > 0 && !isWordChar(text[end - 1])) {
                // only a sentence's own gap may separate the pair; a newline or a full stop breaks it
                if (out.isNotEmpty() && text[end - 1] in ".!?\n") return out.reversed()
                end--
            }
            var start = end
            while (start > 0 && isWordChar(text[start - 1])) start--
            if (start == end) break
            out.add(normalize(text.substring(start, end)))
            end = start
        }
        return out.reversed()
    }

    private fun isWordChar(c: Char) = c.isLetter() || c == '\'' || c == 'ʼ' || c == '’' || c == '-'

    private fun learnWord(lang: Lang, word: String, by: Int) {
        if (word.length < 2) return
        lang.learned[word] = (lang.learned[word] ?: 0) + by
        markDirty(lang)
    }

    private fun score(lang: Lang, frequency: Double, taught: Int) = frequency + minOf(taught, 12) * 0.12

    private fun normalize(text: String) = text.lowercase().replace('\'', 'ʼ').replace('’', 'ʼ')

    /** Gives the suggestion the capitals of what was typed: Ab… → Abc, AB… → ABC. */
    private fun shapeLike(typed: String, word: String, code: String): String {
        var out = if (code == "en") word.replace('ʼ', '\'') else word
        if (typed.length > 1 && typed.all { !it.isLetter() || it.isUpperCase() }) return out.uppercase()
        if (typed.first().isUpperCase()) out = out.replaceFirstChar { it.uppercase() }
        return out
    }

    private fun lowerBound(words: Array<String>, prefix: String): Int {
        var lo = 0
        var hi = words.size
        while (lo < hi) {
            val mid = (lo + hi) ushr 1
            if (words[mid] < prefix) lo = mid + 1 else hi = mid
        }
        return lo
    }

    private fun markDirty(lang: Lang) {
        lang.dirty = true
        synchronized(saveJobs) {
            saveJobs[lang.code]?.cancel()
            saveJobs[lang.code] = scope.launch {
                delay(3000)
                save(lang)
            }
        }
    }

    private fun save(lang: Lang) {
        if (!lang.dirty) return
        lang.dirty = false
        // keep the files from growing without end: the most used pairs and words stay
        val words = lang.learned.entries.sortedByDescending { it.value }.take(20000)
        val pairs = lang.pairs.entries.sortedByDescending { it.value }.take(60000)
        writeCounts(File(context.filesDir, "eva-words-${lang.code}.txt"), words.map { it.key to it.value })
        writeCounts(File(context.filesDir, "eva-pairs-${lang.code}.txt"), pairs.map { it.key to it.value })
    }

    private fun writeCounts(file: File, rows: List<Pair<String, Int>>) {
        try {
            val temp = File(file.path + ".tmp")
            temp.bufferedWriter().use { out -> rows.forEach { out.write("${it.first}\t${it.second}\n") } }
            temp.renameTo(file)
        } catch (_: Exception) {
        }
    }
}
