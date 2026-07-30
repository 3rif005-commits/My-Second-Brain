@file:OptIn(ExperimentalFoundationApi::class)

package com.secondbrain.tablet.editor.rich

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import com.secondbrain.tablet.editor.model.BlockState
import com.secondbrain.tablet.ui.theme.Indigo500

@Composable
fun StyledTextOverlay(
    block: BlockState,
    textStyle: TextStyle,
    modifier: Modifier = Modifier,
) {
    // derivedStateOf: recomputes only when block.textState.text / block.styles / block.mentions
    // actually change — not on every unrelated recomposition.  No toList() copies needed.
    val annotated: AnnotatedString by remember {
        derivedStateOf {
            val text = block.textState.text.toString()

            if (text.isEmpty() && block.styles.isEmpty() && block.mentions.isEmpty()) {
                return@derivedStateOf AnnotatedString("")
            }

            buildAnnotatedString {
                append(text)
                val len = text.length

                for (run in block.styles) {
                    val s = run.start.coerceIn(0, len)
                    val e = run.end.coerceIn(0, len)
                    if (s >= e) continue
                    if (run.styles.bold)   addStyle(SpanStyle(fontWeight = FontWeight.Bold),       s, e)
                    if (run.styles.italic) addStyle(SpanStyle(fontStyle  = FontStyle.Italic),      s, e)
                    val decorations = buildList {
                        if (run.styles.underline) add(TextDecoration.Underline)
                        if (run.styles.strike)    add(TextDecoration.LineThrough)
                    }
                    if (decorations.isNotEmpty()) {
                        addStyle(SpanStyle(textDecoration = TextDecoration.combine(decorations)), s, e)
                    }
                }

                for (mention in block.mentions) {
                    val s = mention.start.coerceIn(0, len)
                    val e = mention.end.coerceIn(0, len)
                    if (s >= e) continue
                    addStyle(
                        SpanStyle(
                            color      = Indigo500,
                            background = Indigo500.copy(alpha = 0.15f),
                        ),
                        s, e,
                    )
                }
            }
        }
    }

    BasicText(text = annotated, style = textStyle, modifier = modifier)
}
