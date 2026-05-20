package com.secondbrain.tablet.ui.notes

import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.secondbrain.tablet.data.NotesRepository
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoteViewScreen(noteId: String, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }
    var htmlContent by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }

    LaunchedEffect(noteId) {
        try {
            val note = NotesRepository.getNote(noteId)
            title = note.title
            htmlContent = buildEditorHtml(NotesRepository.blocknoteToHtml(note.content))
        } finally {
            loading = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    OutlinedTextField(
                        value = title,
                        onValueChange = { title = it },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            unfocusedBorderColor = androidx.compose.ui.graphics.Color.Transparent,
                            focusedBorderColor = androidx.compose.ui.graphics.Color.Transparent,
                        ),
                        textStyle = MaterialTheme.typography.titleLarge,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back") }
                },
                actions = {
                    IconButton(onClick = {
                        scope.launch {
                            webViewRef?.evaluateJavascript("document.getElementById('editor').innerText") { text ->
                                scope.launch {
                                    val clean = text?.trim('"') ?: ""
                                    NotesRepository.updateNote(noteId, title, clean)
                                }
                            }
                        }
                    }) {
                        Icon(Icons.Default.Save, "Save")
                    }
                }
            )
        }
    ) { padding ->
        if (loading) {
            Box(Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.Center) {
                CircularProgressIndicator()
            }
        } else {
            AndroidView(
                factory = { ctx ->
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        webViewClient = WebViewClient()
                        webViewRef = this
                    }
                },
                update = { wv ->
                    if (wv.url == null) {
                        wv.loadDataWithBaseURL(null, htmlContent, "text/html", "UTF-8", null)
                        webViewRef = wv
                    }
                },
                modifier = Modifier.fillMaxSize().padding(padding)
            )
        }
    }
}

private fun buildEditorHtml(bodyHtml: String) = """
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, sans-serif; padding: 16px; font-size: 16px; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 1.8em; margin: 0.6em 0; }
  h2 { font-size: 1.4em; margin: 0.5em 0; }
  h3 { font-size: 1.2em; margin: 0.4em 0; }
  p  { margin: 0.4em 0; }
  li { margin: 0.2em 0; }
  #editor { outline: none; min-height: 200px; }
</style>
</head>
<body>
<div id="editor" contenteditable="true">$bodyHtml</div>
</body>
</html>
""".trimIndent()
