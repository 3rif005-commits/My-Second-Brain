# LiteRT / MediaPipe
-keep class com.google.mediapipe.** { *; }
-keep class com.google.ai.edge.** { *; }
-dontwarn com.google.mediapipe.**

# Supabase / Ktor
-keep class io.github.jan.supabase.** { *; }
-keep class io.ktor.** { *; }
-dontwarn io.ktor.**

# Kotlinx serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class **$$serializer { *; }
-keepclassmembers @kotlinx.serialization.Serializable class ** { *** Companion; }
-keep @kotlinx.serialization.Serializable class ** { *; }

# TFLite
-keep class org.tensorflow.** { *; }
-dontwarn org.tensorflow.**

# PDFBox Android
-keep class com.tom_roush.pdfbox.** { *; }
-dontwarn com.tom_roush.pdfbox.**

# Compose — keep lambdas used in recomposition
-keepclassmembernames class * {
    @androidx.compose.runtime.Composable <methods>;
}

# Keep data classes used for Supabase JSON deserialization
-keep class com.secondbrain.tablet.data.** { *; }
