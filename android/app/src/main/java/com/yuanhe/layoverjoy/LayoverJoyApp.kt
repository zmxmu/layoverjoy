package com.yuanhe.layoverjoy

import android.app.Application
import com.yuanhe.layoverjoy.data.Net
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
        Net.init(null)
        appScope.launch {
            val snap = session.snapshot()
            snap.baseUrl?.let { Net.client.switchBaseUrl(it) }
            TokenHolder.accessToken = snap.accessToken
            TokenHolder.refreshToken = snap.refreshToken
            TokenHolder.onUnauthorized = { /* 401 时回到登录页由 UI 层处理 */ }
        }
    }

    companion object {
        lateinit var instance: LayoverJoyApp
            private set
    }
}
