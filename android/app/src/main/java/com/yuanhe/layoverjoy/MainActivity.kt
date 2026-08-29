package com.yuanhe.layoverjoy

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yuanhe.layoverjoy.data.TokenHolder
import com.yuanhe.layoverjoy.ui.AppStateViewModel
import com.yuanhe.layoverjoy.ui.MainScreen
import com.yuanhe.layoverjoy.ui.screens.OnboardingScreen
import com.yuanhe.layoverjoy.ui.theme.AppShapes
import com.yuanhe.layoverjoy.ui.theme.AppTypography
import com.yuanhe.layoverjoy.ui.theme.BrandBackground
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import androidx.compose.material3.MaterialTheme as M3Theme
import androidx.compose.material3.lightColorScheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            LayoverJoyTheme {
                Root()
            }
        }
    }
}

@Composable
private fun LayoverJoyTheme(content: @Composable () -> Unit) {
    M3Theme(
        colorScheme = lightColorScheme(
            primary = BrandPrimary,
            onPrimary = androidx.compose.ui.graphics.Color.White,
            background = BrandBackground,
            surface = androidx.compose.ui.graphics.Color.White,
        ),
        typography = AppTypography,
        shapes = AppShapes,
        content = content,
    )
}

/** 游客优先：启动直达主界面（四 tab）；登录页作为需要身份的页面内路由弹出。 */
@Composable
private fun Root() {
    val appState: AppStateViewModel = viewModel(factory = AppStateViewModel.Factory)

    // 401（token 失效且无法刷新）时退为游客态，需要身份的页面会重新引导登录
    TokenHolder.onUnauthorized = {
        appState.onLoggedOut()
    }

    when (appState.gate) {
        AppStateViewModel.Gate.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = BrandPrimary)
        }
        AppStateViewModel.Gate.Onboarding -> OnboardingScreen(appState)
        AppStateViewModel.Gate.Main -> MainScreen(appState)
    }
}
