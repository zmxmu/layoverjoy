package com.yuanhe.layoverjoy.data

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * requiredDocuments string-or-object 兼容反序列化（防止旧/新/混合快照导致详情页崩溃）。
 */
class RequiredDocumentsParsingTest {

    private val json = Json { ignoreUnknownKeys = true }

    private fun parseEligibility(requiredDocuments: String): EligibilityDetailDto =
        json.decodeFromString(
            EligibilityDetailDto.serializer(),
            """{"status":"ELIGIBLE","requiredDocuments":$requiredDocuments}""",
        )

    @Test
    fun `new object array parses`() {
        val dto = parseEligibility(
            """[{"code":"PASSPORT_VALID_6_MONTHS","mandatory":true,"descriptionZh":"护照剩余有效期至少六个月","descriptionEn":"Passport valid for at least six months","factPaths":["traveler.passport.expiryDate"]}]""",
        )
        assertEquals(1, dto.requiredDocuments.size)
        val doc = dto.requiredDocuments[0]
        assertEquals("PASSPORT_VALID_6_MONTHS", doc.code)
        assertTrue(doc.mandatory)
        assertEquals("Passport valid for at least six months", doc.descriptionEn)
        assertEquals(listOf("traveler.passport.expiryDate"), doc.factPaths)
    }

    @Test
    fun `legacy string array parses`() {
        val dto = parseEligibility("""["CONFIRMED_ONWARD_TICKET","ACCOMMODATION_OR_ADDRESS"]""")
        assertEquals(2, dto.requiredDocuments.size)
        assertEquals("CONFIRMED_ONWARD_TICKET", dto.requiredDocuments[0].code)
        assertTrue(dto.requiredDocuments[0].mandatory)
    }

    @Test
    fun `null and empty array parse`() {
        val empty = json.decodeFromString(EligibilityDetailDto.serializer(), """{"status":"ELIGIBLE"}""")
        assertEquals(0, empty.requiredDocuments.size)
        val explicit = parseEligibility("[]")
        assertEquals(0, explicit.requiredDocuments.size)
    }

    @Test
    fun `mixed string and object array parses`() {
        val dto = parseEligibility("""["ONWARD_TICKET",{"code":"MDAC","mandatory":false}]""")
        assertEquals(2, dto.requiredDocuments.size)
        assertEquals("ONWARD_TICKET", dto.requiredDocuments[0].code)
        assertEquals(false, dto.requiredDocuments[1].mandatory)
    }

    @Test
    fun `unknown fields do not fail`() {
        val dto = parseEligibility(
            """[{"code":"NEW_CODE","mandatory":true,"brandNewField":{"nested":true},"descriptionEn":"New requirement"}]""",
        )
        assertEquals("NEW_CODE", dto.requiredDocuments[0].code)
        assertEquals("New requirement", dto.requiredDocuments[0].descriptionEn)
    }
}
