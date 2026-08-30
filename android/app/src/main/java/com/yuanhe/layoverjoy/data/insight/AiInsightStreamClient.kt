package com.yuanhe.layoverjoy.data.insight

import com.yuanhe.layoverjoy.data.AppJson
import com.yuanhe.layoverjoy.data.Net
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.isActive
import okhttp3.Call
import okhttp3.Request
import java.io.IOException

/**
 * 流式 AI 推荐的 SSE 客户端（基于 OkHttp 的可靠流式读取，不用 Retrofit 的 JSON Converter 读无限流）。
 *
 * 取消语义：Flow 被取消（页面退出）时 `awaitClose` 会 `call.cancel()`，
 * TCP 断开后后端监听到 `close` 再 abort 上游 Nosana 请求，GPU 立即释放。
 */
class AiInsightStreamClient(
    private val clientProvider: () -> okhttp3.OkHttpClient = { Net.client.sseClient() },
    private val baseUrlProvider: () -> String = { Net.client.currentBaseUrl() },
) {

    /** 一次流式生成。language 传 zh/en，与后端 `?language=` 契约一致。 */
    fun stream(planId: String, language: String): Flow<InsightSseEvent> = callbackFlow {
        val url = "${baseUrlProvider()}v1/plans/$planId/ai-insight/stream?language=$language"
        val request = Request.Builder()
            .url(url)
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .get()
            .build()

        val call: Call = clientProvider().newCall(request)
        try {
            call.execute().use { response ->
                if (!response.isSuccessful) {
                    trySend(InsightSseEvent.Failed("HTTP_${response.code}", recoverable = response.code >= 500))
                    close()
                    return@use
                }
                val source = response.body.source()
                val parser = InsightSseParser(AppJson)
                while (!source.exhausted()) {
                    if (!isActive) break
                    val line = source.readUtf8LineStrict()
                    parser.feedLine(line)?.let { trySend(it) }
                }
                parser.finish()?.let { trySend(it) }
            }
            close()
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            // 断流/超时：交给 ViewModel 决定重试或转模板补全，绝不把异常抛到 UI。
            trySend(InsightSseEvent.Failed("STREAM_IO", recoverable = true))
            close()
        }

        awaitClose { call.cancel() }
    }.flowOn(Dispatchers.IO)
}
