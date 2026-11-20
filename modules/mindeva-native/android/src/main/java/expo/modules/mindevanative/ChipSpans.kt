package expo.modules.mindevanative

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.text.Editable
import android.text.Spannable
import android.text.Spanned
import android.text.TextWatcher
import android.text.style.BackgroundColorSpan
import android.text.style.LineBackgroundSpan
import android.widget.EditText
import android.widget.TextView
import java.lang.ref.WeakReference
import java.util.WeakHashMap

// A NOTE LINK WHILE TYPING, ROUNDED (the user's pick, 2026-10-18: «варіант
// 3»). At rest a link is a chip - a small rounded view in the line. In the
// field where one types, it is a run of the field's own text, and Android
// draws a run's background as a plain rectangle hugging the letters: square
// corners, no room at the sides. Nothing on the JS side can change that.
//
// So the JS side marks a link's run with a background of one agreed alpha
// (`markAlpha`, a value no colour the user picks will have) - the mark lives
// in the text itself, so it moves with every edit - and this file, for the
// field JS names (`attach`), swaps such a run's rectangle for a rounded one
// drawn a little wider than the letters. The room at the sides
// is made on the JS side, with letter spacing on the neighbouring
// characters - real text metrics, so the field still measures the same as
// what it draws. Every number comes from JS (`configure`), so the look is
// tuned by an over-the-air update, not by another build.
object ChipSpans {
  @Volatile var markAlpha = 0x0B
  @Volatile var fillAlpha = 0x24
  @Volatile var radius = 7f
  @Volatile var padX = 5f
  @Volatile var padTop = 0f
  @Volatile var padBottom = 0f

  private val watchedFields = WeakHashMap<EditText, Boolean>()

  // The look, from JS (dp values).
  fun configure(density: Float, fill: Int, mark: Int, r: Float, px: Float, pt: Float, pb: Float) {
    fillAlpha = fill.coerceIn(0, 255)
    markAlpha = mark.coerceIn(1, 255)
    radius = r * density
    padX = px * density
    padTop = pt * density
    padBottom = pb * density
  }

  // ONE FIELD, NAMED BY JS (by its view tag, once per field): its marked
  // runs are drawn rounded now, and from then on whenever its text changes.
  // A TextWatcher hears both what the keyboard types and what RN sets from
  // JS state (ReactEditText passes state updates to its watchers), and it
  // runs inside RN's own setText, before the field draws - no timing, no
  // window-wide listener. UI thread only.
  fun attach(field: EditText) {
    if (!watchedFields.containsKey(field)) {
      watchedFields[field] = true
      field.addTextChangedListener(object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        override fun afterTextChanged(s: Editable?) {
          s?.let { convert(field, it) }
        }
      })
    }
    val text = field.text ?: return
    // Old rounded runs carry old numbers - take them off and make them anew.
    text.getSpans(0, text.length, RoundedRun::class.java).forEach { text.removeSpan(it) }
    convert(field, text)
    field.invalidate()
  }

  private fun convert(field: TextView, text: Spannable) {
    val marked = text.getSpans(0, text.length, BackgroundColorSpan::class.java)
      .filter { (it.backgroundColor ushr 24) == markAlpha }
    if (marked.isEmpty()) return
    val ref = WeakReference(field)
    for (span in marked) {
      val start = text.getSpanStart(span)
      val end = text.getSpanEnd(span)
      text.removeSpan(span)
      if (start < 0 || end <= start) continue
      text.getSpans(start, end, RoundedRun::class.java)
        .filter { text.getSpanStart(it) == start && text.getSpanEnd(it) == end }
        .forEach { text.removeSpan(it) }
      val fill = (span.backgroundColor and 0x00FFFFFF) or (fillAlpha shl 24)
      text.setSpan(RoundedRun(ref, fill), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
  }

  // One rounded rectangle per line the run covers, behind the letters (a
  // line's background is drawn before any text and before the selection).
  class RoundedRun(private val field: WeakReference<TextView>, private val fill: Int) : LineBackgroundSpan {
    private val rect = RectF()
    private val brush = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

    override fun drawBackground(
      canvas: Canvas,
      paint: Paint,
      left: Int,
      right: Int,
      top: Int,
      baseline: Int,
      bottom: Int,
      text: CharSequence,
      start: Int,
      end: Int,
      lineNumber: Int
    ) {
      val layout = field.get()?.layout ?: return
      val spanned = text as? Spanned ?: return
      val runStart = spanned.getSpanStart(this)
      val runEnd = spanned.getSpanEnd(this)
      if (runStart < 0) return
      val from = maxOf(runStart, start)
      val to = minOf(runEnd, end)
      if (to <= from) return
      // A link may end a line: its right edge is then the line's own end
      // (the next line's first x is no use).
      val x1 = layout.getPrimaryHorizontal(from)
      val x2 = if (to >= layout.getLineEnd(lineNumber)) layout.getLineRight(lineNumber) else layout.getPrimaryHorizontal(to)
      val metrics = paint.fontMetrics
      // Never past the line's own edges: a link at the start of a line
      // would be cut there, its rounded corner with it (the JS side moves
      // the letters in by padX in that case, so the chip still has room).
      rect.set(
        maxOf(minOf(x1, x2) - padX, left.toFloat()),
        baseline + metrics.ascent - padTop,
        minOf(maxOf(x1, x2) + padX, right.toFloat()),
        baseline + metrics.descent + padBottom
      )
      brush.color = fill
      canvas.drawRoundRect(rect, radius, radius, brush)
    }
  }
}
