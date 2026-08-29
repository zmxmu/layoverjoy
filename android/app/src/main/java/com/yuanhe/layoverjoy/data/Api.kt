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
    @GET("v1/plans/{id}") suspend fun planDetail(@Path("id") id: String): retrofit2.Response<PlanDetailDto>
    @POST("v1/plans/{id}/explanation") suspend fun createExplanation(@Path("id") id: String): retrofit2.Response<ExplanationDto>

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
 * Retrofit 客户端。baseUrl 可在设置页切换（模拟器 10.0.2.2 / 局域网 / Daytona 部署地址）。
 */
class ApiClient(initialBaseUrl: String) {
    @Volatile private var baseUrl: String = normalize(initialBaseUrl)
    @Volatile private var retrofit: Retrofit = build(baseUrl)

    val api: ApiService get() = retrofit.create(ApiService::class.java)

    fun switchBaseUrl(url: String) {
        val normalized = normalize(url)
        if (normalized != baseUrl) {
            baseUrl = normalized
            retrofit = build(normalized)
        }
    }

    fun currentBaseUrl(): String = baseUrl

    private fun normalize(url: String): String =
        if (url.endsWith("/")) url else "$url/"

    private fun build(base: String): Retrofit {
        val auth = Interceptor { chain ->
            val req = chain.request()
            val token = TokenHolder.accessToken
            val withAuth = if (token != null && !req.url.encodedPath.contains("webhooks")) {
                req.newBuilder().header("Authorization", "Bearer $token").build()
            } else req
            chain.proceed(withAuth)
        }
        val client = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(auth)
            .build()
        return Retrofit.Builder()
            .baseUrl(base)
            .client(client)
            .addConverterFactory(AppJson.asConverterFactory("application/json".toMediaType()))
            .build()
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
