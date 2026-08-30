package com.yuanhe.layoverjoy

import android.app.Application
import com.yuanhe.layoverjoy.data.DemoFlags
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.ServerEnv
import com.yuanhe.layoverjoy.data.SessionStore
import com.yuanhe.layoverjoy.data.TokenHolder
import com.yuanhe.layoverjoy.ui.i18n.L10n
import kotlinx.coroutines.CoroutineScope
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

    override fun onCreate() {
        super.onCreate()
        instance = this
        session = SessionStore(this)
        L10n.init(this)
        // 城市目录离线加载与索引（地点选择不依赖网络/登录）。
        com.yuanhe.layoverjoy.data.catalog.LocationCatalog.init(this)
        // 默认地址随运行环境自适应：模拟器自动用 10.0.2.2（固定别名，不随电脑 IP 变化），真机/本机用 127.0.0.1；
        // 用户（开发页）保存过的地址随后覆盖。
        Net.init(ServerEnv.localServerUrl())
        appScope.launch {
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
        }
    }

    companion object {
        lateinit var instance: LayoverJoyApp
            private set
    }
}
