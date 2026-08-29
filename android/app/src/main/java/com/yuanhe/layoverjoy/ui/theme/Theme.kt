package com.yuanhe.layoverjoy.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** 品牌色系（与产品原型 flight-monitor-app-ui.html 对齐）。 */
val BrandPrimary = Color(0xFF0C6D5D)
val BrandPrimaryDark = Color(0xFF074C42)
val BrandAccent = Color(0xFFF17350)
val BrandBackground = Color(0xFFF3EFE5)
val BrandSurface = Color.White
val BrandInk = Color(0xFF1F2A28)
val BrandInkSoft = Color(0xFF5F6F6B)
val BrandLine = Color(0xFFE5DFD2)
val BrandAmber = Color(0xFFD9A441)
val BrandDanger = Color(0xFFC0392B)

/** 卡片圆角 20dp、按钮圆角 15dp（原型规范）。 */
val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(15.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

val AppTypography = Typography(
    titleLarge = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Bold, color = BrandInk, lineHeight = 30.sp),
    titleMedium = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = BrandInk, lineHeight = 24.sp),
    titleSmall = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = BrandInk),
    bodyLarge = TextStyle(fontSize = 15.sp, color = BrandInk, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, color = BrandInk, lineHeight = 20.sp),
    bodySmall = TextStyle(fontSize = 12.sp, color = BrandInkSoft, lineHeight = 17.sp),
    labelLarge = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 11.sp, color = BrandInkSoft),
)
