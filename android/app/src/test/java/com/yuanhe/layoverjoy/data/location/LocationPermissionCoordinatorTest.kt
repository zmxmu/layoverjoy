package com.yuanhe.layoverjoy.data.location

import com.yuanhe.layoverjoy.data.catalog.CatalogAirport
import com.yuanhe.layoverjoy.data.catalog.CatalogCity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「使用当前城市」的降级链（方案 §6.4 / §8.4）：权限拒绝、定位关闭、超时、
 * Play 服务不可用、目录无匹配都必须落到一个明确状态，且始终保留手动选择。
 */
class LocationPermissionCoordinatorTest {

    private val city = CatalogCity(
        cityId = "sg-singapore",
        countryCode = "SG",
        nameZh = "新加坡",
        nameEn = "Singapore",
        latitude = 1.3521,
        longitude = 103.8198,
        metroCode = "SIN",
        defaultAirportIata = "SIN",
        airports = listOf(CatalogAirport("SIN", "樟宜机场", "Changi", 1.3644, 103.9915, atlasSearchEnabled = true)),
    )

    private val point = GeoPoint(1.3644, 103.9915)
    private val success = LocationOutcome.Success(point, "fused", 120)
    private val events = mutableListOf<String>()

    private fun coordinator(
        hasPermission: Boolean = true,
        serviceEnabled: Boolean = true,
        serviceUnavailable: Boolean = false,
        outcome: LocationOutcome = success,
        match: (GeoPoint) -> NearbyAirportResult = { NearbyAirportResult.CityMatched(city, listOf(NearbyCandidate(city, city.airports[0], 1.2))) },
    ) = LocationPermissionCoordinator(
        hasCoarsePermission = { hasPermission },
        isServiceEnabled = { serviceEnabled },
        isServiceUnavailable = { serviceUnavailable },
        locate = { outcome },
        match = match,
        onEvent = { events += it },
    )

    @Test
    fun `precheck passes through when permission and service are ready`() {
        assertNull(coordinator().precheck())
        assertTrue(events.contains(LocationEvents.PERMISSION_GRANTED))
    }

    @Test
    fun `precheck asks for permission when it is missing`() {
        assertNull(coordinator(hasPermission = false).precheck())
        assertTrue(events.contains(LocationEvents.PERMISSION_REQUESTED))
    }

    @Test
    fun `precheck reports play services unavailable first`() {
        // Play 服务不可用时不再请求权限，直接给终态（避免无意义的系统弹窗）。
        assertEquals(LocationUiState.Unavailable, coordinator(hasPermission = false, serviceUnavailable = true).precheck())
        assertTrue(!events.contains(LocationEvents.PERMISSION_REQUESTED))
    }

    @Test
    fun `precheck reports disabled location services`() {
        assertEquals(LocationUiState.LocationDisabled, coordinator(serviceEnabled = false).precheck())
    }

    @Test
    fun `granted permission continues into locate and match`() = runBlocking {
        val state = coordinator().onPermissionResult(granted = true, showRationale = false)
        assertEquals("sg-singapore", (state as LocationUiState.Matched).city?.cityId)
        assertTrue(events.contains(LocationEvents.NEARBY_MATCHED))
    }

    @Test
    fun `denied permission keeps retry available when rationale is still shown`() = runBlocking {
        val state = coordinator().onPermissionResult(granted = false, showRationale = true)
        assertEquals(LocationUiState.PermissionDenied(canAskAgain = true), state)
        assertTrue(events.contains(LocationEvents.PERMISSION_DENIED))
    }

    @Test
    fun `permanently denied permission drops the retry path`() = runBlocking {
        val state = coordinator().onPermissionResult(granted = false, showRationale = false)
        assertEquals(LocationUiState.PermissionDenied(canAskAgain = false), state)
    }

    @Test
    fun `timeout becomes a retryable timed out state`() = runBlocking {
        assertEquals(LocationUiState.TimedOut, coordinator(outcome = LocationOutcome.TimedOut).locateAndMatch())
    }

    @Test
    fun `disabled and unavailable and failed outcomes map to their own states`() = runBlocking {
        assertEquals(LocationUiState.LocationDisabled, coordinator(outcome = LocationOutcome.Disabled).locateAndMatch())
        assertEquals(LocationUiState.Unavailable, coordinator(outcome = LocationOutcome.Unavailable).locateAndMatch())
        // 底层异常与 Play 服务不可用在 UI 上同样走手动降级。
        assertEquals(LocationUiState.Unavailable, coordinator(outcome = LocationOutcome.Failed("no provider")).locateAndMatch())
        assertEquals(
            LocationUiState.PermissionDenied(canAskAgain = true),
            coordinator(outcome = LocationOutcome.PermissionDenied).locateAndMatch(),
        )
    }

    @Test
    fun `candidates without a city still need user confirmation`() = runBlocking {
        val state = coordinator(match = { NearbyAirportResult.Candidates(listOf(NearbyCandidate(city, city.airports[0], 210.0))) })
            .locateAndMatch()
        val matched = state as LocationUiState.Matched
        assertNull(matched.city)
        assertEquals(1, matched.candidates.size)
    }

    @Test
    fun `no nearby city and unavailable catalog both end in no nearby city`() = runBlocking {
        assertEquals(LocationUiState.NoNearbyCity, coordinator(match = { NearbyAirportResult.NoMatch }).locateAndMatch())
        assertEquals(
            LocationUiState.NoNearbyCity,
            coordinator(match = { NearbyAirportResult.CatalogUnavailable }).locateAndMatch(),
        )
    }

    @Test
    fun `matcher crash degrades to no nearby city instead of propagating`() = runBlocking {
        val state = coordinator(match = { throw IllegalStateException("catalog broken") }).locateAndMatch()
        assertEquals(LocationUiState.NoNearbyCity, state)
    }

    @Test
    fun `locate and match rechecks permission and service before locating`() = runBlocking {
        assertEquals(LocationUiState.Unavailable, coordinator(serviceUnavailable = true).locateAndMatch())
        assertEquals(
            LocationUiState.PermissionDenied(canAskAgain = true),
            coordinator(hasPermission = false).locateAndMatch(),
        )
        assertEquals(LocationUiState.LocationDisabled, coordinator(serviceEnabled = false).locateAndMatch())
    }

    @Test
    fun `busy flag only covers in-flight states`() {
        assertTrue(LocationUiState.Locating.busy)
        assertTrue(LocationUiState.RequestingPermission.busy)
        assertTrue(!LocationUiState.Idle.busy)
        assertTrue(!LocationUiState.TimedOut.busy)
        assertTrue(!LocationUiState.Matched(city, emptyList()).busy)
    }

    @Test
    fun `saved state round trip never restores an in-flight or matched phase`() {
        val restoredFromLocating = LocationUiState.fromSavedName(LocationUiState.Locating.savedName())
        assertEquals(LocationUiState.Idle, restoredFromLocating)
        assertEquals(LocationUiState.Idle, LocationUiState.fromSavedName(LocationUiState.Matched(city, emptyList()).savedName()))
        assertEquals(LocationUiState.Idle, LocationUiState.fromSavedName(null))
        assertEquals(LocationUiState.TimedOut, LocationUiState.fromSavedName(LocationUiState.TimedOut.savedName()))
        assertEquals(LocationUiState.LocationDisabled, LocationUiState.fromSavedName(LocationUiState.LocationDisabled.savedName()))
        assertEquals(LocationUiState.Unavailable, LocationUiState.fromSavedName(LocationUiState.Unavailable.savedName()))
        assertEquals(LocationUiState.NoNearbyCity, LocationUiState.fromSavedName(LocationUiState.NoNearbyCity.savedName()))
        assertEquals(
            LocationUiState.PermissionDenied(canAskAgain = true),
            LocationUiState.fromSavedName(LocationUiState.PermissionDenied(canAskAgain = false).savedName()),
        )
    }

    @Test
    fun `outcome descriptions never leak coordinates`() {
        val text = describeOutcome(success) + describeOutcome(LocationOutcome.Failed("io")) +
            describeOutcome(LocationOutcome.TimedOut) + describeOutcome(LocationOutcome.Disabled) +
            describeOutcome(LocationOutcome.PermissionDenied) + describeOutcome(LocationOutcome.Unavailable)
        assertTrue(!text.contains("1.36"))
        assertTrue(!text.contains("103.9"))
    }

    @Test
    fun `confirming an origin emits the analytics event`() {
        coordinator().onOriginConfirmed()
        assertEquals(listOf(LocationEvents.ORIGIN_CONFIRMED), events)
    }
}
