package com.yuanhe.layoverjoy.data

import com.yuanhe.layoverjoy.BuildConfig
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.ResponseBody
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import java.util.concurrent.TimeUnit

/** 全局 JSON 配置：忽略未知字段，容忍后端新增字段。 */
val AppJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
}

/** 会话凭据持有者（由 SessionStore 注入），供拦截器读取。 */
object TokenHolder {
    @Volatile var accessToken: String? = null
    @Volatile var refreshToken: String? = null
    @Volatile var onUnauthorized: (() -> Unit)? = null

    /** Refresh 轮换成功后持久化新令牌对（由 Application 注入）。 */
    @Volatile var onTokensRefreshed: ((access: String, refresh: String?) -> Unit)? = null

    /** OkHttp Authenticator 线程上同步执行 refresh 并持久化。 */
    fun refreshTokensBlocking(api: ApiService): AuthTokens? {
        return synchronized(this) {
            // 锁内读取 refresh token：并发 401 时先获得锁的线程完成轮换后，
            // 后续线程必须用新 token；在锁外捕获的旧 token 已被服务端作废，
            // 会导致刷新失败误触发登出（重启后会话丢失的根因）。
            val rt = refreshToken ?: return null
            try {
                val resp = kotlinx.coroutines.runBlocking { api.refresh(RefreshRequest(rt)) }
                val tokens = if (resp.isSuccessful) resp.body() else null
                if (tokens != null) {
                    accessToken = tokens.accessToken
                    refreshToken = tokens.refreshToken ?: refreshToken
                    onTokensRefreshed?.invoke(tokens.accessToken, refreshToken)
                    tokens
                } else null
            } catch (_: Exception) {
                null
            }
        }
    }
}

/** 演示开关持有者（由 SessionStore 持久化，开发页切换），供拦截器读取。 */
object DemoFlags {
    /** 支付失败模拟：开启后支付请求携带 X-Demo-Pay-Result: FAIL，后端 Mock 支付使第一段必然失败。 */
    @Volatile var paySimFail: Boolean = false
}

/** 网络结果：统一携带后端错误契约。 */
sealed class ApiResult<out T> {
    data class Ok<T>(val data: T) : ApiResult<T>()
    data class Err(
        val code: String,
        val message: String,
        val retryable: Boolean,
        val httpStatus: Int,
        /** 后端错误细节（如 PARTIAL_BOOKING 的 intentId）。 */
        val details: kotlinx.serialization.json.JsonObject? = null,
    ) : ApiResult<Nothing>()
}

/** 后端错误响应解析。 */
private fun parseError(status: Int, body: ResponseBody?): ApiResult.Err {
    val parsed = runCatching {
        body?.string()?.let { AppJson.decodeFromString(ErrorBody.serializer(), it) }
    }.getOrNull()
    val env = parsed?.error
    return ApiResult.Err(
        code = env?.code ?: "NETWORK_ERROR",
        message = env?.message ?: "网络异常，请稍后重试。",
        retryable = env?.retryable ?: false,
        httpStatus = status,
        details = env?.details,
    )
}

/** 挂起封装：捕获 IOException 等传输层异常。 */
suspend fun <T> apiCall(block: suspend () -> retrofit2.Response<T>): ApiResult<T> {
    return try {
        val resp = block()
        if (resp.isSuccessful) {
            val body = resp.body()
            if (body == null) ApiResult.Err("EMPTY_RESPONSE", "服务端返回为空。", false, resp.code())
            else ApiResult.Ok(body)
        } else {
            if (resp.code() == 401) TokenHolder.onUnauthorized?.invoke()
            parseError(resp.code(), resp.errorBody())
        }
    } catch (e: java.io.IOException) {
        ApiResult.Err("NETWORK_ERROR", "无法连接服务器，请检查网络或后端地址。", true, 0)
    } catch (e: Exception) {
        ApiResult.Err("CLIENT_ERROR", e.message ?: "客户端错误。", false, 0)
    }
}

interface ApiService {
    // 认证
    @POST("v1/auth/register") suspend fun register(@Body body: RegisterRequest): retrofit2.Response<AuthTokens>
    @POST("v1/auth/login") suspend fun login(@Body body: LoginRequest): retrofit2.Response<AuthTokens>
    @POST("v1/auth/refresh") suspend fun refresh(@Body body: RefreshRequest): retrofit2.Response<AuthTokens>
    @POST("v1/auth/logout") suspend fun logout(): retrofit2.Response<okhttp3.ResponseBody>

    // 我
    @GET("v1/me") suspend fun me(): retrofit2.Response<MeProfile>
    /** 首页机会卡：只读后端已落库搜索结果。 */
    @GET("v1/home/opportunity") suspend fun homeOpportunity(): retrofit2.Response<HomeOpportunityResponse>
    @GET("v1/me/documents") suspend fun documents(): retrofit2.Response<DocumentsResponse>
    @POST("v1/me/documents") suspend fun addDocument(@Body body: DocumentInput): retrofit2.Response<IdResponse>
    @PATCH("v1/me/documents/{id}") suspend fun updateDocument(@Path("id") id: String, @Body body: DocumentInput): retrofit2.Response<IdResponse>
    @DELETE("v1/me/documents/{id}") suspend fun deleteDocument(@Path("id") id: String): retrofit2.Response<okhttp3.ResponseBody>

    // 机场
    @GET("v1/airports/cities") suspend fun cities(@Query("q") q: String?): retrofit2.Response<CitiesResponse>

    // 搜索
    @POST("v1/searches") suspend fun createSearch(@Body body: SearchRequest): retrofit2.Response<SearchCreatedResponse>
    @GET("v1/searches/{id}") suspend fun searchStatus(@Path("id") id: String): retrofit2.Response<SearchStatusResponse>
    @GET("v1/searches/{id}/plans") suspend fun searchPlans(@Path("id") id: String): retrofit2.Response<PlansResponse>

    // 方案
    @GET("v1/plans/{id}") suspend fun planDetail(@Path("id") id: String, @Query("lang") lang: String): retrofit2.Response<PlanDetailDto>
    @POST("v1/plans/{id}/explanation") suspend fun createExplanation(@Path("id") id: String, @Query("lang") lang: String): retrofit2.Response<ExplanationDto>

    // 通知 / 监控
    @GET("v1/notifications") suspend fun notifications(@Query("unread") unread: String?): retrofit2.Response<NotificationsResponse>
    @PATCH("v1/notifications/{id}/read") suspend fun markRead(@Path("id") id: String): retrofit2.Response<okhttp3.ResponseBody>
    @POST("v1/monitors") suspend fun createMonitor(@Body body: MonitorInput): retrofit2.Response<MonitorCreatedResponse>
    @GET("v1/monitors") suspend fun monitors(): retrofit2.Response<MonitorsResponse>
    @PATCH("v1/monitors/{id}/status") suspend fun setMonitorStatus(@Path("id") id: String, @Body body: MonitorStatusInput): retrofit2.Response<MonitorCreatedResponse>

    // 预订（模拟接口不在 /v1 前缀下）
    @GET("v1/bookings") suspend fun bookings(): retrofit2.Response<BookingsResponse>
    @GET("v1/bookings/{id}") suspend fun booking(@Path("id") id: String): retrofit2.Response<BookingResponse>
    @POST("api/orders/composite") suspend fun compositeOrder(@Body body: CompositeOrderRequest): retrofit2.Response<BookingResponse>
    @POST("api/orders/{id}/mock-pay") suspend fun mockPay(@Path("id") id: String): retrofit2.Response<BookingResponse>
    @POST("api/orders/{id}/simulate-leg-b-failure") suspend fun simulateLegB(@Path("id") id: String): retrofit2.Response<BookingResponse>
    @POST("api/orders/{id}/mock-refund") suspend fun mockRefund(@Path("id") id: String): retrofit2.Response<BookingResponse>
}

/**
 * Retrofit 客户端。baseUrl 可在隐藏开发页切换（本机 127.0.0.1 / Daytona 正式服务器）。
 * 私有预览（Daytona）需随请求携带 X-Daytona-Preview-Token，由 [previewToken] 控制。
 */
class ApiClient(initialBaseUrl: String) {
    @Volatile private var baseUrl: String = normalize(initialBaseUrl)
    @Volatile private var previewToken: String? = null
    @Volatile private var httpClient: OkHttpClient = buildClient()
    @Volatile private var retrofit: Retrofit = build(baseUrl)

    val api: ApiService get() = retrofit.create(ApiService::class.java)

    /**
     * 流式请求（SSE）专用客户端：复用同一套拦截器（Authorization / 预览 Token / 401 轮换），
     * 但关掉读超时——SSE 连接在两个事件之间本来就是长时间无数据的。
     */
    fun sseClient(): OkHttpClient = httpClient.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()

    fun switchBaseUrl(url: String) {
        val normalized = normalize(url)
        if (normalized != baseUrl) {
            baseUrl = normalized
            retrofit = build(normalized)
        }
    }

    /** 设置/清除私有预览 token；变化时重建客户端。 */
    fun setPreviewToken(token: String?) {
        val t = token?.trim()?.ifBlank { null }
        if (t != previewToken) {
            previewToken = t
            httpClient = buildClient()
            retrofit = build(baseUrl)
        }
    }

    fun currentBaseUrl(): String = baseUrl
    fun currentPreviewToken(): String? = previewToken

    private fun normalize(url: String): String =
        if (url.endsWith("/")) url else "$url/"

    private fun build(base: String): Retrofit =
        Retrofit.Builder()
            .baseUrl(base)
            .client(httpClient)
            .addConverterFactory(AppJson.asConverterFactory("application/json".toMediaType()))
            .build()

    private fun buildClient(): OkHttpClient {
        val token = previewToken
        val headers = Interceptor { chain ->
            var req = chain.request()
            val auth = TokenHolder.accessToken
            if (auth != null && !req.url.encodedPath.contains("webhooks")) {
                req = req.newBuilder().header("Authorization", "Bearer $auth").build()
            }
            if (token != null) {
                req = req.newBuilder().header("X-Daytona-Preview-Token", token).build()
            }
            // 开发页支付失败模拟开关：仅对支付接口生效。
            if (DemoFlags.paySimFail && req.url.encodedPath.contains("mock-pay")) {
                req = req.newBuilder().header("X-Demo-Pay-Result", "FAIL").build()
            }
            chain.proceed(req)
        }
        // 401 时用 Refresh Token 轮换后自动重放一次（认证接口本身不重试，避免循环）。
        val authenticator = okhttp3.Authenticator { _, response ->
            val path = response.request.url.encodedPath
            if (path.contains("auth/") || priorResponseCount(response) >= 2) {
                return@Authenticator null
            }
            // 并发场景：其他请求已完成轮换，直接用新令牌重放。
            val current = TokenHolder.accessToken
            val sentAuth = response.request.header("Authorization")
            if (current != null && sentAuth != null && "Bearer $current" != sentAuth) {
                return@Authenticator response.request.newBuilder().header("Authorization", "Bearer $current").build()
            }
            val tokens = TokenHolder.refreshTokensBlocking(retrofit.create(ApiService::class.java))
            if (tokens != null) {
                response.request.newBuilder().header("Authorization", "Bearer ${tokens.accessToken}").build()
            } else {
                TokenHolder.onUnauthorized?.invoke()
                null
            }
        }
        val client = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            // Nosana 推理可达 60~90 秒，读超时须覆盖后端超时上限（SSE 另用 sseClient() 关读超时）。
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(headers)
            .authenticator(authenticator)
            .build()
        return client
    }

    private fun priorResponseCount(response: okhttp3.Response): Int {
        var count = 1
        var prior = response.priorResponse
        while (prior != null) {
            count += 1
            prior = prior.priorResponse
        }
        return count
    }
}

/** 应用级单例。由 Application 用持久化的 baseUrl 初始化。 */
object Net {
    lateinit var client: ApiClient
    val api: ApiService get() = client.api

    fun init(baseUrl: String?) {
        client = ApiClient(baseUrl ?: BuildConfig.DEFAULT_BASE_URL)
    }
}
