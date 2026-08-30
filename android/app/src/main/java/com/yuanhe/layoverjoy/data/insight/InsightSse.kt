package com.yuanhe.layoverjoy.data.insight

import kotlinx.serialization.Serializable

/** 后端 SSE 允许的事件类型（Android 只解析这些，未定义类型一律忽略）。 */
object InsightEvents {
    const val STATUS = "status"
    const val SECTION_START = "section_start"
    const val DELTA = "delta"
    const val SECTION_COMPLETE = "section_complete"
    const val DONE = "done"
    const val ERROR = "error"
}

/** 产品化分析阶段码（文案由后端给英文原文，UI 侧按语言本地化）。 */
object InsightStages {
    const val CHECKING_VISA = "CHECKING_VISA"
    const val COMPARING_COST = "COMPARING_COST"
    const val BUILDING_PLAN = "BUILDING_PLAN"
    const val FINALIZING = "FINALIZING"
}

/** 区块名（与后端 SECTION_ORDER 一致，决定渲染顺序）。 */
object InsightSections {
    const val CITY_ADVANTAGES = "cityAdvantages"
    const val INTEREST_MATCH = "interestMatch"
    const val SCHEDULE_FIT = "scheduleFit"
    const val MINI_ITINERARY = "miniItinerary"
    const val CONVENIENCE = "convenience"
    const val TRAVELER_GAINS = "travelerGains"
    const val TRAVELER_ACCEPTS = "travelerAccepts"

    val ORDER = listOf(
        CITY_ADVANTAGES, INTEREST_MATCH, SCHEDULE_FIT, MINI_ITINERARY, CONVENIENCE, TRAVELER_GAINS, TRAVELER_ACCEPTS,
    )

    /** 列表型区块按条目渲染，文本型按段落渲染。 */
    fun isList(section: String): Boolean =
        section == MINI_ITINERARY || section == TRAVELER_GAINS || section == TRAVELER_ACCEPTS
}

// ---------------- 线上 DTO ----------------

@Serializable
data class InsightStatusData(val stage: String = "", val message: String = "")

@Serializable
data class InsightSectionData(val section: String = "")

@Serializable
data class InsightDeltaData(val section: String = "", val text: String = "")

@Serializable
data class InsightSectionPayload(
    val section: String = "",
    val text: String? = null,
    val items: List<String> = emptyList(),
    val score: Int? = null,
    val reasons: List<String> = emptyList(),
)

@Serializable
data class InsightSectionCompleteData(val section: String = "", val payload: InsightSectionPayload = InsightSectionPayload())

/** Rich AI Stopover Insight v2 的 8 个字段（与后端 AiInsightV2 一致）。 */
@Serializable
data class AiInsightV2Dto(
    val schemaVersion: String = "",
    val lang: String = "",
    val cityAdvantages: String = "",
    val interestMatch: String = "",
    val scheduleFit: String = "",
    val miniItinerary: List<String> = emptyList(),
    val convenienceScore: Int = 0,
    val convenienceReasons: List<String> = emptyList(),
    val travelerGains: List<String> = emptyList(),
    val travelerAccepts: List<String> = emptyList(),
    /** NOSANA / HYBRID / TEMPLATE —— 仅用于 Debug 日志，不在 UI 展示。 */
    val source: String = "",
)

@Serializable
data class InsightDoneData(
    val source: String = "",
    val schemaVersion: String = "",
    val insight: AiInsightV2Dto = AiInsightV2Dto(),
    val cached: Boolean = false,
)

@Serializable
data class InsightErrorData(val code: String = "", val recoverable: Boolean = true)

/** 解析后的事件。 */
sealed interface InsightSseEvent {
    data class Status(val stage: String, val message: String) : InsightSseEvent
    data class SectionStart(val section: String) : InsightSseEvent
    data class Delta(val section: String, val text: String) : InsightSseEvent
    data class SectionComplete(val section: String, val payload: InsightSectionPayload) : InsightSseEvent
    data class Done(val source: String, val insight: AiInsightV2Dto, val cached: Boolean) : InsightSseEvent
    data class Failed(val code: String, val recoverable: Boolean) : InsightSseEvent
}

/**
 * SSE 帧解析器（纯函数，可在 JVM 单测里穷举）。
 *
 * 只处理协议层：`event:` / `data:` 行、空行分帧、注释行（`:` 开头的心跳）、
 * 多行 data 拼接。业务合法性由后端保证，这里只做 JSON 解码与未知事件忽略。
 */
class InsightSseParser(private val json: kotlinx.serialization.json.Json) {
    private var event: String? = null
    private val data = StringBuilder()

    /** 逐行喂入；返回该行是否凑齐了一个完整事件。 */
    fun feedLine(rawLine: String): InsightSseEvent? {
        val line = rawLine.removeSuffix("\r")
        if (line.startsWith(":")) return null // 心跳/注释帧
        if (line.isEmpty()) return flush()
        when {
            line.startsWith("event:") -> event = line.removePrefix("event:").trim()
            line.startsWith("data:") -> {
                if (data.isNotEmpty()) data.append('\n')
                data.append(line.removePrefix("data:").trim())
            }
            // id: / retry: 等字段按协议忽略
        }
        return null
    }

    /** 流结束时冲刷最后一帧（后端正常会以空行结尾，这里只是兜底）。 */
    fun finish(): InsightSseEvent? = flush()

    private fun flush(): InsightSseEvent? {
        val name = event
        val payload = data.toString()
        event = null
        data.setLength(0)
        if (name == null || payload.isEmpty()) return null
        return runCatching { decode(name, payload) }.getOrNull()
    }

    private fun decode(name: String, payload: String): InsightSseEvent? = when (name) {
        InsightEvents.STATUS -> json.decodeFromString(InsightStatusData.serializer(), payload)
            .let { InsightSseEvent.Status(it.stage, it.message) }
        InsightEvents.SECTION_START -> json.decodeFromString(InsightSectionData.serializer(), payload)
            .let { InsightSseEvent.SectionStart(it.section) }
        InsightEvents.DELTA -> json.decodeFromString(InsightDeltaData.serializer(), payload)
            .let { InsightSseEvent.Delta(it.section, it.text) }
        InsightEvents.SECTION_COMPLETE -> json.decodeFromString(InsightSectionCompleteData.serializer(), payload)
            .let { InsightSseEvent.SectionComplete(it.section, it.payload) }
        InsightEvents.DONE -> json.decodeFromString(InsightDoneData.serializer(), payload)
            .let { InsightSseEvent.Done(it.source, it.insight, it.cached) }
        InsightEvents.ERROR -> json.decodeFromString(InsightErrorData.serializer(), payload)
            .let { InsightSseEvent.Failed(it.code, it.recoverable) }
        else -> null // 未定义事件一律忽略
    }
}
