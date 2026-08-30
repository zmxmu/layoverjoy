package com.yuanhe.layoverjoy.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** P1-5：灵感卡预填必须覆盖旧搜索草稿（事件流语义）。 */
class SearchPrefillTest {
    @Test
    fun requestEmitsPendingAndConsumeClearsMatchingToken() {
        SearchPrefill.request("my-kuala-lumpur")
        val req = SearchPrefill.pending.value
        assertEquals("my-kuala-lumpur", req?.cityId)
        SearchPrefill.consume(req!!.token)
        assertNull(SearchPrefill.pending.value)
    }

    @Test
    fun laterRequestWinsOverStaleDraft() {
        SearchPrefill.request("hk-hong-kong") // 旧草稿来源
        SearchPrefill.request("my-kuala-lumpur") // 新点击必须覆盖
        val req = SearchPrefill.pending.value
        assertEquals("my-kuala-lumpur", req?.cityId)
        SearchPrefill.consume(req!!.token)
    }

    @Test
    fun consumeIgnoresNonMatchingToken() {
        SearchPrefill.request("th-bangkok")
        SearchPrefill.consume(999_999)
        assertEquals("th-bangkok", SearchPrefill.pending.value?.cityId)
        SearchPrefill.consume(SearchPrefill.pending.value!!.token)
    }
}
