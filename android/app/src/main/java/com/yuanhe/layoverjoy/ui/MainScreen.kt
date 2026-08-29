package com.yuanhe.layoverjoy.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FlightTakeoff
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Luggage
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.outlined.FlightTakeoff
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Luggage
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.yuanhe.layoverjoy.ui.i18n.L10n
import com.yuanhe.layoverjoy.ui.screens.BookingFlowScreen
import com.yuanhe.layoverjoy.ui.screens.DocumentsScreen
import com.yuanhe.layoverjoy.ui.screens.HomeScreen
import com.yuanhe.layoverjoy.ui.screens.MonitorSetupScreen
import com.yuanhe.layoverjoy.ui.screens.NotificationsScreen
import com.yuanhe.layoverjoy.ui.screens.PlanDetailScreen
import com.yuanhe.layoverjoy.ui.screens.ProfileScreen
import com.yuanhe.layoverjoy.ui.screens.ResultsScreen
import com.yuanhe.layoverjoy.ui.screens.SearchScreen
import com.yuanhe.layoverjoy.ui.screens.TripsScreen
import com.yuanhe.layoverjoy.ui.theme.BrandBackground
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary

object Routes {
    const val HOME = "home"
    const val SEARCH = "search"
    const val TRIPS = "trips"
    const val PROFILE = "profile"
    const val RESULTS = "results/{runId}"
    const val PLAN_DETAIL = "plan/{planId}"
    const val MONITOR_SETUP = "monitor/{planId}"
    const val BOOKING = "booking/{planId}"
    const val NOTIFICATIONS = "notifications"
    const val DOCUMENTS = "documents"

    fun results(runId: String) = "results/$runId"
    fun planDetail(planId: String) = "plan/$planId"
    fun monitorSetup(planId: String) = "monitor/$planId"
    fun booking(planId: String) = "booking/$planId"
}

private data class Tab(val route: String, val labelKey: String, val filled: ImageVector, val outlined: ImageVector)

private val TABS = listOf(
    Tab(Routes.HOME, "tab.home", Icons.Filled.Home, Icons.Outlined.Home),
    Tab(Routes.SEARCH, "tab.search", Icons.Filled.FlightTakeoff, Icons.Outlined.FlightTakeoff),
    Tab(Routes.TRIPS, "tab.trips", Icons.Filled.Luggage, Icons.Outlined.Luggage),
    Tab(Routes.PROFILE, "tab.profile", Icons.Filled.Person, Icons.Outlined.Person),
)

/** 主界面：底部四页签 + 深层页面（结果/详情/监控设置/预订/通知/证件）。 */
@Composable
fun MainScreen(appState: AppStateViewModel) {
    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val currentRoute = backStack?.destination?.route
    val showBottomBar = currentRoute in TABS.map { it.route }

    Scaffold(
        containerColor = BrandBackground,
        bottomBar = {
            if (showBottomBar) {
                NavigationBar(containerColor = Color.White) {
                    TABS.forEach { tab ->
                        val selected = currentRoute == tab.route
                        val label = L10n.t(tab.labelKey)
                        NavigationBarItem(
                            selected = selected,
                            onClick = {
                                nav.navigate(tab.route) {
                                    popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(if (selected) tab.filled else tab.outlined, contentDescription = label) },
                            label = { Text(label) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = BrandPrimary,
                                selectedTextColor = BrandPrimary,
                                indicatorColor = BrandPrimary.copy(alpha = 0.12f),
                            ),
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = Routes.HOME, modifier = Modifier.padding(padding)) {
            composable(Routes.HOME) { HomeScreen(nav) }
            composable(Routes.SEARCH) { SearchScreen(nav) }
            composable(Routes.TRIPS) { TripsScreen(nav) }
            composable(Routes.PROFILE) { ProfileScreen(nav, appState) }
            composable(Routes.RESULTS, listOf(navArgument("runId") { type = NavType.StringType })) {
                ResultsScreen(nav, it.arguments?.getString("runId").orEmpty())
            }
            composable(Routes.PLAN_DETAIL, listOf(navArgument("planId") { type = NavType.StringType })) {
                PlanDetailScreen(nav, it.arguments?.getString("planId").orEmpty())
            }
            composable(Routes.MONITOR_SETUP, listOf(navArgument("planId") { type = NavType.StringType })) {
                MonitorSetupScreen(nav, it.arguments?.getString("planId").orEmpty())
            }
            composable(Routes.BOOKING, listOf(navArgument("planId") { type = NavType.StringType })) {
                BookingFlowScreen(nav, it.arguments?.getString("planId").orEmpty())
            }
            composable(Routes.NOTIFICATIONS) { NotificationsScreen(nav) }
            composable(Routes.DOCUMENTS) { DocumentsScreen(nav) }
        }
    }
}
