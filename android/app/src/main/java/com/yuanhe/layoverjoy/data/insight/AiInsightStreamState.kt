package com.yuanhe.layoverjoy.data.insight

/**
 * 流式内容草稿：文本区块累积 delta，列表区块只在 `section_complete` 落定。
 * `completed` 里的区块以规范载荷为准——因此被后端拒绝（含违规内容）的草稿会被整块覆盖。
 */
data class RichInsightV2Draft(
    val texts: Map<String, String> = emptyMap(),
    val items: Map<String, List<String>> = emptyMap(),
    val convenienceScore: Int? = null,
    val completed: Set<String> = emptySet(),
) {
    val hasBody: Boolean get() = texts.values.any { it.isNotBlank() } || items.isNotEmpty()

    /** 已完成的区块数（用于进度提示与"是否已收到正文"判断）。 */
    val completedCount: Int get() = completed.size
}

/** 详情页 AI 卡的状态机（实施任务 §7）。 */
sealed interface AiInsightStreamState {
    data object Idle : AiInsightStreamState
    data object Connecting : AiInsightStreamState
    data class Analyzing(val stage: String, val message: String) : AiInsightStreamState
    data class Streaming(val stage: String, val content: RichInsightV2Draft) : AiInsightStreamState
    data class Completed(val content: AiInsightV2Dto, val cached: Boolean) : AiInsightStreamState
    data class Fallback(val content: AiInsightV2Dto) : AiInsightStreamState
    data class Failed(val recoverable: Boolean) : AiInsightStreamState

    /** 终态：不再需要 loading，也不允许自动重连。 */
    val terminal: Boolean get() = this is Completed || this is Fallback || this is Failed

    /** 当前应展示的完整结果（终态才有）。 */
    val finished: AiInsightV2Dto?
        get() = when (this) {
            is Completed -> content
            is Fallback -> content
            else -> null
        }

    /** 已经收到过正文（决定断线后能否自动重试）。 */
    val hasBody: Boolean
        get() = when (this) {
            is Streaming -> content.hasBody || content.completed.isNotEmpty()
            is Completed, is Fallback -> true
            else -> false
        }
}

/**
 * 事件 → 状态 的纯函数归约（无 Android 依赖，可在 JVM 单测里穷举事件序列）。
 *
 * 关键约束：
 * - `delta` 只累积到未完成的文本区块，已完成区块不再变动 → 不会重复或跳回；
 * - `section_complete` 用规范载荷整块覆盖草稿 → 半截句子和被拒内容都不会留在 UI 上；
 * - `done` 一律进入终态（source=TEMPLATE 时是 Fallback，UI 结构相同）。
 */
fun AiInsightStreamState.reduce(event: InsightSseEvent): AiInsightStreamState {
    val draft = (this as? AiInsightStreamState.Streaming)?.content ?: RichInsightV2Draft()
    val stage = when (this) {
        is AiInsightStreamState.Analyzing -> stage
        is AiInsightStreamState.Streaming -> stage
        else -> InsightStages.CHECKING_VISA
    }

    return when (event) {
        is InsightSseEvent.Status ->
            // 已经有正文时不要退回纯文字进度态，否则内容会闪一下消失。
            if (draft.hasBody || draft.completed.isNotEmpty()) {
                AiInsightStreamState.Streaming(event.stage, draft)
            } else {
                AiInsightStreamState.Analyzing(event.stage, event.message)
            }

        is InsightSseEvent.SectionStart -> AiInsightStreamState.Streaming(stage, draft)

        is InsightSseEvent.Delta ->
            if (event.section in draft.completed) {
                AiInsightStreamState.Streaming(stage, draft)
            } else {
                val merged = draft.texts.toMutableMap()
                merged[event.section] = (merged[event.section] ?: "") + event.text
                AiInsightStreamState.Streaming(stage, draft.copy(texts = merged))
            }

        is InsightSseEvent.SectionComplete -> {
            val p = event.payload
            val texts = draft.texts.toMutableMap()
            val items = draft.items.toMutableMap()
            when {
                p.text != null -> texts[event.section] = p.text
                p.reasons.isNotEmpty() -> items[event.section] = p.reasons
                p.items.isNotEmpty() -> items[event.section] = p.items
            }
            AiInsightStreamState.Streaming(
                stage,
                draft.copy(
                    texts = texts,
                    items = items,
                    convenienceScore = p.score ?: draft.convenienceScore,
                    completed = draft.completed + event.section,
                ),
            )
        }

        is InsightSseEvent.Done ->
            if (event.source == "TEMPLATE") AiInsightStreamState.Fallback(event.insight)
            else AiInsightStreamState.Completed(event.insight, event.cached)

        is InsightSseEvent.Failed -> AiInsightStreamState.Failed(event.recoverable)
    }
}
