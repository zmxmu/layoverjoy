# LayoverJoy release 混淆规则
-keepattributes *Annotation*, Signature, InnerClasses

# kotlinx.serialization
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.yuanhe.layoverjoy.**$$serializer { *; }
-keepclassmembers class com.yuanhe.layoverjoy.** { *** Companion; }
-keepclasseswithmembers class com.yuanhe.layoverjoy.** { kotlinx.serialization.KSerializer serializer(...); }

# Retrofit / OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn retrofit2.**
-keep class retrofit2.** { *; }
