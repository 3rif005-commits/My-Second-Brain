package com.secondbrain.tablet

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.view.WindowCompat
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.secondbrain.tablet.data.NotesRepository
import com.secondbrain.tablet.data.initSupabase
import com.secondbrain.tablet.data.supabase
import com.secondbrain.tablet.ui.auth.LoginScreen
import com.secondbrain.tablet.ui.main.MainScreen
import com.secondbrain.tablet.ui.theme.Gray900
import com.secondbrain.tablet.ui.theme.Indigo500
import com.secondbrain.tablet.ui.theme.LocalDarkTheme
import com.secondbrain.tablet.ui.theme.SecondBrainTheme
import io.github.jan.supabase.gotrue.SessionStatus
import io.github.jan.supabase.gotrue.auth
import kotlinx.coroutines.flow.StateFlow

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        initSupabase(applicationContext)
        NotesRepository.init(applicationContext)
        setContent {
            val ctx = applicationContext
            val prefs = remember { ctx.getSharedPreferences("app_prefs", Context.MODE_PRIVATE) }
            var isDark by remember { mutableStateOf(prefs.getBoolean("dark_theme", true)) }
            SecondBrainTheme(darkTheme = isDark) {
                androidx.compose.runtime.CompositionLocalProvider(LocalDarkTheme provides isDark) {
                    AppRoot(
                        onToggleTheme = {
                            isDark = !isDark
                            prefs.edit().putBoolean("dark_theme", isDark).apply()
                        },
                    )
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        // Start the LLM service here (activity is in foreground — foreground service allowed)
        try {
            val intent = Intent(this, LlmService::class.java).apply {
                putExtra("model_path", "/sdcard/Download/gemma-4-E2B-it-Q4_K_M.gguf")
            }
            startForegroundService(intent)
        } catch (_: Exception) {
            // Service start failed (model not present, etc.) — non-fatal, chat won't work
        }
    }
}

@Composable
private fun AppRoot(onToggleTheme: () -> Unit) {
    val statusFlow: StateFlow<SessionStatus> = supabase.auth.sessionStatus
    val status by statusFlow.collectAsState()

    var showMain by remember { mutableStateOf(false) }
    if (status is SessionStatus.Authenticated || status is SessionStatus.NetworkError) {
        showMain = true
    }

    android.util.Log.d("AppRoot", "status=${status::class.simpleName} showMain=$showMain")

    when {
        status is SessionStatus.LoadingFromStorage && !showMain -> SplashScreen()
        showMain -> MainScreen(
            onSignOut = { NotesRepository.clearUserCache(); showMain = false },
            onToggleTheme = onToggleTheme,
        )
        else -> LoginScreen(onLoggedIn = {})
    }
}

@Composable
private fun SplashScreen() {
    Box(
        Modifier.fillMaxSize().background(Gray900),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(color = Indigo500)
    }
}
