# ProGuard/R8 rules for release builds.
#
# Release builds currently run with isMinifyEnabled = false, so none of this is
# exercised yet. It exists so that turning minification on doesn't silently
# break the parts of the app the shrinker cannot see.

# Activities are referenced from AndroidManifest.xml by name only, and the
# container pool is additionally looked up reflectively-by-class in
# ProcessPool.activityForSlot.
-keep class com.claudecontainers.android.MainActivity { *; }
-keep class com.claudecontainers.android.ContainerActivity* { *; }
-keep class com.claudecontainers.android.SettingsActivity { *; }
-keep class com.claudecontainers.android.PhoenixActivity { *; }
-keep class com.claudecontainers.android.ClaudeApp { *; }

# RailView is inflated from XML by its fully-qualified name.
-keep class com.claudecontainers.android.RailView { *; }

# Keep line numbers so release stack traces stay readable.
-keepattributes SourceFile,LineNumberTable
