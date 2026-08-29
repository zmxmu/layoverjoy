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

/** 应用级状态：登录态与路由入口。 */
class AppStateViewModel(val session: SessionStore) : ViewModel() {

    sealed class Gate {
        data object Loading : Gate()
        data object Auth : Gate()
        data object Onboarding : Gate()
        data object Main : Gate()
    }

    var gate by mutableStateOf<Gate>(Gate.Loading)
        private set

    var userEmail by mutableStateOf<String?>(null)
        private set

    init {
        // 冷启动快速恢复会话（DataStore 本地读取，毫秒级）
        runBlocking {
            val snap = session.snapshot()
            userEmail = snap.userEmail
            gate = when {
                snap.accessToken == null -> Gate.Auth
                !snap.onboardingDone -> Gate.Onboarding
                else -> Gate.Main
            }
        }
    }

    fun onAuthDone(email: String) {
        userEmail = email
        gate = Gate.Onboarding
    }

    fun onOnboardingDone() {
        gate = Gate.Main
    }

    fun onLoggedOut() {
        userEmail = null
        gate = Gate.Auth
    }

    suspend fun refreshGate() {
        val snap = session.snapshot()
        userEmail = snap.userEmail
        gate = when {
            snap.accessToken == null -> Gate.Auth
            !snap.onboardingDone -> Gate.Onboarding
            else -> Gate.Main
        }
    }

    companion object {
        val Factory: ViewModelProvider.Factory = viewModelFactory {
            initializer { AppStateViewModel(LayoverJoyApp.instance.session) }
        }
    }
}
