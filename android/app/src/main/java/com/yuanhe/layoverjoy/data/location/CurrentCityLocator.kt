package com.yuanhe.layoverjoy.data.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.SystemClock
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.tasks.Task
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** 单次定位的结果（方案 §6.4 的每一行都对应一个 case）。 */
sealed class LocationOutcome {
    data class Success(val point: GeoPoint, val provider: String, val elapsedMs: Long) : LocationOutcome()
    data object PermissionDenied : LocationOutcome()
    data object Disabled : LocationOutcome()
    data object TimedOut : LocationOutcome()
    data object Unavailable : LocationOutcome()

    /** 底层异常（无 fix 也算）；UI 与 Unavailable 同样走手动降级，只在日志里区分原因。 */
    data class Failed(val reason: String) : LocationOutcome()
}

interface CurrentCityLocator {
    /** 只取一次前台大概位置；不注册持续监听、不申请后台权限。 */
    suspend fun locateOnce(): LocationOutcome
}

/**
 * 基于 `FusedLocationProviderClient` 的单次定位（方案 §3）：
 * 只需要 `play-services-location` 依赖，**不需要 Google Maps/Places API Key，也不需要 Billing**。
 *
 * 坐标只存在于返回值与内存中，调用方禁止落盘或上传（§7.3）。
 */
class FusedCurrentCityLocator(
    private val context: Context,
    private val timeoutMs: Long = DEFAULT_TIMEOUT_MS,
    private val clock: () -> Long = { SystemClock.elapsedRealtime() },
) : CurrentCityLocator {

    private val client: FusedLocationProviderClient by lazy { LocationServices.getFusedLocationProviderClient(context) }

    @SuppressLint("MissingPermission") // 真正的权限判定在 hasCoarsePermission()/coordinator 预检里
    override suspend fun locateOnce(): LocationOutcome {
        val startedAt = clock()
        if (playServicesUnavailable()) return LocationOutcome.Unavailable
        if (!hasCoarsePermission()) return LocationOutcome.PermissionDenied
        if (!locationServicesEnabled()) return LocationOutcome.Disabled

        // withTimeoutOrNull 返回 null 只可能是超时；用 sentinel 把「超时」和「没拿到 fix」分开。
        val probe: Probe? = try {
            withTimeoutOrNull(timeoutMs) {
                try {
                    // 只持有 ACCESS_COARSE_LOCATION 时，系统只会回一个粗粒度（约千米）的位置，
                    // 因此这里的高精度优先级只影响“用哪些 provider”：没有网络定位的设备
                    // （包括模拟器）仍能拿到 GPS fix，而 BALANCED 不会唤起 GPS。
                    Probe.Fixed(
                        client.getCurrentLocation(LocationRequest.PRIORITY_HIGH_ACCURACY, null).awaitLocation(),
                    )
                } catch (e: Exception) {
                    Probe.Error(e.message ?: "fused-location-error")
                }
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e // 页面销毁等外层取消必须原样传播，不吞
        }

        return when (probe) {
            null -> LocationOutcome.TimedOut
            is Probe.Error -> LocationOutcome.Failed(probe.reason)
            is Probe.Fixed -> {
                if (probe.location != null) return successOf(probe.location, startedAt)
                // getCurrentLocation 没拿到 fix：退到一次缓存位置（同样是单次、前台），仍拿不到按超时处理。
                val cached = runCatching { client.lastLocation.awaitLocation() }.getOrNull()
                if (cached != null) successOf(cached, startedAt) else LocationOutcome.TimedOut
            }
        }
    }

    private fun successOf(location: Location, startedAt: Long) = LocationOutcome.Success(
        point = GeoPoint(location.latitude, location.longitude),
        provider = location.provider ?: "fused",
        elapsedMs = clock() - startedAt,
    )

    fun hasCoarsePermission(): Boolean =
        context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** GPS 与网络 provider 全关才算「定位服务关闭」；模拟器 Extended Controls 注入走 GPS。 */
    fun locationServicesEnabled(): Boolean {
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
        return runCatching {
            manager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        }.getOrDefault(false)
    }

    fun playServicesUnavailable(): Boolean = runCatching {
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) != ConnectionResult.SUCCESS
    }.getOrDefault(true)

    private sealed class Probe {
        data class Fixed(val location: Location?) : Probe()
        data class Error(val reason: String) : Probe()
    }

    companion object {
        /** 方案 §6.4：8 秒后停止加载并恢复手动选择。 */
        const val DEFAULT_TIMEOUT_MS = 8_000L
    }
}

/** 把 GMS Task 桥接成协程（不额外引入 kotlinx-coroutines-play-services）。 */
private suspend fun Task<Location>.awaitLocation(): Location? = suspendCancellableCoroutine { cont ->
    addOnSuccessListener { loc -> if (cont.isActive) cont.resume(loc) }
    addOnFailureListener { e -> if (cont.isActive) cont.resumeWithException(e) }
    addOnCanceledListener { if (cont.isActive) cont.cancel() }
}

/** 只打行为，绝不打经纬度（方案 §9）。 */
fun describeOutcome(outcome: LocationOutcome): String = when (outcome) {
    is LocationOutcome.Success -> "success provider=${outcome.provider} elapsedMs=${outcome.elapsedMs}"
    LocationOutcome.PermissionDenied -> "permission-denied"
    LocationOutcome.Disabled -> "location-disabled"
    LocationOutcome.TimedOut -> "timed-out"
    LocationOutcome.Unavailable -> "play-services-unavailable"
    is LocationOutcome.Failed -> "failed reason=${outcome.reason}"
}
