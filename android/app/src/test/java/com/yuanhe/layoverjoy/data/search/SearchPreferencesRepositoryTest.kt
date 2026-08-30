package com.yuanhe.layoverjoy.data.search

import com.yuanhe.layoverjoy.data.StringPrefStore
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * userId 命名空间隔离（方案 §4.2）：同一个 DataStore 文件里按用户分键，
 * 未登录走 guest 命名空间；换账号不会读到上一个人的搜索设置。
 */
class SearchPreferencesRepositoryTest {

    /** 内存版存储：让仓储层逻辑可在纯 JVM 单测里跑，不需要 Robolectric。 */
    private class FakeStore : StringPrefStore {
        val map = mutableMapOf<String, String?>()
        var readError: Throwable? = null
        var writeError: Throwable? = null

        override suspend fun read(key: String): String? {
            readError?.let { throw it }
            return map[key]
        }

        override suspend fun write(key: String, value: String) {
            writeError?.let { throw it }
            map[key] = value
        }

        override suspend fun delete(key: String) {
            map.remove(key)
        }
    }

    private val clockStamp = Instant.parse("2026-08-30T03:04:05Z")
    private fun repo(store: FakeStore) = SearchPreferencesRepository(store) { clockStamp }

    private fun prefs(city: String) = CachedSearchPreferences(
        originCityCode = city,
        departureDate = LocalDate.of(2026, 9, 25),
    )

    @Test
    fun `key for signed in user is namespaced by id`() {
        assertEquals("search_preferences_v1_u_42", SearchPreferencesRepository.keyFor("u_42"))
    }

    @Test
    fun `blank or missing user id lands in the guest namespace`() {
        assertEquals("search_preferences_v1_guest", SearchPreferencesRepository.keyFor(null))
        assertEquals("search_preferences_v1_guest", SearchPreferencesRepository.keyFor("   "))
    }

    @Test
    fun `stored user id is trimmed before building the key`() {
        val store = FakeStore()
        runBlocking {
            repo(store).save("  u_7  ", prefs("SIN"))
        }
        assertEquals(listOf("search_preferences_v1_u_7"), store.map.keys.toList())
    }

    @Test
    fun `two users never read each other cache`() {
        val store = FakeStore()
        val repository = repo(store)
        runBlocking {
            repository.save("u_a", prefs("SIN"))
            repository.save("u_b", prefs("HKG"))

            assertEquals("SIN", repository.load("u_a")?.originCityCode)
            assertEquals("HKG", repository.load("u_b")?.originCityCode)
            assertNull(repository.load("u_c"))
            assertNull(repository.load(null))
        }
    }

    @Test
    fun `save stamps schema version and clock`() {
        val store = FakeStore()
        runBlocking {
            repo(store).save("u_a", prefs("SIN").copy(schemaVersion = 99, updatedAt = Instant.EPOCH))
            val saved = repo(store).load("u_a")
            assertEquals(SearchPreferencesCodec.SCHEMA_VERSION, saved?.schemaVersion)
            assertEquals(clockStamp, saved?.updatedAt)
        }
    }

    @Test
    fun `corrupted stored text loads as null without throwing`() {
        val store = FakeStore()
        store.map[SearchPreferencesRepository.keyFor("u_a")] = "{{{ broken"
        runBlocking {
            assertNull(repo(store).load("u_a"))
        }
    }

    @Test
    fun `storage read failures degrade to no cache`() {
        val store = FakeStore()
        store.readError = IllegalStateException("disk gone")
        runBlocking {
            assertNull(repo(store).load("u_a"))
        }
    }

    @Test
    fun `storage write failures are swallowed so search still works`() {
        val store = FakeStore()
        store.writeError = IllegalStateException("disk full")
        runBlocking {
            repo(store).save("u_a", prefs("SIN")) // 不抛异常即为通过
            assertNull(store.map[SearchPreferencesRepository.keyFor("u_a")])
        }
    }

    @Test
    fun `clear only removes the current namespace`() {
        val store = FakeStore()
        val repository = repo(store)
        runBlocking {
            repository.save("u_a", prefs("SIN"))
            repository.save("u_b", prefs("KUL"))
            repository.clear("u_a")
            assertNull(repository.load("u_a"))
            assertNotNull(repository.load("u_b"))
        }
    }

    @Test
    fun `saveForm persists the form through the shared mapper`() {
        val store = FakeStore()
        val repository = repo(store)
        val form = SearchFormState(
            departureDate = LocalDate.of(2026, 10, 16),
            minStopoverDays = 2,
            maxStopoverDays = 5,
            maxExtraPriceSgd = BigDecimal("88.80"),
            originSelectionSource = OriginSelectionSource.CURRENT_LOCATION,
        )
        runBlocking {
            repository.saveForm("u_a", form)
            val loaded = repository.load("u_a")
            assertEquals(LocalDate.of(2026, 10, 16), loaded?.departureDate)
            assertEquals(2, loaded?.minStopoverDays)
            assertEquals(5, loaded?.maxStopoverDays)
            assertEquals(BigDecimal("88.80"), loaded?.maxExtraPriceSgd)
            assertEquals(OriginSelectionSource.CURRENT_LOCATION, loaded?.originSelectionSource)
            // 5 天、周五：日期习惯信号一并落盘，供过期后滚动使用
            assertEquals(5, loaded?.preferredDepartureDayOfWeek)
        }
    }
}
