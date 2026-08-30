package com.yuanhe.layoverjoy.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.yuanhe.layoverjoy.LayoverJoyApp
import com.yuanhe.layoverjoy.RecoveredSession
import com.yuanhe.layoverjoy.data.ApiResult
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.SessionStore
import com.yuanhe.layoverjoy.data.apiCall
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

/** 搜索偏好的命名空间（方案 §4.2）。[PENDING] 表示已登录但 user id 尚未取回。 */
enum class PrefsNamespace { GUEST, USER, PENDING }

/** 应用级状态：登录态与路由入口。游客优先：未登录也直达主界面，需要身份的页面再触发登录。 */
class AppStateViewModel(val session: SessionStore) : ViewModel() {

    sealed class Gate {
        data object Loading : Gate()
        data object Onboarding : Gate()
        data object Main : Gate()
    }

    var gate by mutableStateOf<Gate>(Gate.Loading)
        private set

    var userEmail by mutableStateOf<String?>(null)
        private set

    var isLoggedIn by mutableStateOf(false)
        private set

    /** 登录成功后要返回的目标路由（未登录时被拦截的页面）。 */
    var authReturnRoute by mutableStateOf<String?>(null)
        private set

    /**
     * 搜索设置缓存的命名空间。[PrefsNamespace.PENDING] 期间搜索页**既不加载也不保存**，
     * 避免把游客缓存写进账号命名空间（或反之）。
     */
    var prefsNamespace by mutableStateOf(PrefsNamespace.PENDING)
        private set

    /** 缓存键后缀：USER → userId，GUEST → null（落 guest 命名空间），PENDING → null 且禁止读写。 */
    val prefsUserId: String?
        get() = if (prefsNamespace == PrefsNamespace.USER) cachedUserId else null

    /** 命名空间就绪（可以加载/保存）？ */
    val prefsReady: Boolean
        get() = prefsNamespace != PrefsNamespace.PENDING

    private var cachedUserId: String? = null

    fun markAuthReturn(route: String?) {
        authReturnRoute = route
    }

    init {
        // 冷启动快速恢复会话（DataStore 本地读取，毫秒级）；未登录直接进主界面当游客
        runBlocking {
            val snap = session.snapshot()
            userEmail = snap.userEmail
            isLoggedIn = snap.accessToken != null
            gate = Gate.Main
            val cachedId = snap.userId?.trim()?.ifBlank { null }
            when {
                // 未登录：直接用 guest 命名空间，游客也能缓存自己的搜索设置。
                snap.accessToken == null -> applyNamespace(null)
                // 登录态且 id 已缓存（Application 已从 DataStore 乐观恢复）：命名空间立即可用。
                cachedId != null -> applyNamespace(cachedId)
                // 本功能上线后的首次冷启动：后台补齐，补齐前搜索页用默认值。
                else -> {
                    prefsNamespace = PrefsNamespace.PENDING
                    ensureUserId()
                }
            }
        }
    }

    suspend fun onAuthDone(email: String) {
        userEmail = email
        isLoggedIn = true
        // 新登录令牌已在 TokenHolder 中，立即确定命名空间，引导后首次进搜索页就能恢复该账号的缓存。
        ensureUserId()
        if (session.snapshot().onboardingDone || serverHasPassport()) {
            gate = Gate.Main
        } else {
            // 首次登录走引导流程：引导结束后统一落在首页，不再回跳拦截前的页面，
            // 避免引导完成瞬间在导航尚未就绪时执行回跳导致返回栈异常。
            authReturnRoute = null
            gate = Gate.Onboarding
        }
    }

    /**
     * 取 `GET /v1/me` 的 user.id 并持久化。等 [LayoverJoyApp.sessionRestored] 后再发请求，
     * 避免冷启动时 Authorization 还没从 DataStore 恢复就拿到 401。
     * 取不到（断网/后端异常）退到 guest 命名空间：功能继续可用，不把搜索页永久卡在未就绪。
     */
    private fun ensureUserId() {
        viewModelScope.launch {
            LayoverJoyApp.instance.sessionRestored.await()
            val id = runCatching {
                when (val r = apiCall { Net.api.me() }) {
                    is ApiResult.Ok -> r.data.user?.id?.trim()?.ifBlank { null }
                    else -> null
                }
            }.getOrNull() ?: RecoveredSession.userId?.trim()?.ifBlank { null }
            if (id != null) {
                session.setUserId(id)
                applyNamespace(id)
            } else {
                applyNamespace(null)
            }
        }
    }

    private fun applyNamespace(userId: String?) {
        cachedUserId = userId
        prefsNamespace = if (userId == null) PrefsNamespace.GUEST else PrefsNamespace.USER
    }

    /**
     * 重新登录/换机场景：证件已持久化在服务端数据库，不应让用户重走引导重录。
     * 查询失败（如断网）时保守返回 false，宁可多走一次引导也不跳过资格数据收集。
     */
    private suspend fun serverHasPassport(): Boolean {
        val has = runCatching {
            when (val r = apiCall { Net.api.documents() }) {
                is ApiResult.Ok -> r.data.documents.any { it.kind == "PASSPORT" }
                else -> false
            }
        }.getOrDefault(false)
        if (has) session.restoreOnboardingDone()
        return has
    }

    fun onOnboardingDone() {
        gate = Gate.Main
    }

    fun onLoggedOut() {
        userEmail = null
        isLoggedIn = false
        // 登出后切到 guest 命名空间；该账号的缓存仍留在盘上，重新登录会恢复（方案 §4.2 第 4 条）。
        RecoveredSession.userId = null
        applyNamespace(null)
        gate = Gate.Main
    }

    suspend fun refreshGate() {
        val snap = session.snapshot()
        userEmail = snap.userEmail
        isLoggedIn = snap.accessToken != null
        if (!isLoggedIn) applyNamespace(null) else if (snap.userId != null) applyNamespace(snap.userId)
        gate = Gate.Main
    }

    companion object {
        val Factory: ViewModelProvider.Factory = viewModelFactory {
            initializer { AppStateViewModel(LayoverJoyApp.instance.session) }
        }
    }
}
