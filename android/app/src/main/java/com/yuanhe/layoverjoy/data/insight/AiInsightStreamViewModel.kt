package com.yuanhe.layoverjoy.data.insight

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.yuanhe.layoverjoy.BuildConfig
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 方案详情页的 AI 推荐 ViewModel。
 *
 * 三条硬要求（实施任务 §7）：
 * 1. **进入即自动生成**：`start()` 由 UI 调用一次；重复调用（重组/旋转/重复进入）直接忽略；
 * 2. **退出即取消**：ViewModel 随导航条目销毁，`onCleared` 取消 Job → SSE 断开 → 后端取消上游；
 * 3. **只对"尚未收到正文"的断线自动重试一次**，已经有正文时不重试，交由后端模板补齐结果。
 */
class AiInsightStreamViewModel(
    private val client: AiInsightStreamClient = AiInsightStreamClient(),
) : ViewModel() {

    private val _state = MutableStateFlow<AiInsightStreamState>(AiInsightStreamState.Idle)
    val state: StateFlow<AiInsightStreamState> = _state.asStateFlow()

    private var job: Job? = null
    private var started = false
    private var retried = false
    private var currentKey: String? = null

    /** planId + language 变化才允许重新生成；同一组合只跑一次。 */
    fun start(planId: String, language: String) {
        val key = "$planId:$language"
        if (started && currentKey == key) return
        currentKey = key
        started = true
        retried = false
        connect(planId, language)
    }

    /** 用户手动重试（仅在 Failed 时展示入口）。 */
    fun retry() {
        val key = currentKey ?: return
        val (planId, language) = key.split(":").let { it[0] to it.getOrElse(1) { "zh" } }
        retried = false
        connect(planId, language)
    }

    private fun connect(planId: String, language: String) {
        job?.cancel()
        _state.value = AiInsightStreamState.Connecting
        job = viewModelScope.launch {
            client.stream(planId, language).collect { event ->
                val previous = _state.value
                val next = previous.reduce(event)
                _state.value = next

                if (BuildConfig.DEBUG) {
                    // AI-10：技术诊断只进 Debug 日志，UI 永不展示 provider/模型/耗时。
                    when (event) {
                        is InsightSseEvent.Done -> Log.d(
                            "LayoverJoyAI",
                            "stream done plan=${planId.takeLast(8)} lang=$language source=${event.source} " +
                                "cached=${event.cached} schema=${event.insight.schemaVersion}",
                        )
                        is InsightSseEvent.Failed -> Log.d(
                            "LayoverJoyAI",
                            "stream failed plan=${planId.takeLast(8)} code=${event.code} recoverable=${event.recoverable} " +
                                "hadBody=${previous.hasBody}",
                        )
                        else -> Unit
                    }
                }

                // 尚未收到任何正文的断线：自动重试一次（只一次）。
                if (next is AiInsightStreamState.Failed && next.recoverable && !previous.hasBody && !retried) {
                    retried = true
                    connect(planId, language)
                }
            }
        }
    }

    override fun onCleared() {
        job?.cancel()
        super.onCleared()
    }
}
