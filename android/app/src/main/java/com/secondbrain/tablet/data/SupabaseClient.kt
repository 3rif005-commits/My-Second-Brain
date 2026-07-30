package com.secondbrain.tablet.data

import android.content.Context
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.gotrue.Auth
import io.github.jan.supabase.postgrest.Postgrest

const val SUPABASE_URL     = "https://esfhsdukyhyrlgzflsad.supabase.co"
const val SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzZmhzZHVreWh5cmxnemZsc2FkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNDM3MDMsImV4cCI6MjA5MTgxOTcwM30.M7Mb_FRkKZs9eIqM01mFFZ2pt38pZQZNRkNKSMYYhm0"

lateinit var supabase: SupabaseClient
    private set

fun initSupabase(context: Context) {
    if (::supabase.isInitialized) return
    supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY) {
        install(Auth) {
            sessionManager = SharedPrefsSessionManager(context.applicationContext)
        }
        install(Postgrest)
    }
}
