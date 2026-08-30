package com.yuanhe.layoverjoy.data.location

import com.yuanhe.layoverjoy.data.catalog.CatalogCity

/**
 * 「使用当前城市」的可恢复状态机（方案 §8.4 的 8 个状态）。
 * 纯数据、不持 Android 对象：旋转屏幕/重组时状态可由 `rememberSaveable` 的枚举名恢复，
 * 且**不会在重组时重复请求权限**。
 *
 * 额外一档 [NoNearbyCity] 对应 §6.4 第 7 行（250km 内目录里没有任何可搜机场），
 * 不能与 [Unavailable]（Google Play services 不可用）混为一谈。
 */
sealed interface LocationUiState {
    data object Idle : LocationUiState
    data object RequestingPermission : LocationUiState
    data object Locating : LocationUiState

    /**
     * 匹配成功。[city] 非空表示 120km 内命中城市（[candidates] 为该城市机场，按距离排序）；
     * [city] 为空表示只有 250km 内的机场候选，必须由用户确认（不自动提交搜索）。
     */
    data class Matched(
        val city: CatalogCity?,
        val candidates: List<NearbyCandidate>,
    ) : LocationUiState

    /** [canAskAgain]=false 即「永久拒绝」，UI 提供「前往系统设置」。 */
    data class PermissionDenied(val canAskAgain: Boolean) : LocationUiState
    data object LocationDisabled : LocationUiState
    data object TimedOut : LocationUiState
    data object Unavailable : LocationUiState
    data object NoNearbyCity : LocationUiState

    /** 是否仍在「等待定位结果」的阻塞态（决定按钮 loading 与是否可再次点击）。 */
    val busy: Boolean get() = this is Locating || this is RequestingPermission

    /**
     * 可写入 `rememberSaveable` 的名字。携带内存负载（Matched 的城市/候选）与
     * 进行中状态一律降为 Idle：重建后回到「用户再点一次」的安态，不重复请求权限。
     */
    fun savedName(): String = when (this) {
        is Matched, Locating, RequestingPermission, Idle -> "Idle"
        is PermissionDenied -> "PermissionDenied"
        LocationDisabled -> "LocationDisabled"
        TimedOut -> "TimedOut"
        Unavailable -> "Unavailable"
        NoNearbyCity -> "NoNearbyCity"
    }

    companion object {
        /** 从保存的枚举名恢复（Matched 不持久化：重建后回到 Idle，由用户再点一次）。 */
        fun fromSavedName(name: String?): LocationUiState = when (name) {
            "PermissionDenied" -> PermissionDenied(canAskAgain = true)
            "LocationDisabled" -> LocationDisabled
            "TimedOut" -> TimedOut
            "Unavailable" -> Unavailable
            "NoNearbyCity" -> NoNearbyCity
            "Locating" -> Idle // 正在进行中的状态不跨重建保留，避免永久 loading
            else -> Idle
        }
    }
}

/** 行为埋点事件名（方案 §9）：只记行为，不含经纬度。 */
object LocationEvents {
    const val CLICKED = "current_city_clicked"
    const val PERMISSION_REQUESTED = "location_permission_requested"
    const val PERMISSION_GRANTED = "location_permission_granted"
    const val PERMISSION_DENIED = "location_permission_denied"
    const val NEARBY_MATCHED = "nearby_city_matched"
    const val NEARBY_MATCH_FAILED = "nearby_city_match_failed"
    const val ORIGIN_CONFIRMED = "origin_confirmed_from_location"

    /**
     * 回给搜索页的出发地来源标签（与 `OriginSelectionSource.CURRENT_LOCATION` 同名）。
     * 放在这里是为了让 UI 不直接依赖 data.search 包的枚举。
     */
    const val SOURCE_CURRENT_LOCATION = "CURRENT_LOCATION"
    const val SOURCE_MANUAL = "MANUAL"
}

/**
 * 权限 → 服务可用性 → 单次定位 → 本地匹配 的编排（方案 §6、§8.1）。
 * 所有 Android 依赖都以 lambda 注入，因此这一层的降级链可用纯 JVM 单测穷举。
 */
class LocationPermissionCoordinator(
    private val hasCoarsePermission: () -> Boolean,
    private val isServiceEnabled: () -> Boolean,
    private val isServiceUnavailable: () -> Boolean,
    private val locate: suspend () -> LocationOutcome,
    private val match: (GeoPoint) -> NearbyAirportResult,
    private val onEvent: (String) -> Unit = {},
) {

    /**
     * 点击入口后的第一步预检。返回 null 表示「可以继续」：
     * 要么已有权限（直接 [locateAndMatch]），要么需要弹权限框（UI 置 RequestingPermission）。
     */
    fun precheck(): LocationUiState? {
        if (isServiceUnavailable()) {
            onEvent(LocationEvents.NEARBY_MATCH_FAILED)
            return LocationUiState.Unavailable
        }
        if (!hasCoarsePermission()) {
            onEvent(LocationEvents.PERMISSION_REQUESTED)
            return null // 需要请求权限
        }
        onEvent(LocationEvents.PERMISSION_GRANTED)
        if (!isServiceEnabled()) {
            onEvent(LocationEvents.NEARBY_MATCH_FAILED)
            return LocationUiState.LocationDisabled
        }
        return null
    }

    /** 系统权限对话框返回后：授予则继续定位，拒绝则按能否再次询问给出两种降级路径。 */
    suspend fun onPermissionResult(granted: Boolean, showRationale: Boolean): LocationUiState {
        if (!granted) {
            onEvent(LocationEvents.PERMISSION_DENIED)
            return LocationUiState.PermissionDenied(canAskAgain = showRationale)
        }
        onEvent(LocationEvents.PERMISSION_GRANTED)
        return locateAndMatch()
    }

    /** 已有权限（或刚授予）时执行一次定位并本地匹配。 */
    suspend fun locateAndMatch(): LocationUiState {
        if (isServiceUnavailable()) return LocationUiState.Unavailable
        if (!hasCoarsePermission()) return LocationUiState.PermissionDenied(canAskAgain = true)
        if (!isServiceEnabled()) {
            onEvent(LocationEvents.NEARBY_MATCH_FAILED)
            return LocationUiState.LocationDisabled
        }
        return when (val outcome = locate()) {
            is LocationOutcome.Success -> {
                val matched = runCatching { match(outcome.point) }.getOrDefault(NearbyAirportResult.NoMatch)
                when (matched) {
                    is NearbyAirportResult.CityMatched -> {
                        onEvent(LocationEvents.NEARBY_MATCHED)
                        LocationUiState.Matched(matched.city, matched.airports)
                    }
                    is NearbyAirportResult.Candidates -> {
                        onEvent(LocationEvents.NEARBY_MATCHED)
                        LocationUiState.Matched(city = null, candidates = matched.items)
                    }
                    NearbyAirportResult.NoMatch,
                    NearbyAirportResult.CatalogUnavailable,
                    -> {
                        onEvent(LocationEvents.NEARBY_MATCH_FAILED)
                        LocationUiState.NoNearbyCity
                    }
                }
            }
            LocationOutcome.PermissionDenied -> LocationUiState.PermissionDenied(canAskAgain = true)
            LocationOutcome.Disabled -> {
                onEvent(LocationEvents.NEARBY_MATCH_FAILED)
                LocationUiState.LocationDisabled
            }
            LocationOutcome.TimedOut -> {
                onEvent(LocationEvents.NEARBY_MATCH_FAILED)
                LocationUiState.TimedOut
            }
            LocationOutcome.Unavailable, is LocationOutcome.Failed -> {
                onEvent(LocationEvents.NEARBY_MATCH_FAILED)
                LocationUiState.Unavailable
            }
        }
    }

    /** 用户确认使用定位到的城市/机场（§2.1：匹配成功仍要用户确认，不自动提交搜索）。 */
    fun onOriginConfirmed() = onEvent(LocationEvents.ORIGIN_CONFIRMED)
}
