# b量子阅读 ProGuard Rules
-keepattributes Signature
-keepattributes *Annotation*

# Retrofit
-keep class com.bquantum.bfastreader.data.model.** { *; }
-dontwarn retrofit2.**
-keep class retrofit2.** { *; }

# Gson
-keep class com.google.gson.** { *; }
-keepattributes EnclosingMethod
