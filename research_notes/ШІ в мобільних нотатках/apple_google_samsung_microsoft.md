# AI in mobile built-in / big-platform note apps: Apple Notes, Google Keep, Samsung Notes, Microsoft OneNote, Evernote (state as of ~Oct 2026)

Method note: many Apple/Evernote/Microsoft primary pages returned truncated or 403 to the fetch tool; where a claim rests only on a search-result summary or a secondary article it is labelled (secondary) or (unverified). Dates: today is 2026-10-21. Everything below is MOBILE (phone/tablet) unless explicitly marked DESKTOP.

## 1. Where exactly is the AI entry point on the mobile screen? (one tap or buried?)

### Takeaway
Samsung and Apple put AI at the point of editing (an icon above the keyboard / in the selection menu), so it is 1-2 taps; Google Keep's AI is a small "Help me create a list" button on the create-note screen and otherwise lives outside Keep (the Gemini app); OneNote's phone Copilot is a chat pane that is still mid-rollout; Evernote's mobile AI Assistant is a floating button. Apple is in the middle of changing its entry point (Writing Tools in iOS 18-26, "Write with Siri" in iOS 27).

### Cited Findings
**Apple Notes (iPhone/iPad)**
- Writing Tools: select text, then tap "Writing Tools" above the keyboard or in the selection menu. — [MacRumors iOS 18 Notes guide](https://macrumors.com/guide/ios-18-notes-app)
- Apple's iPad guide gives the same two paths: select text, tap the menu, then Writing Tools; tip: there is also an icon at the top-right corner of the keyboard. — [Apple Support, iPad (as quoted via search summary; page body truncated on fetch)](https://support.apple.com/en-hk/guide/ipad/ipad04c3f67f/ipados)
- Audio: in a note tap the paperclip/Attachments button, then "Record Audio"; the Transcription button shows the transcript; Apple Intelligence summary appears via a "Summary" control on the recording. — [MacRumors](https://macrumors.com/guide/ios-18-notes-app); [Apple Support search summary](https://support.apple.com/guide/iphone/record-and-transcribe-audio-iphbe11247b5/ios)
- Math Notes: not a button; you type an expression with "=" in a note (also available from the small calculator button in the Calculator app, notes land in a "Math Notes" folder in Notes). — [MacRumors](https://macrumors.com/guide/ios-18-notes-app); [Stuff/How-To Geek summaries](https://tech.yahoo.com/computing/articles/math-notes-iphone-ipad-mac-150012760.html)
- iOS 27 (beta, then fall 2026): a persistent "Write with Siri" button sits above the keyboard in Notes, Mail, Messages and others; in beta 1 it was reachable only after selecting text and was hard to find, a visible button was added in beta 2 (June 22, 2026). — [iThinkDiff, 27 Jun 2026](https://www.ithinkdiff.com/apple-notes-features-ios-27-markdown-links-ai/)
- iOS 27 Siri AI can create/update notes from the Siri conversation ("Add today's action items from Slack to my project planning note"). — [iGeeksBlog, updated 15 Sep 2026](https://www.igeeksblog.com/ios-27-apple-notes-features/)

**Google Keep (Android; Gemini app)**
- "Help me create a list": open Keep, tap Create (new-note "+"), then bottom-right "Help me create a list". — [Google Keep Help](https://support.google.com/keep/answer/15222789?hl=en)
- "Generate title": open a note on Pixel/Android and tap "Generate title" (works for a note with a few words and no title). — [Google Keep Help](https://support.google.com/keep/answer/14626262?hl=en)
- The other route is outside Keep: ask the Gemini app/assistant to create, show or add to Keep notes/lists; requires "Keep Activity" on and Workspace/Keep connection in Gemini settings. — [Gemini Help via search summary](https://support.google.com/gemini/answer/15230597); [shattered.io (secondary)](https://shattered.io/gemini-hits-8-note-apps-pressures-samsung-notes-2026/)

**Samsung Notes (Galaxy, One UI 6.1+)**
- Open a note, tap the "Notes assist" icon (three stars) above the keyboard; for handwriting there is a separate "Clean up handwriting" icon (pencil with a wand) at the bottom of the screen after writing with S Pen. — [Samsung US support: Note Assist](https://www.samsung.com/us/support/answer/ANS10000941)

**Microsoft OneNote (iPhone/Android)**
- Phone Copilot is a "Copilot chat pane" in OneNote for iPhone that summarizes long pages and answers questions about notes; the Message Center text does not say how the pane is opened (only screenshots). — [Microsoft Message Center MC1307979](https://mc.merill.net/message/MC1307979)
- Voice notes -> structured summary on OneNote mobile (Android roadmap item RM422321); multimodal capture (audio+images+typed) into a "Copilot Notebook"/Copilot Page on iPhone and Android. — [Merill RM422321](https://mc.merill.net/message/RM422321); [HandsOnTek, iPhone](https://m365admin.handsontek.net/onenote-multimodal-capture-copilot-notebooks-iphone/); [HandsOnTek, Android](https://m365admin.handsontek.net/onenote-multimodal-capture-copilot-notebooks-android/)
- Microsoft is removing note creation from the Microsoft 365 Copilot mobile app; existing notes move to the OneNote app. — [Microsoft Support](https://support.microsoft.com/en-gb/topic/notes-to-be-retired-from-the-microsoft-365-copilot-mobile-app-ebaa64c3-15c5-4a8d-8360-4398e6652277)
- DESKTOP contrast: the Copilot button in the OneNote ribbon; on iPad it can be greyed out for locally-stored notebooks or outdated app. — [WPS guide (secondary)](https://www.wps.com/office-quick-solution/copilot-issues/how-to-fix-copilot-disabled-in-onenote-on-ipad/)

**Evernote (v11)**
- Release notes: "Fixed an issue where the AI Assistant button could overlap the editor status indicator" (v11.32.5) — implies a floating AI button near the editor. Platform not named. — [Releasebot Evernote](https://releasebot.io/updates/evernote)
- Evernote help article (via search summary): in desktop/web the assistant opens from a button in the lower-right corner. The same snippet said mobile was "not yet supported", which is contradicted by later sources below (that help snippet is probably older). — [Evernote Help: AI Assistant](https://help.evernote.com/hc/en-us/articles/46319409880211-AI-Assistant) (page itself 403 on fetch)
- AI Prompts run by typing "/" in a note. — [App Store listing](https://apps.apple.com/md/app/evernote-ai-notes-organizer/id281796108)

### Inferences
- Samsung is the clearest "AI at the keyboard" pattern (one icon on the editing toolbar, no menu digging). Apple is equally close for selection-based tasks (Writing Tools in keyboard/selection menu) but recording summaries are one extra tap on the audio attachment.
- Keep is the buried case: AI is a conditional button on the create screen, not part of the note editor; most "AI over notes" for Keep is done from the Gemini app.
- Apple's entry point is unstable across versions (Writing Tools -> Write with Siri), so a design reference should cite the iOS version.

### Gaps
- No primary Apple page text retrieved for the iPhone Writing Tools screens (fetch truncated); exact current (iOS 26/27 final) layout of the Writing Tools / Write with Siri panel is unverified.
- How the OneNote iPhone Copilot pane is opened is not documented in the sources I could read.
- No Samsung/Evernote screenshots reviewed; Evernote mobile button location is inferred only from a release-note fix.

## 2. What can AI do on mobile in each app?

### Takeaway
Apple and Samsung offer text transformation on a selection/note (rewrite, summarize, list/table or headers/bullets, proofread, translate); Keep offers only list generation and title generation in-app; OneNote phone Copilot is chat/summary/voice capture; Evernote's Assistant is the closest to a general chat-over-notes agent on phone.

### Cited Findings
**Apple Notes**
- Writing Tools: proofread (spelling, grammar, word choice, structure); rewrite in tones Friendly / Professional / Concise; summarize as paragraph, key points, list, or table; "Describe your change" free-text rewrite. — [MacRumors](https://macrumors.com/guide/ios-18-notes-app); [Apple Support (Mac/iPad, via search summaries)](https://support.apple.com/guide/mac-help/mchldcd6c260)
- Summary produces a single paragraph; Key Points a bulleted shortened list; List only reformats into bullets without shortening; Table reformats into a table. — [Tom's Guide (via search summary)](https://www.tomsguide.com/phones/iphones/how-to-use-apple-intelligence-writing-tools)
- Audio recording with live transcription (iPhone 12+, originally English only) and Apple Intelligence summary of recording/call transcript (iPhone 15 Pro+). — [MacRumors](https://macrumors.com/guide/ios-18-notes-app)
- Math Notes: type an equation + "=" and get the result; variables persist across the note (dinner = $42 ...), unit conversions work; handwriting on iPad with Pencil. Not generative AI in the LLM sense, but marketed alongside. — [MacRumors](https://macrumors.com/guide/ios-18-notes-app)
- Apple's Mac help says text can be rewritten by a description ("Make this more enthusiastic") and has retry/revert; Writing Tools also reachable in third-party apps. — [Apple Support Mac](https://support.apple.com/guide/mac-help/mchldcd6c260); [Apple newsroom](https://www.apple.com/newsroom/2024/10/apple-intelligence-is-available-today-on-iphone-ipad-and-mac/)
- iOS 27 beta: Siri AI writes into new/existing notes from conversation; web-sourced notes on iPhone 15 Pro+; "Write with Siri" lets you generate/proofread/restyle in natural language. — [iThinkDiff](https://www.ithinkdiff.com/apple-notes-features-ios-27-markdown-links-ai/); [iGeeksBlog](https://www.igeeksblog.com/ios-27-apple-notes-features/)
- Claim (secondary, from 9to5Mac beta-2 coverage via search summary, not read directly): the old Writing Tools panel with "Friendly/Professional" buttons was removed in iOS 27 and replaced by Write with Siri. Needs verification against final iOS 27. — [search summary referencing 9to5Mac](https://9to5mac.com/?p=1057818)
- Apple's own requirements page (listing OS 27) still lists "Writing Tools" under iOS 26 and later and says automatic proofreading is an iOS 27 feature. — [Apple Support: How to get Apple Intelligence](https://support.apple.com/en-qa/121115)

**Google Keep**
- In-app: generate a list from a prompt (e.g. "Groceries for a week for a vegetarian family of 3"); generate a title for an untitled note. Stated "currently available only on Android". — [Keep Help 14626262](https://support.google.com/keep/answer/14626262?hl=en); [Keep Help 15222789](https://support.google.com/keep/answer/15222789?hl=en)
- Via Gemini app extension: create and show notes/lists, add items to existing lists; Keep help does not confirm a "summarize this note" action. — [Gemini Help](https://support.google.com/gemini/answer/15230597)
- Voice dictation into Keep is listed among AI-plan perks (AI Plus, Pro, Ultra). — [Google blog, fall 2026 AI plan updates](https://blog.google/products-and-platforms/products/google-one/fall-2026-ai-plan-updates/) (via search snippet)
- Secondary: Gemini can find and delete Keep notes and works by voice; Keep's AI is "quick capture/reorganizing", not heavy document work. — [shattered.io, 17 Oct 2026 update](https://shattered.io/gemini-hits-8-note-apps-pressures-samsung-notes-2026/)

**Samsung Notes**
- Auto format (Headers and bullets, or Meeting notes), Summarize (Standard or Detailed), Correct spelling and grammar, Translate (also PDFs); handwriting: Clean up handwriting -> Convert to text, Align handwriting (straighten, align letters, even spacing, fix letter shape). — [Samsung US support](https://www.samsung.com/us/support/answer/ANS10000941)
- Auto format and Summarize support about 40 languages. — [Samsung US support](https://www.samsung.com/us/support/answer/ANS10000941)
- Also Math Solver for handwritten/typed equations and voice transcription (secondary). — [shattered.io](https://shattered.io/gemini-hits-8-note-apps-pressures-samsung-notes-2026/)

**OneNote**
- iPhone chat pane: concise summaries of long pages, Q&A about notes; only over content the user can access; existing Copilot permissions apply. — [MC1307979](https://mc.merill.net/message/MC1307979)
- Voice recordings turned into structured summaries/plans of action (announced 2025; Android GA target moved to June 2026). — [Merill RM422321](https://mc.merill.net/message/RM422321); [Yahoo/How-To Geek](https://tech.yahoo.com/apps/articles/copilot-invading-onenote-mobile-apps-143522090.html)
- Multimodal capture (audio, images, typed text in one session) into a Copilot Page; sources conflict on status (iPhone: GA vs preview/April 2026; Android: preview, Sept 2026 target). — [HandsOnTek iPhone](https://m365admin.handsontek.net/onenote-multimodal-capture-copilot-notebooks-iphone/); [HandsOnTek Android](https://m365admin.handsontek.net/onenote-multimodal-capture-copilot-notebooks-android/)
- No source found describing rewrite-selection, table-making or image generation in OneNote mobile.

**Evernote**
- AI Assistant (chat) drafts, edits, summarizes, answers from note content; writing cleanup (tone, clarity, structure); AI Transcribe (images, files, handwriting, audio -> text); semantic search; AI meeting notes. — [App Store listing](https://apps.apple.com/md/app/evernote-ai-notes-organizer/id281796108)
- "Edit" and "Ask" modes introduced in v11.27.5; Assistant can create/open notes in Edit mode, insert uploaded images into a note, create/manage events, pin notes, manage stacks, rename attachments (with review before applying), regenerate recording summary; Evernote MCP. — [Releasebot](https://releasebot.io/updates/evernote)
- Evernote's H1-2026 post (via Releasebot): "The AI Assistant, including AI Prompts and AI Memory, is now available on mobile." — [Releasebot](https://releasebot.io/updates/evernote)
- App Store "What's New": AI Assistant reached mobile in 11.23.2 (June 30), Edit mode on mobile in 11.36.3. (Version numbers in the App Store text are internally inconsistent with Releasebot's ordering, treat as unreliable.) — [App Store listing](https://apps.apple.com/md/app/evernote-ai-notes-organizer/id281796108)
- Jan 2026 v11 press release: AI Assistant, Semantic Search, AI Meeting Notes; German version says at launch the Assistant was desktop+web only, search and meeting notes also mobile. — [BusinessWire EN](https://www.businesswire.com/news/home/20260119103272/en) (403 on fetch; read via search summary); [BusinessWire DE](https://www.businesswire.com/news/home/20260119165690/de)

### Inferences
- Only Apple and Samsung (and Evernote's Edit mode) transform text in place; Keep and OneNote are generate/summary-oriented.
- "Chat over all notes" on phone exists in Evernote (confirmed), OneNote (pane over a page, Premium license), Keep (only through Gemini app, over Keep content via extension).

### Gaps
- Exact mobile feature parity vs desktop for Evernote is not documented in a source I could read.
- Whether Apple Notes' final iOS 27 retains the Rewrite tone buttons is unverified.

## 3. How a suggestion is shown, accepted and undone (diff / replace / insert / versions / undo)

### Takeaway
Apple's model is a preview panel with Replace / Copy (/ Share), plus Original / Revert / Rewrite-again for rewrites; Samsung's is a result panel with Copy / Replace / Add to (new page before / new note) and, for handwriting, swipe-to-compare; Keep's is a preview with Insert only (not editable, only re-promptable); Evernote's Edit mode applies changes with a review step for some actions; OneNote phone is chat output (no documented insert flow).

### Cited Findings
- Apple (summary): single-paragraph summary shown with Copy, Replace, Share; Replace is hidden when text cannot be edited. — [iPhone Life](https://iphonelife.com/content/how-to-use-summarize-writing-tools); [Apple Support Mac](https://support.apple.com/guide/mac-help/mchldcd6c260)
- Apple (rewrite, iPad guide via search summary): "Describe your change" field; Rewrite = try again; Original = switch to see the original text; Revert = discard edits. — [Apple Support iPad](https://support.apple.com/en-hk/guide/ipad/ipad04c3f67f/ipados)
- Apple: for Proofread the changed text is applied with a suggestion/explanation view (not verified here; no source read) — see Gaps.
- Samsung: Auto format, Summarize, Spelling, Translate return Copy (clipboard), Replace (replaces the note's content), Add to (New page before, or New note). The page describes no undo. — [Samsung US support](https://www.samsung.com/us/support/answer/ANS10000941)
- Samsung handwriting: result pop-up, swipe right to compare with original handwriting, tap "Add to" to insert. — [Samsung US support](https://www.samsung.com/us/support/answer/ANS10000941)
- Keep: after generation you can thumbs-up/down, edit prompt and Refresh, or tap Insert; list cannot be edited in the preview (only the prompt). — [Keep Help](https://support.google.com/keep/answer/15222789?hl=en); [Android Central (via search summary)](https://androidcentral.com/apps-software/how-to-use-google-keep-to-help-me-create-a-list)
- Evernote: AI Assistant can rename an attachment/recording and "you can review the change before it's applied" (v11.38.5); a fix prevented overwriting transcriptions in Edit mode (v11.28.2) — i.e. Edit mode writes into notes directly. — [Releasebot](https://releasebot.io/updates/evernote)
- OneNote iPhone: Copilot pane output is summaries/answers; no documented accept/insert behaviour. — [MC1307979](https://mc.merill.net/message/MC1307979)

### Inferences
- Nobody on mobile shows a true inline word-level diff in the sources I could read; the dominant pattern is "preview card with explicit Replace / Copy / Add" (Apple, Samsung), which keeps the original untouched until a deliberate tap.
- Samsung's "Add to: New page before" is a safe non-destructive accept; Apple's Original/Revert is the in-place undo.

### Gaps
- Apple Proofread UI on iPhone (suggestion list / inline underlines) not confirmed from a primary source.
- Samsung undo behaviour after Replace not documented; Evernote Edit-mode undo/version history not documented in the sources read.
- OneNote: no source on accept/insert on phone.

## 4. How AI can be turned off or hidden on mobile

### Takeaway
Apple and Samsung allow system-level off switches (Apple: global toggle or Screen Time per-feature; Samsung: per-feature toggles in Settings > Galaxy AI). Keep has Keep Activity as a connection gate. OneNote/Evernote: no clear per-user off switch documented (OneNote is license-gated; Evernote users ask for one).

### Cited Findings
- Apple: Settings > Apple Intelligence & Siri > toggle off disables all Apple Intelligence incl. Writing Tools; Screen Time > Content & Privacy Restrictions > Intelligence & Siri lets you set Writing Tools to Don't Allow (removes related icons/menu items). One mirrored Proton article says there is no standalone Writing Tools toggle — conflicts with the Screen Time route; verify. — [BGR](https://bgr.com/tech/how-to-turn-off-apple-intelligence/); [iGeeksBlog](https://www.igeeksblog.com/turn-off-apple-intelligence-on-iphone-ipad-mac); [PopSci](https://www.popsci.com/diy/how-to-turn-off-apple-intelligence/)
- Samsung: Settings > Galaxy AI > toggle features off one by one; optional "Process Data Only On Device"; check Samsung Notes app settings too. Samsung's Note Assist page itself does not explain disabling. — [Android Police via Yahoo](https://tech.yahoo.com/ai/articles/turned-off-every-ai-tool-214010628.html); [Samsung US support](https://www.samsung.com/us/support/answer/ANS10000941)
- Google: Gemini access to Keep is gated by "Keep Activity" being on; without it Gemini cannot connect to Keep. The Keep help page doesn't describe turning Keep's own "Help me create a list" off. — [Gemini Help](https://support.google.com/gemini/answer/15230597); [Keep Help](https://support.google.com/keep/answer/14626262?hl=en)
- Microsoft: Copilot in OneNote is tied to license and privacy settings; unlicensed users "are not impacted" by the phone chat pane. — [MC1307979](https://mc.merill.net/message/MC1307979)
- Evernote: a r/Evernote post (June 2026, via mirror) complains the mobile UI keeps pushing AI suggestions even with a usage cap and wants to turn them off. — [r/Evernote mirror](https://r.datuan.dev/r/Evernote) (single anecdote)

### Inferences
- Because AI is license- or plan-gated at OneNote/Keep, "off" is largely "don't pay / don't have it".
- Users actively seek a per-app off switch (Evernote, Samsung author article), which supports offering a visible toggle in a new app.

### Gaps
- No documented way to hide only the Apple "Summary" on a recording, or to remove the keyboard Writing Tools button, found.
- No documented off switch for Evernote AI or OneNote mobile Copilot beyond licensing found.

## 5. Price, limits, required devices

### Takeaway
Apple: free but needs iPhone 15 Pro+ and up to ~8-14 GB storage. Samsung: free "basic" Galaxy AI on supported flagships, 200-4,000 characters, Samsung account + internet. Google: Keep list generation needs a Google AI plan or Pixel. Microsoft: Copilot (Premium) license. Evernote: paid tiers.

### Cited Findings
- Apple Intelligence: iPhone 16 and later, 15 Pro/Pro Max, iPhone Air, 17 series (current page, OS 27 era); storage up to 8 GB (up to 14 GB on 17 Pro/Air); device and Siri language must match; languages include English, German, French, Spanish, Japanese, Korean, Chinese, etc. — [Apple Support 121115](https://support.apple.com/en-qa/121115)
- Earlier: iPhone 15 Pro and later, iOS 18.1+, 7 GB free storage. — [Apple Support via search summary](https://support.apple.com/en-qa/121115)
- Samsung: One UI 6.1+, Android 14+, Samsung account, internet; note text 200-4,000 characters; Galaxy AI basic features free, enhanced/third-party "different terms, may have fees". — [Samsung US support](https://www.samsung.com/us/support/answer/ANS10000941)
- Samsung device gaps: Galaxy Tab S10 FE lacks Note Assist; a Samsung moderator confirmed. — [Samsung Community](https://us.community.samsung.com/t5/Tablets/Missing-Galaxy-AI-amp-Note-Taking-Features/m-p/3589945)
- Google Keep: "You need a Google AI plan to create lists with Gemini in Keep. 'Help me create a list' is available on Pixel devices. Usage may be subject to Gemini usage limits." Another Keep page: needs Google AI Pro/Ultra or a Pixel. (The two help pages differ slightly.) — [Keep Help 15222789](https://support.google.com/keep/answer/15222789?hl=en); [Keep Help 14626262](https://support.google.com/keep/answer/14626262?hl=en)
- Google: voice in Keep available with AI Plus, Pro and Ultra. — [Google blog](https://blog.google/products-and-platforms/products/google-one/fall-2026-ai-plan-updates/) (search snippet)
- 2024 history: "Help me create a list" free on Pixel; other Android needed Google One AI Premium or Workspace Labs. — [9to5Google, Aug 2024](https://9to5google.com/2024/08/22/google-keep-help-me-create-list-ai-rollout/)
- Microsoft: OneNote iPhone Copilot chat pane requires a Microsoft 365 Copilot (Premium) license; GA rollout moved repeatedly, latest read: end of Oct 2026 (published 12 May 2026, updated 30 Sep 2026). — [MC1307979](https://mc.merill.net/message/MC1307979)
- Microsoft: multimodal capture requires a Microsoft 365 Copilot license plus SharePoint/OneDrive license. — [itelio MC1275566](https://www.itelio.com/en/microsoft-message-center/MC1275566)
- Evernote: App Store lists tiers around $17-19/month (Plus $17, Premium $19, Personal $17.99) with duplicates/unclear periods; other 2026 sources give Personal $14.99/month or $129.99/yr, and a tracker claims Starter $8.25/month from 1 Jan 2026 — conflicting. Free plan: 50 notes, one notebook. AI described as for paid users, AI usage appears capped. — [App Store](https://apps.apple.com/md/app/evernote-ai-notes-organizer/id281796108); [eesel pricing](https://www.eesel.ai/blog/evernote-pricing); [PricingSaaS](https://pricingsaas.com/companies/evernote/diffs/2025Q4)

### Inferences
- Apple/Samsung "free but hardware-gated" vs Google/Microsoft/Evernote "subscription-gated" is the main commercial split; hardware gating produces the common "missing AI button" complaint.

### Gaps
- Consumer (non-enterprise) OneNote mobile Copilot access via Microsoft 365 Personal/Family/Premium not confirmed by any source read.
- Evernote official current prices and AI usage caps not confirmed (help/pricing pages 403).

## 6. User complaints and praise about the mobile AI UX

### Takeaway
Praise centres on speed and low friction (Math Notes, Notes summaries, Samsung auto-format); complaints are about availability (hardware/plan gating), vague/delayed rollouts (OneNote), shallow capability (Keep), and mixed quality for Apple Writing Tools.

### Cited Findings
- Apple: Math Notes called the most notable Apple Intelligence feature by one review, contrasted with weaker Writing Tools; Writing Tools "don't break new ground compared to ChatGPT or Grammarly", summarization struggles on larger documents (secondary, early 2025 reviews). — [Counterpoint review](https://www.counterpointresearch.com/insight/post-insight-apple-intelligence-review-part-1-writing-and-summarization-shine-but-notification-handling-needs-smarts) (via search summary)
- Apple: TechRadar columnist says Writing Tools "seriously improved the Notes app" after months of use (headline only; body not read). — [TechRadar](https://www.techradar.com/computing/artificial-intelligence/ive-used-apple-intelligence-writing-tools-for-months-and-it-has-seriously-improved-the-notes-app-heres-how-to-use-it)
- Apple iOS 27: Write with Siri was "hard to find" in beta 1 because it only appeared after selecting text; a visible button was added. — [iThinkDiff](https://www.ithinkdiff.com/apple-notes-features-ios-27-markdown-links-ai/)
- Samsung: users who turned Note Assist off said "I was back to manually organizing every to-do list and bullet point" (praise by absence). — [Android Police via Yahoo](https://tech.yahoo.com/ai/articles/turned-off-every-ai-tool-214010628.html)
- Samsung: Tab S10 FE buyer complained promo materials implied Note Assist, which the tablet lacks. — [Samsung Community](https://us.community.samsung.com/t5/Tablets/Missing-Galaxy-AI-amp-Note-Taking-Features/m-p/3405135)
- Samsung vs Keep (secondary comparison): Keep stronger for fast conversational list-building and voice capture; Samsung Notes stronger for document work, PDF markup, S Pen, translation, equations. — [shattered.io](https://shattered.io/gemini-hits-8-note-apps-pressures-samsung-notes-2026/)
- Keep: privacy caution that human reviewers might see prompts (2024 coverage); users cannot edit the preview. — [Android Central via search summary](https://androidcentral.com/apps-software/google-keep-android-testing-help-me-create-a-list)
- OneNote: Copilot button greyed-out/absent on iPad despite licence; tapping OneNote in Teams mobile prompts to install the Copilot app; mobile Copilot features repeatedly delayed (e.g. Android voice GA moved to June 2026). — [Microsoft Q&A](https://learn.microsoft.com/en-ie/answers/questions/2122856/onenote-on-ipad-copilot-is-greyed-out); [UWRF IT KB](https://technology.uwrf.edu/TDClient/1979/Portal/KB/ArticleDet?ID=169723); [Merill RM422321](https://mc.merill.net/message/RM422321)
- Evernote: Google Play feedback summary cites constant prompts for paid subscriptions and limited functionality; r/Evernote user (June 2026) says mobile UI is cluttered and keeps pushing AI suggestions despite a cap; App Store rating 4.2 (41 ratings in that storefront), reviews mixed with crashes mentioned. — [Kimola](https://kimola.com/reports/evernote-feedback-analysis-navigate-user-concerns-opportunities-google-play-en-us-145121); [r/Evernote mirror](https://r.datuan.dev/r/Evernote); [App Store](https://apps.apple.com/md/app/evernote-ai-notes-organizer/id281796108)

### Inferences
- Most "AI UX" complaints about mobile are about discoverability and gating, not output quality; once reached, selection-based tools (Apple, Samsung) are praised for being fast.
- Persistent AI nags and non-removable buttons are a recurring irritation (Evernote; desktop Office floating Copilot button per Office Watch is a DESKTOP analogue).

### Gaps
- No systematic user-rating data per AI feature; mostly forum anecdotes and secondary reviews.
- No App/Play store review text specific to Keep's "Help me create a list" or to OneNote mobile Copilot found.

## 7. Direct answers to the three key questions

### Takeaway
One tap: Samsung (icon above keyboard) and Apple (keyboard/selection menu after selecting text); two-plus taps or outside the app: Keep (create screen / Gemini app), OneNote (pane, rollout-dependent), Evernote (floating button, platform detail unclear). Selection vs whole note: Apple = selection (or whole note if nothing selected, unverified); Samsung = whole note (Replace replaces the note's content); Keep = no editing of existing content; Evernote = chat/Edit mode over a note. Accept/discard: Apple Replace/Copy/Share + Original/Revert/Rewrite; Samsung Copy/Replace/Add to (new page before / new note); Keep Insert only.

### Cited Findings
- Apple works on selected text: "select the text, then tap Writing Tools." — [MacRumors](https://macrumors.com/guide/ios-18-notes-app)
- Samsung operates on the note: Replace "replaces the current note's content"; text must be 200-4,000 characters. — [Samsung US support](https://www.samsung.com/us/support/answer/ANS10000941)
- Keep operates on a new blank note/list (create flow) and on title generation. — [Keep Help](https://support.google.com/keep/answer/15222789?hl=en)
- OneNote phone Copilot operates on whole pages ("summaries of longer pages"). — [MC1307979](https://mc.merill.net/message/MC1307979)

### Inferences
- A selection-first diff-less preview with Replace/Copy (Apple) plus a non-destructive "insert as new page" (Samsung) are the two strongest reference patterns for a notes app; Keep's insert-only preview is the minimal one.

### Gaps
- Apple behaviour with no selection (whole-note) on iPhone not confirmed from a primary source.
- Desktop-specific behaviour was deliberately not researched except where noted as DESKTOP.
