package com.yuanhe.layoverjoy

import android.app.Application
import com.yuanhe.layoverjoy.data.DemoFlags
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.ServerEnv
import com.yuanhe.layoverjoy.data.SessionStringPrefStore
import com.yuanhe.layoverjoy.data.SessionStore
import com.yuanhe.layoverjoy.data.TokenHolder
import com.yuanhe.layoverjoy.data.search.SearchPreferencesRepository
import com.yuanhe.layoverjoy.ui.i18n.L10n
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Application：初始化网络层与会话。
 * 启动时从 DataStore 恢复 baseUrl 与 accessToken，避免首屏闪烁。
 */
class LayoverJoyApp : Application() {

    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    lateinit var session: SessionStore
        private set

    /** 搜索设置缓存（与 SessionStore 共用同一个 DataStore 文件，按 userId 隔离键）。 */
    lateinit var searchPreferences: SearchPreferencesRepository
        private set

    /**
     * 令牌恢复完成的信号。任何依赖 [TokenHolder] 的启动期请求（如 `GET /v1/me` 取 userId）
     * 都必须先 await，否则会在 DataStore 读盘完成前发出无 Authorization 的请求。
     */
    val sessionRestored: Deferred<Unit> = CompletableDeferred()

    override fun onCreate() {
        super.onCreate()
        instance = this
        session = SessionStore(this)
        searchPreferences = SearchPreferencesRepository(SessionStringPrefStore(this))
        L10n.init(this)
        // 城市目录离线加载与索引（地点选择不依赖网络/登录）。
        com.yuanhe.layoverjoy.data.catalog.LocationCatalog.init(this)
        // 默认地址随运行环境自适应：模拟器自动用 10.0.2.2（固定别名，不随电脑 IP 变化），真机/本机用 127.0.0.1；
        // 用户（开发页）保存过的地址随后覆盖。
        Net.init(ServerEnv.localServerUrl())
        appScope.launch {
            try {
                val snap = session.snapshot()
                snap.baseUrl?.let { Net.client.switchBaseUrl(it) }
                snap.previewToken?.let { Net.client.setPreviewToken(it) }
                // 开发页演示开关恢复（仅本地缓存，重启后仍生效）。
                DemoFlags.paySimFail = snap.paySimFail
                TokenHolder.accessToken = snap.accessToken
                TokenHolder.refreshToken = snap.refreshToken
                TokenHolder.onUnauthorized = { /* 401 时退为游客态由 UI 层处理 */ }
                // Refresh 轮换成功后同步持久化新令牌对，重启后仍然有效。
                TokenHolder.onTokensRefreshed = { access, refresh ->
                    appScope.launch { session.saveTokens(access, refresh) }
                }
                // 缓存的服务端用户 id：登录态下先乐观恢复，让搜索偏好命名空间立即可用。
                if (snap.accessToken != null) {
                    RecoveredSession.userId = snap.userId
                }
            } finally {
                // 即使读盘异常也要放行等待方，否则搜索缓存会永远停在「命名空间未就绪」。
                (sessionRestored as CompletableDeferred<Unit>).complete(Unit)
            }
        }
    }

    companion object {
        lateinit var instance: LayoverJoyApp
            private set
    }
}

/**
 * 启动期从 DataStore 乐观恢复的用户 id（供 [AppStateViewModel] 决定搜索偏好命名空间）。
 * 只做跨层传递的 volatile 快照，不作为唯一可信来源：`GET /v1/me` 返回后会覆盖它。
 */
object RecoveredSession {
    @Volatile var userId: String? = null
}
