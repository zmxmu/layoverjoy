package com.yuanhe.layoverjoy.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.yuanhe.layoverjoy.LayoverJoyApp
import com.yuanhe.layoverjoy.data.SessionStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

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
        }
    }

    suspend fun onAuthDone(email: String) {
        userEmail = email
        isLoggedIn = true
        if (session.snapshot().onboardingDone) {
            gate = Gate.Main
        } else {
            // 首次登录走引导流程：引导结束后统一落在首页，不再回跳拦截前的页面，
            // 避免引导完成瞬间在导航尚未就绪时执行回跳导致返回栈异常。
            authReturnRoute = null
            gate = Gate.Onboarding
        }
    }

    fun onOnboardingDone() {
        gate = Gate.Main
    }

    fun onLoggedOut() {
        userEmail = null
        isLoggedIn = false
        gate = Gate.Main
    }

    suspend fun refreshGate() {
        val snap = session.snapshot()
        userEmail = snap.userEmail
        isLoggedIn = snap.accessToken != null
        gate = Gate.Main
    }

    companion object {
        val Factory: ViewModelProvider.Factory = viewModelFactory {
            initializer { AppStateViewModel(LayoverJoyApp.instance.session) }
        }
    }
}
