package com.yuanhe.layoverjoy.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.yuanhe.layoverjoy.BuildConfig
import com.yuanhe.layoverjoy.LayoverJoyApp
import com.yuanhe.layoverjoy.data.ApiResult
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.apiCall
import com.yuanhe.layoverjoy.data.LoginRequest
import com.yuanhe.layoverjoy.data.RegisterRequest
import com.yuanhe.layoverjoy.ui.AppStateViewModel
import com.yuanhe.layoverjoy.ui.ErrorBanner
import com.yuanhe.layoverjoy.ui.LabeledField
import com.yuanhe.layoverjoy.ui.PrimaryButton
import com.yuanhe.layoverjoy.ui.i18n.L10n
import com.yuanhe.layoverjoy.ui.theme.BrandAccent
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import kotlinx.coroutines.launch

/** 登录 / 注册页（不实现演示账户，按契约全部使用真实注册）。
 * 游客优先模式下作为主界面内路由弹出：[onClose] 非空时显示返回按钮，登录成功回调 [onSuccess]。 */
@Composable
fun AuthScreen(appState: AppStateViewModel, onClose: (() -> Unit)? = null, onSuccess: (() -> Unit)? = null) {
    val scope = rememberCoroutineScope()
    val session = LayoverJoyApp.instance.session

    var isRegister by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var nickname by remember { mutableStateOf("") }
    var showServerConfig by remember { mutableStateOf(false) }
    var baseUrl by remember { mutableStateOf(Net.client.currentBaseUrl().removeSuffix("/")) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        if (onClose != null) {
            TextButton(onClick = onClose, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
                Text("‹ " + L10n.t("common.back"), color = BrandInkSoft, style = MaterialTheme.typography.labelLarge)
            }
            Spacer(Modifier.height(8.dp))
        }
        Text(L10n.t("auth.app_name"), style = MaterialTheme.typography.titleLarge, color = BrandPrimary)
        Spacer(Modifier.height(6.dp))
        Text(
            L10n.t("auth.tagline"),
            style = MaterialTheme.typography.bodyMedium,
            color = BrandInkSoft,
        )
        Spacer(Modifier.height(28.dp))

        Row {
            TextButton(onClick = { isRegister = false; error = null }) {
                Text(L10n.t("auth.login"), fontWeight = if (!isRegister) FontWeight.Bold else FontWeight.Normal, color = BrandPrimary)
            }
            TextButton(onClick = { isRegister = true; error = null }) {
                Text(L10n.t("auth.register"), fontWeight = if (isRegister) FontWeight.Bold else FontWeight.Normal, color = BrandPrimary)
            }
        }
        Spacer(Modifier.height(12.dp))

        LabeledField(L10n.t("auth.email"), email, { email = it.trim() }, placeholder = "you@example.com", keyboardType = KeyboardType.Email)
        Spacer(Modifier.height(12.dp))
        LabeledField(L10n.t("auth.password"), password, { password = it }, placeholder = L10n.t("auth.password_hint"), password = true)
        if (isRegister) {
            Spacer(Modifier.height(12.dp))
            LabeledField(L10n.t("auth.nickname"), nickname, { nickname = it }, placeholder = L10n.t("auth.nickname_hint"))
        }
        Spacer(Modifier.height(20.dp))

        ErrorBanner(error)
        if (error != null) Spacer(Modifier.height(12.dp))

        PrimaryButton(
            text = if (isRegister) L10n.t("auth.create") else L10n.t("auth.login"),
            loading = loading,
            enabled = email.contains("@") && password.length >= 8,
            onClick = {
                error = null
                loading = true
                scope.launch {
                    // 先应用用户配置的服务器地址
                    if (baseUrl.isNotBlank()) {
                        session.setBaseUrl(baseUrl)
                        Net.client.switchBaseUrl(baseUrl)
                    }
                    val result = if (isRegister) {
                        apiCall { Net.api.register(RegisterRequest(email, password, nickname.ifBlank { null })) }
                    } else {
                        apiCall { Net.api.login(LoginRequest(email, password)) }
                    }
                    when (result) {
                        is ApiResult.Ok -> {
                            session.saveTokens(result.data.accessToken, result.data.refreshToken)
                            session.setEmail(email)
                            appState.onAuthDone(email)
                            onSuccess?.invoke()
                        }
                        is ApiResult.Err -> error = result.message
                    }
                    loading = false
                }
            },
        )
        Spacer(Modifier.height(16.dp))

        TextButton(onClick = { showServerConfig = !showServerConfig }) {
            Text(L10n.t("auth.server_settings"), style = MaterialTheme.typography.labelMedium, color = BrandAccent)
        }
        if (showServerConfig) {
            LabeledField(
                L10n.t("auth.backend_url"),
                baseUrl,
                { baseUrl = it.trim() },
                placeholder = BuildConfig.DEFAULT_BASE_URL,
                keyboardType = KeyboardType.Uri,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                L10n.t("auth.server_hint", BuildConfig.DEFAULT_BASE_URL),
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}
