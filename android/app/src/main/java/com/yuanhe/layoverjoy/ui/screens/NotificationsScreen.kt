package com.yuanhe.layoverjoy.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.yuanhe.layoverjoy.data.ApiResult
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.NotificationDto
import com.yuanhe.layoverjoy.data.apiCall
import com.yuanhe.layoverjoy.ui.Badge
import com.yuanhe.layoverjoy.ui.EmptyBlock
import com.yuanhe.layoverjoy.ui.ErrorBanner
import com.yuanhe.layoverjoy.ui.JoyCard
import com.yuanhe.layoverjoy.ui.fmtDateTime
import com.yuanhe.layoverjoy.ui.theme.BrandBackground
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import com.yuanhe.layoverjoy.ui.i18n.L10n
import kotlinx.coroutines.launch

/** 通知中心：后端通知轮询结果（App 渠道）。点击标记已读。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<NotificationDto>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        when (val r = apiCall { Net.api.notifications(null) }) {
            is ApiResult.Ok -> items = r.data.notifications
            is ApiResult.Err -> error = r.message
        }
    }

    LaunchedEffect(Unit) { load() }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(L10n.t("notif.title")) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = BrandBackground),
        )
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
            item {
                ErrorBanner(error)
                Spacer(Modifier.height(8.dp))
            }
            val list = items
            if (list == null) {
                item { EmptyBlock(L10n.t("common.loading")) }
            } else if (list.isEmpty()) {
                item { EmptyBlock(L10n.t("notif.empty")) }
            } else {
                items(list, key = { it.id }) { n ->
                    val unread = n.readAt == null
                    JoyCard(Modifier.padding(vertical = 5.dp).clickable {
                        if (unread) {
                            scope.launch {
                                apiCall { Net.api.markRead(n.id) }
                                load()
                            }
                        }
                    }) {
                        Row(Modifier.fillMaxWidth()) {
                            Text(n.title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f), fontWeight = if (unread) FontWeight.Bold else FontWeight.Normal)
                            if (unread) Badge(L10n.t("notif.unread"), color = BrandPrimary, bg = BrandPrimary.copy(alpha = 0.1f))
                        }
                        Spacer(Modifier.height(4.dp))
                        Text(n.body, style = MaterialTheme.typography.bodySmall)
                        Spacer(Modifier.height(6.dp))
                        Text("${kindText(n.kind)} · ${fmtDateTime(n.createdAt)}", style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
                    }
                }
                item { Spacer(Modifier.height(24.dp)) }
            }
        }
    }
}

private fun kindText(kind: String): String = when (kind) {
    "PRICE_ALERT" -> L10n.t("notif.kind_price")
    "BOOKING_STATUS" -> L10n.t("notif.kind_booking")
    "REFUND" -> L10n.t("notif.kind_refund")
    "SYSTEM" -> L10n.t("notif.kind_system")
    else -> kind
}
