package com.yuanhe.layoverjoy.data.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.LocalDate

/**
 * 智能出发日期（方案 §5）：四级优先级、提前天数 clamp、设备时钟异常兜底。
 * today 由构造注入，因此断言可精确到日。
 */
class SmartDepartureDateResolverTest {

    // 2026-08-30 是星期日，便于核对「同一星期 / 第一个周五」。
    private val today: LocalDate = LocalDate.of(2026, 8, 30)
    private fun resolver(day: LocalDate = today) = SmartDepartureDateResolver { day }

    @Test
    fun `priority 1 valid future date restores as is`() {
        val cached = today.plusDays(10)
        val decision = resolver().resolve(cached, preferredLeadDays = 14, preferredDepartureDayOfWeek = 3)
        assertEquals(cached, decision.date)
        assertEquals(DepartureDateSource.RESTORED_CACHED, decision.source)
        assertTrue(!decision.autoAdjusted)
    }

    @Test
    fun `priority 1 accepts tomorrow and one year out`() {
        assertEquals(DepartureDateSource.RESTORED_CACHED, resolver().resolve(today.plusDays(1), null, null).source)
        assertEquals(DepartureDateSource.RESTORED_CACHED, resolver().resolve(today.plusDays(365), null, null).source)
    }

    @Test
    fun `priority 2 expired date rolls by historical lead days to preferred weekday`() {
        // 缓存日期=昨天(周六)，习惯提前 14 天、偏好周三：today+14=周日 09-13 → 后移到周三 09-16。
        val decision = resolver().resolve(today.minusDays(1), preferredLeadDays = 14, preferredDepartureDayOfWeek = 3)
        assertEquals(LocalDate.of(2026, 9, 16), decision.date)
        assertEquals(DepartureDateSource.ROLLED_FROM_LEAD_DAYS, decision.source)
        assertEquals(DayOfWeek.WEDNESDAY, decision.date.dayOfWeek)
        assertTrue(decision.autoAdjusted)
    }

    @Test
    fun `priority 2 clamps lead days into seven to one hundred eighty`() {
        val tooBig = resolver().resolve(today.minusDays(1), preferredLeadDays = 400, preferredDepartureDayOfWeek = 5)
        assertTrue(tooBig.date in (today.plusDays(180)..today.plusDays(186)))
        assertEquals(DayOfWeek.FRIDAY, tooBig.date.dayOfWeek)

        // 3 天收敛到下限 7 天：today+7=09-06(周日) → 后移到周五 09-11。
        val tooSmall = resolver().resolve(today.minusDays(1), preferredLeadDays = 3, preferredDepartureDayOfWeek = 5)
        assertEquals(LocalDate.of(2026, 9, 11), tooSmall.date)
        assertEquals(DepartureDateSource.ROLLED_FROM_LEAD_DAYS, tooSmall.source)
    }

    @Test
    fun `priority 3 expired date without lead days keeps the cached weekday`() {
        // 缓存 2026-01-01 是周四；today+21 = 09-20(周日) → 后移到周四 09-24。
        val decision = resolver().resolve(LocalDate.of(2026, 1, 1), preferredLeadDays = null, preferredDepartureDayOfWeek = null)
        assertEquals(LocalDate.of(2026, 9, 24), decision.date)
        assertEquals(DepartureDateSource.ROLLED_SAME_WEEKDAY, decision.source)
    }

    @Test
    fun `priority 4 first open picks the first friday at least three weeks out`() {
        val decision = resolver().resolve(null, null, null)
        // 方案 §5.4 的示例日期：2026-09-25（today+21=09-20 周日 → 第一个周五）。
        assertEquals(LocalDate.of(2026, 9, 25), decision.date)
        assertEquals(DepartureDateSource.DEFAULT_FIRST_FRIDAY, decision.source)
    }

    @Test
    fun `today and beyond-one-year dates are both corrected`() {
        assertTrue(resolver().resolve(today, null, null).autoAdjusted)
        assertTrue(resolver().resolve(today.plusDays(366), null, null).autoAdjusted)
    }

    @Test
    fun `device clock before sanity baseline falls back to deterministic friday`() {
        // 用一台时钟停在 2023 年的设备：以 2024-01-01 为基线推第一个周五。
        val stuck = resolver(LocalDate.of(2023, 5, 1)).resolve(LocalDate.of(2023, 4, 1), null, null)
        assertEquals(LocalDate.of(2024, 1, 26), stuck.date)
        assertEquals(DepartureDateSource.DEFAULT_FIRST_FRIDAY, stuck.source)

        val decision = resolver().resolve(today.plusDays(10), null, null)
        assertEquals(DepartureDateSource.RESTORED_CACHED, decision.source)
    }

    @Test
    fun `resolveSafely swallows dirty cache text and never returns a past date`() {
        for (bad in listOf(null, "", "  ", "2026-13-45", "昨天", "0000-00-00")) {
            val decision = resolver().resolveSafely(bad, 14, 3)
            assertTrue("date must be future for input=$bad", decision.date.isAfter(today))
            assertTrue(decision.autoAdjusted)
        }
    }

    @Test
    fun `nextOnOrAfter keeps a matching weekday and rolls forward otherwise`() {
        assertEquals(today, SmartDepartureDateResolver.nextOnOrAfter(today, DayOfWeek.SUNDAY))
        assertEquals(today.plusDays(1), SmartDepartureDateResolver.nextOnOrAfter(today, DayOfWeek.MONDAY))
        assertEquals(today.plusDays(6), SmartDepartureDateResolver.nextOnOrAfter(today, DayOfWeek.SATURDAY))
    }

    @Test
    fun `dayOfWeekOf rejects out of range iso values`() {
        assertEquals(DayOfWeek.SUNDAY, SmartDepartureDateResolver.dayOfWeekOf(7))
        assertEquals(null, SmartDepartureDateResolver.dayOfWeekOf(0))
        assertEquals(null, SmartDepartureDateResolver.dayOfWeekOf(8))
    }
}
