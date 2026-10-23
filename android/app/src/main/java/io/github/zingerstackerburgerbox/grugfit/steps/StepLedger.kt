package io.github.zingerstackerburgerbox.grugfit.steps

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Turns readings of Android's cumulative hardware step counter (TYPE_STEP_COUNTER: steps since boot) into
 * per-day totals. Pure (no Android APIs) so it is unit-tested on the JVM.
 *
 *  - Each reading is compared with the previous one; the difference is the steps taken in between.
 *  - The counter restarts at 0 on reboot: detected by a new boot count or a counter that went down. Then the
 *    steps since boot (= the new reading) count from the boot time; steps between the last reading and the
 *    reboot are lost (keep readings frequent – app open, 15-min job, optional always-on counting).
 *  - A gap spanning midnight is split across the days in proportion to time (an estimate; frequent readings keep
 *    gaps short), and recorded as segments so steps inside a time window (e.g. a cardio workout) can be found.
 *  - The very first reading only sets the baseline (we can't know which day older steps belong to).
 */
class StepLedger(
  var lastCounter: Long = -1, var lastBoot: Int = -1, var lastT: Long = 0,
  val days: MutableMap<String, Long> = sortedMapOf(), val segs: MutableList<Seg> = mutableListOf(),
  var readings: Int = 0, var bgReadings: Int = 0, var lastBgT: Long = 0, var lostReboots: Int = 0,
) {
  data class Seg(val t0: Long, val t1: Long, val steps: Long)

  /** @param bootTimeMs wall-clock time of the last boot (now − elapsedRealtime) */
  fun record(counter: Long, bootCount: Int, now: Long, bootTimeMs: Long, zone: ZoneId, background: Boolean = false): Long {
    if (counter < 0) return 0
    readings++; if (background) { bgReadings++; lastBgT = now }
    if (lastCounter < 0) { lastCounter = counter; lastBoot = bootCount; lastT = now; return 0 }
    val rebooted = (bootCount >= 0 && lastBoot >= 0 && bootCount != lastBoot) || counter < lastCounter
    val delta: Long; val from: Long
    if (rebooted) { delta = counter; from = maxOf(lastT, minOf(bootTimeMs, now)); lostReboots++ } else { delta = counter - lastCounter; from = lastT }
    lastCounter = counter; lastBoot = bootCount
    val t0 = minOf(from, now); lastT = now
    // sensor glitch guard: > 15 steps/s sustained is not walking
    val span = maxOf(1L, now - t0)
    if (delta <= 0 || delta > MAX_PER_SEC * maxOf(span / 1000, 60)) return 0
    split(t0, now, delta, zone)
    trim(now); return delta
  }

  private fun split(t0: Long, t1: Long, steps: Long, zone: ZoneId) {
    var a = t0; var left = steps
    while (left > 0) {
      val day = Instant.ofEpochMilli(a).atZone(zone).toLocalDate()
      val dayEnd = day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
      val b = minOf(dayEnd, t1)
      val part = if (b >= t1) left else Math.round(steps.toDouble() * (b - a) / maxOf(1L, t1 - t0))
      if (part > 0) { days[day.toString()] = (days[day.toString()] ?: 0) + part; segs.add(Seg(a, maxOf(b, a + 1), part)) }
      left -= part; if (b >= t1) break; a = b
    }
  }

  private fun trim(now: Long) {
    segs.removeAll { it.t1 < now - SEG_KEEP_MS }
    while (days.size > DAY_KEEP) days.remove((days as java.util.SortedMap).firstKey())
  }

  /** steps recorded so far for a local date (does not include steps since the last reading) */
  fun stepsOn(date: LocalDate) = days[date.toString()] ?: 0

  fun toJson(): JSONObject = JSONObject().put("lastCounter", lastCounter).put("lastBoot", lastBoot).put("lastT", lastT)
    .put("readings", readings).put("bgReadings", bgReadings).put("lastBgT", lastBgT).put("lostReboots", lostReboots)
    .put("days", JSONObject(days as Map<*, *>))
    .put("segs", JSONArray().apply { segs.forEach { put(JSONArray().put(it.t0).put(it.t1).put(it.steps)) } })

  companion object {
    const val MAX_PER_SEC = 15L
    const val SEG_KEEP_MS = 10L * 864e5.toLong()
    const val DAY_KEEP = 400
    fun fromJson(s: String?): StepLedger {
      if (s.isNullOrBlank()) return StepLedger()
      return try {
        val o = JSONObject(s); val l = StepLedger(o.optLong("lastCounter", -1), o.optInt("lastBoot", -1), o.optLong("lastT", 0),
          readings = o.optInt("readings"), bgReadings = o.optInt("bgReadings"), lastBgT = o.optLong("lastBgT"), lostReboots = o.optInt("lostReboots"))
        o.optJSONObject("days")?.let { d -> d.keys().forEach { k -> l.days[k] = d.getLong(k) } }
        o.optJSONArray("segs")?.let { a -> for (i in 0 until a.length()) { val x = a.getJSONArray(i); l.segs.add(Seg(x.getLong(0), x.getLong(1), x.getLong(2))) } }
        l
      } catch (e: Exception) { StepLedger() }
    }
  }
}
