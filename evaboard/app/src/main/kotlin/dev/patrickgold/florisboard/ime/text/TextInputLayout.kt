/*
 * Copyright (C) 2021-2025 The FlorisBoard Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package dev.patrickgold.florisboard.ime.text

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.isSpecified
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.LayoutDirection
import dev.patrickgold.florisboard.R
import dev.patrickgold.florisboard.app.FlorisPreferenceStore
import dev.patrickgold.florisboard.ime.smartbar.IncognitoDisplayMode
import dev.patrickgold.florisboard.ime.smartbar.InlineSuggestionsStyleCache
import dev.patrickgold.florisboard.ime.eva.EvaSpaceCursor
import dev.patrickgold.florisboard.ime.eva.EvaTopRowUi
import dev.patrickgold.florisboard.ime.keyboard.FlorisImeSizing
import dev.patrickgold.florisboard.ime.smartbar.CandidatesRow
import dev.patrickgold.florisboard.ime.smartbar.quickaction.QuickActionsOverflowPanel
import dev.patrickgold.florisboard.ime.text.keyboard.TextKeyboardLayout
import dev.patrickgold.florisboard.ime.theme.FlorisImeUi
import dev.patrickgold.florisboard.keyboardManager
import dev.patrickgold.jetpref.datastore.model.observeAsState
import org.florisboard.lib.snygg.ui.SnyggIcon
import org.florisboard.lib.snygg.ui.rememberSnyggThemeQuery

@Composable
fun TextInputLayout(
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val keyboardManager by context.keyboardManager()

    val prefs by FlorisPreferenceStore

    val state by keyboardManager.activeState.collectAsState()
    val evaluator by keyboardManager.activeEvaluator.collectAsState()

    InlineSuggestionsStyleCache()

    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
        Box(
            modifier = modifier
                .fillMaxWidth()
                .wrapContentHeight(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .wrapContentHeight(),
            ) {
                // evaBoard: its own top row (digits, undo / redo / suggestions, or the tools) replaces
                // FlorisBoard's Smartbar
                EvaTopRowUi()
                if (state.isActionsOverflowVisible) {
                    QuickActionsOverflowPanel()
                } else {
                    Box {
                        val incognitoDisplayMode by prefs.keyboard.incognitoDisplayMode.observeAsState()
                        val showIncognitoIcon = evaluator.state.isIncognitoMode &&
                            incognitoDisplayMode == IncognitoDisplayMode.DISPLAY_BEHIND_KEYBOARD
                        if (showIncognitoIcon) {
                            SnyggIcon(
                                FlorisImeUi.IncognitoModeIndicator.elementName,
                                modifier = Modifier
                                    .matchParentSize()
                                    .align(Alignment.Center),
                                painter = painterResource(R.drawable.ic_incognito),
                            )
                        }
                        TextKeyboardLayout(evaluator = evaluator)
                    }
                }
            }
            // evaBoard: while the held space bar steers the caret, the keys give way to a blank surface
            // (just the ground, no letters) so the whole keyboard reads as a trackpad. The finger already
            // owns the gesture, so this cover is purely visual and takes no touches of its own.
            val cursorDragging by EvaSpaceCursor.dragging.collectAsState()
            if (cursorDragging) {
                val ground = rememberSnyggThemeQuery("eva-ground").background()
                    .takeIf { it.isSpecified }?.copy(alpha = 1f) ?: Color(0xFF1C1C1E)
                Box(modifier = Modifier.matchParentSize().background(ground))
            }
        }
    }
}
