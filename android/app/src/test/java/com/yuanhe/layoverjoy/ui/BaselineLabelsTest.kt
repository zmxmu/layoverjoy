package com.yuanhe.layoverjoy.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BaselineLabelsTest {
    @Test
    fun oneSegmentIsNonstop() {
        assertTrue(BaselineLabels.isNonstop(1))
        assertEquals("results.baseline_nonstop", BaselineLabels.titleKey(1))
        assertEquals("results.delta_up_nonstop", BaselineLabels.deltaUpKey(1))
    }

    @Test
    fun multiSegmentIsAReferenceNotNonstop() {
        assertFalse(BaselineLabels.isNonstop(2))
        assertEquals("results.baseline_best", BaselineLabels.titleKey(2))
        assertEquals("results.delta_up_best", BaselineLabels.deltaUpKey(2))
    }

    @Test
    fun unknownLegacySnapshotNeverClaimsNonstop() {
        assertFalse(BaselineLabels.isNonstop(0))
        assertEquals("results.baseline_best", BaselineLabels.titleKey(0))
    }
}
