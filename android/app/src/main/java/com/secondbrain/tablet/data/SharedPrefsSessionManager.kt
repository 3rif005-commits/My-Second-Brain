package com.secondbrain.tablet.data

import android.content.Context
import io.github.jan.supabase.gotrue.SessionManager
import io.github.jan.supabase.gotrue.user.UserSession
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class SharedPrefsSessionManager(context: Context) : SessionManager {

    private val prefs = context.getSharedPreferences("sb_auth", Context.MODE_PRIVATE)
    private val json  = Json { ignoreUnknownKeys = true }

    override suspend fun saveSession(userSession: UserSession) {
        prefs.edit()
            .putString("session", json.encodeToString(userSession))
            .apply()
    }

    override suspend fun loadSession(): UserSession? {
        val raw = prefs.getString("session", null) ?: return null
        return try { json.decodeFromString(raw) } catch (_: Exception) { null }
    }

    override suspend fun deleteSession() {
        prefs.edit().remove("session").apply()
    }

    companion object {
        fun saveEmail(context: Context, email: String) {
            context.getSharedPreferences("sb_auth", Context.MODE_PRIVATE)
                .edit().putString("last_email", email).apply()
        }

        fun loadEmail(context: Context): String =
            context.getSharedPreferences("sb_auth", Context.MODE_PRIVATE)
                .getString("last_email", "") ?: ""
    }
}
