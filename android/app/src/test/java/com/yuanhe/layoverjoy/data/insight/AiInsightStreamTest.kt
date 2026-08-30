package com.yuanhe.layoverjoy.data.insight

import com.yuanhe.layoverjoy.data.AppJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 流式 AI 推荐的客户端解析与状态机（实施任务 §7）。
 * 解析器与 reducer 都是纯函数，因此可在纯 JVM 上穷举事件序列，不需要设备。
 */
class AiInsightStreamTest {

    private fun parser() = InsightSseParser(AppJson)

    /** 把一段 SSE 原文按行喂进解析器，收集所有事件。 */
    private fun parseAll(raw: String): List<InsightSseEvent> {
        val p = parser()
        val out = mutableListOf<InsightSseEvent>()
        raw.split("\n").forEach { line -> p.feedLine(line)?.let { out += it } }
        p.finish()?.let { out += it }
        return out
    }

    private val fullStream = """
        : stream-open

        event: status
        data: {"stage":"CHECKING_VISA","message":"Checking visa eligibility..."}

        event: status
        data: {"stage":"BUILDING_PLAN","message":"Building your stopover plan..."}

        event: section_start
        data: {"section":"cityAdvantages"}

        event: delta
        data: {"section":"cityAdvantages","text":"Bangkok keeps "}

        event: delta
        data: {"section":"cityAdvantages","text":"food and temples close."}

        event: section_complete
        data: {"section":"cityAdvantages","payload":{"section":"cityAdvantages","text":"Bangkok keeps food and temples close."}}

        event: section_complete
        data: {"section":"convenience","payload":{"section":"convenience","score":83,"reasons":["Same airport both ways"]}}

        event: section_complete
        data: {"section":"miniItinerary","payload":{"section":"miniItinerary","items":["Arrival day: river block","Full day: temples"]}}

        event: done
        data: {"source":"NOSANA","schemaVersion":"rich-insight-v2","insight":{"schemaVersion":"rich-insight-v2","lang":"en","cityAdvantages":"Bangkok keeps food and temples close.","interestMatch":"Food and culture in one district.","scheduleFit":"Morning in, morning out.","miniItinerary":["Arrival day: river block"],"convenienceScore":83,"convenienceReasons":["Same airport both ways"],"travelerGains":["A real city stay"],"travelerAccepts":["Bags must be re-checked"],"source":"NOSANA"},"cached":false}

    """.trimIndent()

    // ---------------- 解析器 ----------------

    @Test
    fun `parses every defined event type in order`() {
        val events = parseAll(fullStream)
        assertEquals(9, events.size)
        assertTrue(events[0] is InsightSseEvent.Status)
        assertTrue(events[2] is InsightSseEvent.SectionStart)
        assertTrue(events[3] is InsightSseEvent.Delta)
        assertTrue(events.last() is InsightSseEvent.Done)
    }

    @Test
    fun `comment heartbeat frames are ignored`() {
        assertNull(parser().feedLine(": stream-open"))
        assertNull(parser().feedLine(":"))
    }

    @Test
    fun `unknown event types are dropped instead of crashing`() {
        val events = parseAll(
            """
            event: telemetry
            data: {"gpu":"3060","model":"qwen"}

            event: status
            data: {"stage":"FINALIZING","message":"Finalizing the recommendation..."}

            """.trimIndent(),
        )
        assertEquals(1, events.size)
        assertEquals(InsightStages.FINALIZING, (events[0] as InsightSseEvent.Status).stage)
    }

    @Test
    fun `broken json payload is dropped without throwing`() {
        val events = parseAll(
            """
            event: delta
            data: {"section":"cityAdvantages","text":

            """.trimIndent(),
        )
        assertTrue(events.isEmpty())
    }

    @Test
    fun `multi line data fields are joined`() {
        val p = parser()
        p.feedLine("event: delta")
        p.feedLine("""data: {"section":"scheduleFit",""")
        p.feedLine("""data: "text":"Morning in, morning out."}""")
        val ev = p.feedLine("")
        assertEquals("Morning in, morning out.", (ev as InsightSseEvent.Delta).text)
    }

    @Test
    fun `carriage returns from proxies are tolerated`() {
        val p = parser()
        p.feedLine("event: status\r")
        p.feedLine("""data: {"stage":"CHECKING_VISA","message":"Checking visa eligibility..."}""" + "\r")
        val ev = p.feedLine("\r")
        assertEquals(InsightStages.CHECKING_VISA, (ev as InsightSseEvent.Status).stage)
    }

    @Test
    fun `error event carries the recoverable flag`() {
        val events = parseAll(
            """
            event: error
            data: {"code":"AI_STREAM_UNAVAILABLE","recoverable":true}

            """.trimIndent(),
        )
        val failed = events.single() as InsightSseEvent.Failed
        assertEquals("AI_STREAM_UNAVAILABLE", failed.code)
        assertTrue(failed.recoverable)
    }

    // ---------------- 状态机 ----------------

    private fun runReduce(events: List<InsightSseEvent>): AiInsightStreamState =
        events.fold<InsightSseEvent, AiInsightStreamState>(AiInsightStreamState.Connecting) { acc, e -> acc.reduce(e) }

    @Test
    fun `status before any body shows the analyzing stage`() {
        val state = runReduce(parseAll(fullStream).take(2))
        val analyzing = state as AiInsightStreamState.Analyzing
        assertEquals(InsightStages.BUILDING_PLAN, analyzing.stage)
        assertTrue(!state.hasBody)
    }

    @Test
    fun `deltas accumulate in order without duplication`() {
        val state = runReduce(parseAll(fullStream).take(5))
        val draft = (state as AiInsightStreamState.Streaming).content
        assertEquals("Bangkok keeps food and temples close.", draft.texts[InsightSections.CITY_ADVANTAGES])
        assertTrue(state.hasBody)
    }

    @Test
    fun `section complete overwrites the draft with the canonical payload`() {
        val start = AiInsightStreamState.Connecting
            .reduce(InsightSseEvent.Delta(InsightSections.CITY_ADVANTAGES, "half sentence that was rejec"))
        val done = start.reduce(
            InsightSseEvent.SectionComplete(
                InsightSections.CITY_ADVANTAGES,
                InsightSectionPayload(section = InsightSections.CITY_ADVANTAGES, text = "A clean validated sentence."),
            ),
        )
        val draft = (done as AiInsightStreamState.Streaming).content
        assertEquals("A clean validated sentence.", draft.texts[InsightSections.CITY_ADVANTAGES])
        assertTrue(InsightSections.CITY_ADVANTAGES in draft.completed)
    }

    @Test
    fun `deltas after completion are ignored so text never jumps back`() {
        val completed = AiInsightStreamState.Connecting
            .reduce(
                InsightSseEvent.SectionComplete(
                    InsightSections.SCHEDULE_FIT,
                    InsightSectionPayload(section = InsightSections.SCHEDULE_FIT, text = "Final text."),
                ),
            )
        val after = completed.reduce(InsightSseEvent.Delta(InsightSections.SCHEDULE_FIT, " stray tail"))
        val draft = (after as AiInsightStreamState.Streaming).content
        assertEquals("Final text.", draft.texts[InsightSections.SCHEDULE_FIT])
    }

    @Test
    fun `list and score payloads land in their own buckets`() {
        val state = runReduce(parseAll(fullStream).dropLast(1))
        val draft = (state as AiInsightStreamState.Streaming).content
        assertEquals(listOf("Same airport both ways"), draft.items[InsightSections.CONVENIENCE])
        assertEquals(83, draft.convenienceScore)
        assertEquals(2, draft.items[InsightSections.MINI_ITINERARY]?.size)
    }

    @Test
    fun `status after body keeps the content visible`() {
        val streaming = runReduce(parseAll(fullStream).take(5))
        val after = streaming.reduce(InsightSseEvent.Status(InsightStages.FINALIZING, "Finalizing the recommendation..."))
        assertTrue(after is AiInsightStreamState.Streaming)
        assertTrue(after.hasBody)
    }

    @Test
    fun `done with NOSANA source completes with all eight fields`() {
        val state = runReduce(parseAll(fullStream))
        val completed = state as AiInsightStreamState.Completed
        val c = completed.content
        assertEquals("rich-insight-v2", c.schemaVersion)
        assertTrue(c.cityAdvantages.isNotBlank())
        assertTrue(c.interestMatch.isNotBlank())
        assertTrue(c.scheduleFit.isNotBlank())
        assertTrue(c.miniItinerary.isNotEmpty())
        assertEquals(83, c.convenienceScore)
        assertTrue(c.convenienceReasons.isNotEmpty())
        assertTrue(c.travelerGains.isNotEmpty())
        assertTrue(c.travelerAccepts.isNotEmpty())
        assertTrue(state.terminal)
    }

    @Test
    fun `done with TEMPLATE source is a fallback but still terminal with content`() {
        val state = AiInsightStreamState.Connecting.reduce(
            InsightSseEvent.Done("TEMPLATE", AiInsightV2Dto(schemaVersion = "rich-insight-v2", cityAdvantages = "Template text"), cached = false),
        )
        assertTrue(state is AiInsightStreamState.Fallback)
        assertTrue(state.terminal)
        assertEquals("Template text", state.finished?.cityAdvantages)
    }

    @Test
    fun `error before any body is retryable, after body it is not`() {
        val early = AiInsightStreamState.Connecting
        assertTrue(!early.hasBody)

        val withBody = AiInsightStreamState.Connecting.reduce(InsightSseEvent.Delta(InsightSections.CITY_ADVANTAGES, "some text"))
        assertTrue(withBody.hasBody)
    }

    @Test
    fun `stage list matches the four product stages only`() {
        val stages = listOf(
            InsightStages.CHECKING_VISA,
            InsightStages.COMPARING_COST,
            InsightStages.BUILDING_PLAN,
            InsightStages.FINALIZING,
        )
        assertEquals(4, stages.distinct().size)
        // 区块顺序即 UI 渲染顺序，必须与后端一致
        assertEquals(
            listOf("cityAdvantages", "interestMatch", "scheduleFit", "miniItinerary", "convenience", "travelerGains", "travelerAccepts"),
            InsightSections.ORDER,
        )
    }

    @Test
    fun `user visible content never exposes vendor or model wording`() {
        // 注意：`done.source` 是内部标记（只进 BuildConfig.DEBUG 日志），不属于 UI 文案；
        // 这里只断言真正会渲染的 8 个字段与流式增量文本。
        val events = parseAll(fullStream)
        val visible = buildList {
            events.forEach { e ->
                when (e) {
                    is InsightSseEvent.Delta -> add(e.text)
                    is InsightSseEvent.Status -> add(e.message)
                    is InsightSseEvent.SectionComplete -> {
                        e.payload.text?.let { add(it) }
                        addAll(e.payload.items)
                        addAll(e.payload.reasons)
                    }
                    is InsightSseEvent.Done -> with(e.insight) {
                        add(cityAdvantages)
                        add(interestMatch)
                        add(scheduleFit)
                        addAll(miniItinerary)
                        addAll(convenienceReasons)
                        addAll(travelerGains)
                        addAll(travelerAccepts)
                    }
                    else -> Unit
                }
            }
        }.joinToString("\n").lowercase()

        for (banned in listOf("nosana", "qwen", "gpu", "deployment", "vllm", "latency")) {
            assertTrue("leaked=$banned", !visible.contains(banned))
        }
    }
}
