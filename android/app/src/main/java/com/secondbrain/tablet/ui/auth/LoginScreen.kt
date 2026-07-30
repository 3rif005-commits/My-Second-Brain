package com.secondbrain.tablet.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.secondbrain.tablet.data.SharedPrefsSessionManager
import com.secondbrain.tablet.data.supabase
import com.secondbrain.tablet.ui.theme.Indigo500
import com.secondbrain.tablet.ui.theme.Indigo600
import io.github.jan.supabase.gotrue.auth
import io.github.jan.supabase.gotrue.providers.builtin.Email
import kotlinx.coroutines.launch

// Light theme colors matching the web auth pages
private val AuthBg     = Color(0xFFF9FAFB) // gray-50
private val CardBg     = Color.White
private val LabelColor = Color(0xFF374151) // gray-700
private val BorderDef  = Color(0xFFD1D5DB) // gray-300
private val TextColor  = Color(0xFF111827) // gray-900
private val SubText    = Color(0xFF6B7280) // gray-500
private val ErrorBg    = Color(0xFFFEF2F2) // red-50
private val ErrorText  = Color(0xFFDC2626) // red-600

@Composable
fun LoginScreen(onLoggedIn: () -> Unit) {
    val scope   = rememberCoroutineScope()
    val context = LocalContext.current

    // Toggle between sign-in and sign-up
    var isSignUp by remember { mutableStateOf(false) }

    // Fields — email pre-filled from last successful login
    var fullName by remember { mutableStateOf("") }
    var email    by remember { mutableStateOf(SharedPrefsSessionManager.loadEmail(context)) }
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }

    // State
    var loading by remember { mutableStateOf(false) }
    var error   by remember { mutableStateOf<String?>(null) }

    // Clear fields and error when switching mode
    fun switchMode() {
        isSignUp = !isSignUp
        error = null
        fullName = ""
        email = ""
        password = ""
    }

    fun submit() {
        if (loading) return
        if (email.isBlank() || password.isBlank()) { error = "Please fill in all required fields."; return }
        if (isSignUp && password.length < 8) { error = "Password must be at least 8 characters."; return }
        error = null
        scope.launch {
            loading = true
            try {
                if (isSignUp) {
                    supabase.auth.signUpWith(Email) {
                        this.email    = email.trim()
                        this.password = password
                    }
                } else {
                    supabase.auth.signInWith(Email) {
                        this.email    = email.trim()
                        this.password = password
                    }
                }
                // Remember the email for next time
                SharedPrefsSessionManager.saveEmail(context, email.trim())
                onLoggedIn()
            } catch (e: Exception) {
                error = when {
                    isSignUp -> e.message?.take(120) ?: "Sign up failed. Please try again."
                    else     -> e.message?.take(120) ?: "Sign in failed. Check your credentials."
                }
            } finally {
                loading = false
            }
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(AuthBg),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .widthIn(max = 400.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // ── Brand ─────────────────────────────────────────────────
            Box(
                Modifier
                    .size(52.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(
                        androidx.compose.ui.graphics.Brush.linearGradient(
                            listOf(Indigo600, Indigo500)
                        )
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text("🧠", fontSize = 26.sp)
            }
            Spacer(Modifier.height(16.dp))
            Text(
                "Second Brain",
                color = Color(0xFF111827),
                fontSize = 22.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                if (isSignUp) "Create your knowledge OS" else "Sign in to your knowledge OS",
                color = SubText,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(28.dp))

            // ── Card ──────────────────────────────────────────────────
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(CardBg)
                    .border(1.dp, Color(0xFFE5E7EB), RoundedCornerShape(12.dp))
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                // Full name (sign-up only)
                if (isSignUp) {
                    AuthField(
                        label = "Full name",
                        value = fullName,
                        onValueChange = { fullName = it },
                        placeholder = "Ada Lovelace",
                    )
                }

                // Email
                AuthField(
                    label = "Email",
                    value = email,
                    onValueChange = { email = it },
                    placeholder = "you@example.com",
                    keyboardType = KeyboardType.Email,
                )

                // Password
                AuthField(
                    label = "Password",
                    value = password,
                    onValueChange = { password = it },
                    placeholder = if (isSignUp) "Min. 8 characters" else "••••••••",
                    keyboardType = KeyboardType.Password,
                    isPassword = true,
                    showPassword = showPassword,
                    onTogglePassword = { showPassword = !showPassword },
                )

                // Error
                error?.let {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(ErrorBg)
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                    ) {
                        Text(it, color = ErrorText, fontSize = 13.sp)
                    }
                }

                // Submit button
                Button(
                    onClick = { submit() },
                    enabled = !loading,
                    modifier = Modifier.fillMaxWidth().height(42.dp),
                    shape = RoundedCornerShape(8.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Indigo600,
                        disabledContainerColor = Indigo600.copy(alpha = 0.5f),
                    ),
                ) {
                    if (loading) {
                        CircularProgressIndicator(
                            Modifier.size(18.dp),
                            color = Color.White,
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text(
                            if (isSignUp) "Create account" else "Sign in",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }
            }

            // ── Switch mode link ─────────────────────────────────────
            Spacer(Modifier.height(16.dp))
            Row(
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (isSignUp) "Already have an account? " else "No account? ",
                    color = SubText,
                    fontSize = 13.sp,
                )
                TextButton(
                    onClick = { switchMode() },
                    contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp),
                ) {
                    Text(
                        if (isSignUp) "Sign in" else "Sign up",
                        color = Indigo600,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
        }
    }
}

@Composable
private fun AuthField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    keyboardType: KeyboardType = KeyboardType.Text,
    isPassword: Boolean = false,
    showPassword: Boolean = false,
    onTogglePassword: (() -> Unit)? = null,
) {
    var focused by remember { mutableStateOf(false) }
    val borderColor = if (focused) Indigo500 else BorderDef
    val borderWidth = if (focused) 2.dp else 1.dp

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, color = LabelColor, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(Color.White)
                .border(borderWidth, borderColor, RoundedCornerShape(8.dp))
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                textStyle = TextStyle(color = TextColor, fontSize = 14.sp),
                cursorBrush = SolidColor(Indigo500),
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
                visualTransformation = if (isPassword && !showPassword)
                    PasswordVisualTransformation() else VisualTransformation.None,
                decorationBox = { inner ->
                    Box(Modifier.weight(1f)) {
                        if (value.isEmpty()) {
                            Text(placeholder, color = Color(0xFF9CA3AF), fontSize = 14.sp)
                        }
                        inner()
                    }
                },
                modifier = Modifier
                    .weight(1f)
                    .onFocusChanged { focused = it.isFocused },
            )
            if (isPassword && onTogglePassword != null) {
                IconButton(
                    onClick = onTogglePassword,
                    modifier = Modifier.size(20.dp),
                ) {
                    Icon(
                        if (showPassword) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = if (showPassword) "Hide password" else "Show password",
                        modifier = Modifier.size(18.dp),
                        tint = SubText,
                    )
                }
            }
        }
    }
}
