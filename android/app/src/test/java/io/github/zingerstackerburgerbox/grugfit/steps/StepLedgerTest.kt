package io.github.zingerstackerburgerbox.grugfit.steps

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

class StepLedgerTest {
  private val z = ZoneId.of("Australia/Sydney")
  private fun t(d: Int, h: Int, m: Int = 0) = ZonedDateTime.of(2026, 10, d, h, m, 0, 0, z).toInstant().toEpochMilli()
  private val boot = t(1, 0)

  @Test fun firstReadingIsBaselineOnly() {
    val l = StepLedger(); assertEquals(0, l.record(52_000, 3, t(23, 8), boot, z)); assertEquals(0, l.stepsOn(LocalDate.of(2026, 10, 23)))
  }
  @Test fun accumulatesDifferences() {
    val l = StepLedger(); l.record(1000, 3, t(23, 8), boot, z); l.record(1800, 3, t(23, 9), boot, z); l.record(4300, 3, t(23, 12), boot, z)
    assertEquals(3300, l.stepsOn(LocalDate.of(2026, 10, 23))); assertEquals(2, l.segs.size)
  }
  @Test fun splitsAGapOverMidnightByTime() {
    val l = StepLedger(); l.record(1000, 3, t(23, 22), boot, z); l.record(1400, 3, t(24, 2), boot, z) // 2 h before, 2 h after midnight
    assertEquals(200, l.stepsOn(LocalDate.of(2026, 10, 23))); assertEquals(200, l.stepsOn(LocalDate.of(2026, 10, 24)))
  }
  @Test fun rebootRestartsFromZero() {
    val l = StepLedger(); l.record(9000, 3, t(23, 8), boot, z); l.record(9500, 3, t(23, 9), boot, z)
    val reboot = t(23, 10); l.record(700, 4, t(23, 11), reboot, z) // 700 steps since the reboot at 10:00
    assertEquals(1200, l.stepsOn(LocalDate.of(2026, 10, 23))); assertEquals(1, l.lostReboots)
    l.record(1000, 4, t(23, 12), reboot, z); assertEquals(1500, l.stepsOn(LocalDate.of(2026, 10, 23)))
  }
  @Test fun counterDroppingWithoutBootCountIsAReboot() {
    val l = StepLedger(); l.record(9000, -1, t(23, 8), boot, z); l.record(300, -1, t(23, 9), t(23, 8, 30), z)
    assertEquals(300, l.stepsOn(LocalDate.of(2026, 10, 23)))
  }
  @Test fun ignoresImpossibleJumps() {
    val l = StepLedger(); l.record(0, 3, t(23, 8), boot, z); l.record(5_000_000, 3, t(23, 8, 5), boot, z)
    assertEquals(0, l.stepsOn(LocalDate.of(2026, 10, 23)))
  }
  @Test fun survivesJsonRoundTrip() {
    val l = StepLedger(); l.record(1000, 3, t(23, 22), boot, z); l.record(1400, 3, t(24, 2), boot, z, background = true)
    val r = StepLedger.fromJson(l.toJson().toString())
    assertEquals(l.days, r.days); assertEquals(l.segs, r.segs); assertEquals(1400, r.lastCounter); assertEquals(1, r.bgReadings)
    r.record(1500, 3, t(24, 3), boot, z); assertEquals(300, r.stepsOn(LocalDate.of(2026, 10, 24)))
  }
  @Test fun dstChangeDayStillSplitsCorrectly() { // Sydney DST starts 4 Oct 2026 02:00 → 03:00
    val l = StepLedger(); val a = ZonedDateTime.of(2026, 10, 3, 23, 0, 0, 0, z).toInstant().toEpochMilli(); val b = ZonedDateTime.of(2026, 10, 4, 1, 0, 0, 0, z).toInstant().toEpochMilli()
    l.record(0, 3, a, boot, z); l.record(200, 3, b, boot, z)
    assertEquals(100, l.stepsOn(LocalDate.of(2026, 10, 3))); assertEquals(100, l.stepsOn(LocalDate.of(2026, 10, 4)))
  }
}
