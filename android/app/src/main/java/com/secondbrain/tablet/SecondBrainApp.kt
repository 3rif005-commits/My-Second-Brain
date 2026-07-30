package com.secondbrain.tablet

import android.app.Application
import com.secondbrain.tablet.data.EmbeddingEngine
import com.secondbrain.tablet.data.NotesRepository

class SecondBrainApp : Application() {
    override fun onCreate() {
        super.onCreate()
        NotesRepository.init(this)
        EmbeddingEngine.init(this)
        // LlmService is started from MainActivity.onStart() to comply with
        // Android foreground-service restrictions (can't start from Application.onCreate).
    }
}
