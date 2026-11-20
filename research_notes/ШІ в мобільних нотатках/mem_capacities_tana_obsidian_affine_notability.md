# AI in the mobile apps of Mem, Capacities, Tana, Obsidian (Copilot / Smart Connections), AFFiNE, Notability, Goodnotes

Research date: 2026-10-21. Method: web search + fetch of vendor pages/App Store listings. WebFetch answers come from a summarizing model, so wording is paraphrase, not verbatim. Many mobile-UI details (exact button positions, undo/diff behaviour) are NOT documented publicly; those are listed under Gaps rather than guessed.

## Mem (iOS; no Android app found)

### Takeaway
Mem 2.0 is chat/agent-first: the iOS app has a bottom tab bar with a Chat tab; chat has since been renamed "Mem Agent" and can create/edit/organize notes. Usage-capped paid tiers from $9 to $199/month; no BYOK found. I found no evidence of an Android app (App Store listing is iPhone/iPad).

### Cited Findings
- Entry point: Mem 2.0 iOS has a new bottom tab bar giving "quick access to your notes, collections, search, and chat" — [Mem dev update #4](https://get.mem.ai/blog/mem-2-0-dev-update-brand-new-ios-app). That page ties only Chat to iOS AI; it does not mention voice, Heads Up, Copilot or dictation (vendor marketing, unverified).
- Capabilities (iOS listing): Mem Agent (formerly Mem Chat) answers questions, recalls details, summarizes meetings, connects ideas, drafts messages from saved notes; auto-detects tasks/projects from notes; voice notes turn rough input into structured notes (Voice Mode: English, Spanish, German, French, Portuguese, Italian); Mem Pro adds custom routines (briefings, research, organizing notes, scheduled reminders) and connections to Gmail, Slack, Todoist — [App Store](https://apps.apple.com/us/app/mem-self-organizing-workspace/id1578757028).
- Version 2.5.2 added create/edit/organize notes directly through chat; "Heads Up" (successor to Copilot) groups related notes by topic and shows related meetings on a timeline — [search summary citing App Store/Mem](https://apps.apple.com/us/app/mem-self-organizing-workspace/id1578757028) (the later fetch of the listing did not repeat Heads Up; treat as unconfirmed). Version 2.6.32 added Tasks and Projects to Mem Agent; July 2025 renamed Mem Chat to Mem Agent — same App Store listing.
- Mem Agent proactively scans notes, messages and connected calendar for unfinished commitments and sends timed reminders; saved details land in notes, which "remain visible and editable"; user can tell it to stop following up on a task. No dedicated change log/diff described — [Mem Agent page](https://get.mem.ai/agent). Push-to-Remember (hold shortcut, speak, release) is described on desktop; page doesn't state a mobile equivalent. Phone sharing of links/notes/whiteboard photos to the Agent is mentioned — same page.
- Scope shown to user: not documented in what I fetched (chat is "over your notes"; no scope picker found).
- Turn off: no setting found for disabling AI.
- Pricing: App Store lists Mem Plus $9, Pro $29, Pro 2x $49, 5x $99, 10x $149, 20x $199, plus "Proactive" $29/$59/$99; every plan includes the Agent with plan-specific limits — [App Store](https://apps.apple.com/us/app/mem-self-organizing-workspace/id1578757028). Mem's own page lists Pro $29 = 100 messages, 100 new notes/month, 50 open tasks/projects, one routine, one connection, 25 h Voice Mode — [get.mem.ai/agent](https://get.mem.ai/agent). A third-party tracker says Mem replaced the flat $12 Pro / $99 Proactive with the 7-tier ladder around 2026-08-25 and that the earlier free tier was 25 notes/25 chat messages/25 PDF pages — [usagepricing.com](https://usagepricing.com/blueprint/activity/mem-2026-08-25-packaging) (single third-party source). No BYOK mentioned anywhere.
- User feedback (App Store, 4.4/5 from 129 ratings): praise for capturing without organizing; complaints: recordings stop after 2 h, no hands-free/Siri voice capture (needs several taps), edits sometimes applied to the wrong note, iOS typing slower than competitors, inconsistent sync, no PDF export — [App Store](https://apps.apple.com/us/app/mem-self-organizing-workspace/id1578757028). Older Trustpilot (2023) review predates the agent — [Trustpilot](https://at.trustpilot.com/review/mem.ai).

### Inferences
- Pattern: chat/agent-first (tab) plus proactive agent; no selection-menu AI documented on mobile.
- Cost model is a metered subscription with a price ladder keyed to message/usage volume.

### Gaps
- Android app: none found; not confirmed absent.
- Where changes made by the Agent are shown/undone on mobile; scope indicator; AI off switch — not documented in accessible sources.
- Real Reddit/forum sentiment on mobile AI UX not found (search returned only aggregators).

## Capacities (iOS + Android)

### Takeaway
Chat-first with a dedicated sparkle tab ("Explore") in the bottom bar, plus AI launched from a block selection, home-screen widgets, Siri/Control Center/Quick Settings. Credit-style monthly AI budget on paid plans; AI can be disabled (tab appears only if AI enabled); no BYOK.

### Cited Findings
- Entry points: sparkle tab in the bottom tab bar opens Explore (AI chats workspace), shown only if AI is enabled; tab bar hides inside a chat; AI can also be opened from selected blocks (selection loaded as context) and from an object (content loaded as context) — [Capacities mobile docs](https://docs.capacities.io/reference/mobile).
- Shortcuts: AI Assistant widget (iOS and Android; experimental; needs Pro) starts a new chat; iPhone "Ask Capacities" via Siri/Shortcuts and Control Center control; Android long-press app menu or Quick Settings — same docs.
- Capabilities on mobile: chat, model choice via chat "⋯" menu, audio "Analyze" (transcript + summary), "Fill description" AI autofill (Pro) — same docs. Paid plans also cover media analysis, web search, controlled object creation/updates per a search summary of Capacities pages ([Capacities pricing](https://www.capacities.io/pricing) lists chat with notes, media analysis of images/audio/links, autofill, assistant).
- Redesign: Explore AI on phone uses a glass-style interface with a floating composer within thumb reach; larger tap targets for editing messages; suggestions refresh every 7 days (release notes dated 2026-08-06) — [Release 68](https://www.capacities.io/whats-new/release-68).
- Context limiting: user picks what to load (selection or object); "load current object as context" — mobile docs above. Whole-space retrieval is implied by "chat with your notes" in pricing but the mobile docs don't show a scope indicator.
- Turn off: Explore tab is shown only when AI is enabled (so AI is switchable) — mobile docs; exact settings path not documented in fetched pages.
- Pricing: Basic free with no AI; Pro $9.99/mo (structured data says $11.99/mo or $119.88/yr) and Believer from $12.49/mo (structured data $14.99/mo or $149.88/yr), each with a "light monthly AI budget"; Plus add-on (≈$8.33/mo annual) gives a much larger budget and top-ups, auto top-up; all models in picker available; BYOK not mentioned — [Capacities pricing](https://www.capacities.io/pricing) (visible price and structured data disagree).
- Complaints: one review says mobile lags desktop and AI is Pro-only with a daily limit — [Saner review](https://www.saner.ai/blogs/capacities-review) (found via search; not fetched; may be dated).

### Inferences
- Pattern: chat-first (tab) + "send selection to AI" button + system-level shortcuts; closest to a hybrid.
- Cost model: subscription with metered dollar-like AI budget and optional top-ups (credits), not BYOK.

### Gaps
- How a suggestion/edit is shown, accepted or undone on mobile (diff, insert) not documented.
- Exact limits (budget size) not published.
- No primary user-complaint sources on mobile AI UX beyond the one review.

## Tana (iOS + Android)

### Takeaway
Mobile AI is voice-centered: the Capture tab with Voice (memo + AI voice chat), supertag voice icons, widgets and OS shortcuts. AI voice chat is now on both iOS and Android (English only); the iOS version shows an AI summary review screen before saving. Metered AI credits tied to plan; top-ups bought outside Apple billing.

### Cited Findings
- Entry points: Capture tab (five formats: Write, Voice, Camera, Media, Files); voice icon on a supertag in the Supertags tab; home/lock-screen widgets; iOS Control Center, Spotlight, Siri, Shortcuts/Action Button — [Tana mobile](https://outliner.tana.inc/learn/features/tana-mobile).
- Voice chat: Capture tab "Voice Chat" (general), supertag/widget (tag-tailored), or long-press a pinned node in Browse / long-press the "+" on any node to chat in that node's context. The AI can search the workspace, zoom into pinned/referenced nodes, look up the web, autofill supertag fields and extract tasks at the end, and saves the transcript under the starting node. English only; iOS has a review screen with AI summary before saving, Android saves immediately ("coming soon" for the review) — [Tana blog](https://outliner.tana.inc/blog/ai-voice-chat-on-android-and-ios-can-now-search-tana-and-the-web) (undated page). The older mobile page still says "Early Access, iOS only" — [Tana mobile](https://outliner.tana.inc/learn/features/tana-mobile) — conflicting; the blog post is newer.
- Voice memos: transcribed and auto-filled into the chosen supertag's fields; language auto-detect (paid plans); docs cite 91 languages, Android blog says 60+ ([voice memos docs](https://outliner.tana.inc/docs/mobile-voice-memos) via search summary; conflicting).
- Scope shown: context is the node the chat was started from (long-press node), or supertag-tailored; otherwise general workspace search by the agent — Tana blog above.
- Pricing/limits: AI usage tied to a monthly quota; Apple subscriptions can't buy top-up AI credits (bought on web/desktop); no dollar amounts on the page; BYOK not mentioned — [Tana mobile](https://outliner.tana.inc/learn/features/tana-mobile).
- Turn off: not documented in fetched pages.

### Inferences
- Pattern: command/capture-first (you start an AI session from the node/tag you are in), not chat tab nor selection menu; AI result is shown as filled supertag fields in the outline, plus an iOS pre-save review.

### Gaps
- Selection-based rewrite on mobile, undo behaviour, price figures, AI off switch, and user reviews of mobile AI: not found.

## Obsidian (mobile) with AI plugins: Copilot and Smart Connections

### Takeaway
Obsidian itself has no built-in AI that I could source; AI comes via community plugins. Copilot on mobile = Quick Chat, custom Commands and Quick Ask (the Agent mode is desktop-only); Smart Connections' core plugin (local embeddings, related notes) is mobile-friendly. Copilot is BYOK-first with an optional paid license.

### Cited Findings
- Copilot mobile support: Agent is desktop-only (runs local CLI processes); Quick Chat, custom Commands and Quick Ask work on mobile; listed platforms Desktop and Mobile — [Obsidian community: Copilot](https://community.obsidian.md/plugins/copilot); same in [GitHub README](https://github.com/logancyang/obsidian-copilot).
- Quick Ask: ask about selected text without leaving the note, then continue, replace the text, insert the answer, or copy it (this is the accept/undo model: explicit buttons) — Obsidian community page above. Selection commands via Command palette / editor menu; recommended shortcuts Ctrl/Cmd+L (add selection to chat) and Ctrl/Cmd+K are desktop shortcuts — [plugin listing via search](https://community.obsidian.md/plugins/copilot).
- Commands: saved prompts runnable with `/` in Agent, from the editor or Command palette — same page.
- Scope: Projects hold reusable context and chat history; local "Miyo" semantic index of the vault (incl. PDFs/EPUBs) — same page; whether mobile gets Miyo/vault search is not stated. Context shown to user on mobile: not documented.
- BYOK: cloud, local or OpenAI-compatible providers under Settings → Copilot → BYOK; keys kept in Obsidian Keychain, not data.json. Free use = own key/local model; paid license adds Copilot-hosted models, multi-agent, managed web search, PDF parsing; 14-day refund; preview features need Believer/Supporter license; pricing amounts not on page — same page. Privacy: free use sends context to the provider you configure; Brevilabs receives data only for its hosted features — same page.
- Smart Connections: "both the Core Smart Connections and Connections Pro are mobile friendly"; ships a local embedding model, no API key; Connections view shows semantically related notes for the current note; Lookup view for semantic search; can exclude folders/files from indexing; API-based chat integrations moved to Smart Chat Pro; whether Smart Chat works on mobile isn't stated — [Smart Connections README](https://github.com/brianpetro/obsidian-smart-connections).
- Other mobile-capable AI plugins exist (Obsidian Chat — iOS/Android/desktop with 14 vault tools; Vault Companion for Claude; Ask AI needing Obsidian 1.13+) — [Obsidian Chat forum post](https://forum.obsidian.md/t/plugin-obsidian-chat-an-agentic-ai-assistant-that-lives-in-your-vault/112346), [Vault Companion](https://community.obsidian.md/plugins/vault-companion-for-claude), [Ask AI](https://community.obsidian.md/plugins/ask-ai) (search summaries, not verified by fetch).
- Disable/hide: standard Obsidian community-plugin toggle (I did not find a doc page for this; general knowledge, unverified). Copilot README doesn't explain disabling.
- Performance context: general Obsidian mobile startup slowness on large vaults/Android is a recurring forum complaint (4.8 s startup in a large vault; ~10 s on some Android devices) — [forum](https://forum.obsidian.md/t/obsidian-mobile-horrendously-slow/116787), [forum](https://forum.obsidian.md/t/bug-android-app-extremely-slow-to-launch/28271). These are not Copilot-specific.

### Inferences
- Pattern on mobile: sidebar chat + command palette/editor-menu commands on selection (Quick Ask); no first-class toolbar button other than what the plugin adds. Cost: BYOK = pay-per-token to provider; optional subscription for hosted models.

### Gaps
- Copilot's mobile UI placement (ribbon icon vs. sidebar), vault-QA availability on mobile, and mobile user reviews: not found.
- No first-party Obsidian AI claim sourced; absence not verified.
- Smart Chat mobile support unknown.

## AFFiNE (iOS + Android)

### Takeaway
AFFiNE has native iOS and Android apps that list AI features, but I found no official documentation of how AI is invoked or what it can do specifically on mobile. AI chat on iOS was released as experimental (0.24.1); AI is a paid add-on; no BYOK.

### Cited Findings
- iOS listing (requires iOS 16.5+) mentions AI: drafting, condensing into outlines, turning brainstorms into next steps; "AI Chat, released as an experimental feature in 0.24.1"; AI privacy notice added in 0.26.3; in-app purchases: Pro monthly $7.99, Pro yearly $81.00, AFFiNE AI yearly $106.99 — [App Store](https://apps.apple.com/us/app/notes-whiteboard-ai-affine/id6736937980).
- Web pricing: AFFiNE AI add-on $8.9/month billed annually; features: writing, rewriting for tone/grammar, mind maps from outlines, presentations (beta); auto-sort and auto-tag "coming soon"; Pro $6.75/mo; free AI allowance and usage limits not stated; BYOK not mentioned — [AFFiNE pricing](https://affine.pro/pricing). Conflicting price points between App Store and web (monthly vs annual billing, store markup) — unresolved.
- Mobile apps are described as in active development with some desktop features limited (third-party mirror of docs) — [mintlify mirror](https://www.mintlify.com/toeverything/AFFiNE/platforms/mobile).
- A reviewer says AI can be turned off (listing doesn't confirm) and criticizes AI being offered while there is no offline export; other complaints are general stability (keyboard stays up, table checkmark failure); rating 4.3 from 36 ratings — [App Store](https://apps.apple.com/us/app/notes-whiteboard-ai-affine/id6736937980).
- One third-party review says the latest version supports Claude and Gemini models, no selection method explained — [fahimai](https://www.fahimai.com/affine-pro) (low-quality source).
- Scope/diff/accept UI on mobile: not documented.

### Inferences
- Pattern on mobile appears to be chat (experimental) rather than selection menus, but this is inferred from "AI Chat" being the only named mobile AI feature in release notes.

### Gaps
- Official docs for mobile AI (entry point, scope, undo), whether the full desktop AI (inline "Ask AI" on selection, mind maps) exists on mobile, the AI off switch, and Android specifics: not found.
- AI usage limits: not published on pages I could read.

## Notability (iPhone/iPad/Mac/web; no Android)

### Takeaway
AI in Notability is study/meeting oriented: chat across your whole library, Learn (flashcards/quizzes/exam prep) with a usage meter, transcripts and "Finish My Notes". Subscription tiers; no BYOK found. No evidence it uses Gemini (searched; not found).

### Cited Findings
- Features per release notes: v16.12 "Chat across notes" + Finish My Notes (enriches notes with recording-transcript context); v16.8 flashcards/quizzes/exam prep on Home; v16.7 images in Chat; v16.12.1 YouTube import (cloud only); v16.13.1 clearer Learn usage meter, Finish My Notes only on unfinished notes; v16.4 improved Learn on iPhone — [App Store](https://apps.apple.com/us/app/notability-smarter-ai-notes/id360593530).
- Platforms: iPad, iPhone, Mac, web; iOS 17+ — same listing and [search summary](https://apps.apple.com/app/id360593530).
- Pricing: free with core note-taking; subscriptions Lite/Plus/Pro unlock AI study tools, handwriting recognition, math conversion, live transcripts, backup; Classic one-time $49.99; exact per-tier dollars vary by storefront and weren't extractable — same listing. Learn has a usage meter (limit numbers not stated).
- Reviews: 4.8/5 from ~458K ratings; praise for annotation, lecture recording, transcripts, Learn; requests for layers/tags and consolidated Learn material — same listing (aggregate ratings are not AI-specific).
- Entry point on mobile (button location), selection-based AI, undo, scope indicator, turn-off: not documented in accessible sources.

### Inferences
- Pattern: chat-across-library plus dedicated Learn/Home tabs and transcript-tied actions; not a selection-menu rewrite tool (no such feature listed).
- Cost: subscription tiers with metered Learn usage.

### Gaps
- Gemini/model provider: nothing found. UI placement, AI off switch, handwriting-specific AI (beyond recognition) not found.

## Goodnotes (iPhone, iPad, Android, Windows, Web)

### Takeaway
Goodnotes AI is a one-tap assistant that works across handwriting, typed text, sketches, PDFs and audio, with source citations that link back to notebook pages, plus an opt-in "Create Mode" that lets AI edit/insert content. Paid add-on "AI Pass" for heavy use; no BYOK; no individual off-switch (users have asked for one).

### Cited Findings
- Capabilities: works across handwriting/typed/sketch/PDF/audio; citations link to notebook pages; flags when an answer comes from general knowledge; answers can be dragged into notes; context-aware Quick Actions (suggested prompts); Create Mode lets AI insert, edit and generate content; Goodnotes AI for Meetings (calendar-based notes, transcription, summary) — [Goodnotes AI info page](https://www.goodnotes.com/for-ai-assistants). Accessible "in one tap from any notebook" — same page (which button/where is not described).
- Platforms: iOS, iPadOS, macOS, Android, Windows, Web — same page. A Goodnotes feedback post says updated Goodnotes AI is available on Android/Windows/Web (summaries, questions about notes, text enhancing/formatting) — [Goodnotes feedback](https://feedback.goodnotes.com/forums/950440-customer-suggestions-for-goodnotes-android-windo/status/889086) (via search; user forum). Android users still request AI handwriting/typing features — [feedback](https://feedback.goodnotes.com/forums/950440-improve-goodnotes-for-android-windows-and-web/suggestions/49274105-ai).
- Pricing (2026): Free; Essential $11.99/yr; Pro $35.99/yr; Teams $120/seat/yr; AI Pass $9.99/month add-on; limits not specified — [Goodnotes AI info page](https://www.goodnotes.com/for-ai-assistants). Support page (via search) says free tier gets basic AI with Create mode off, Create mode needs Pro, AI Pass gives 12x monthly credits (6,300), free Q&A was once limited to 5 questions/month — [Goodnotes support](https://support.goodnotes.com/hc/en-us/articles/13808767840015) (page returned 403 to my fetch; figures from search snippet only, may be outdated). TechCrunch: limit exists even on Pro; AI pass ~$10/month; Essentials includes AI for Q&A and math — [TechCrunch 2025-09-23](https://techcrunch.com/2025/09/23/goodnotes-collaborative-docs-and-ai-assitant-to-cater-to-professional-users/). Sources conflict on whether AI Pass is "unlimited" (TechCrunch) vs credit-based (support).
- Turn off: Teams/Enterprise admins can enable/disable AI; no individual setting documented — info page above. A user feature request asks for an option to disable Goodnotes AI to declutter the toolbar (3 votes) — [Goodnotes feedback](https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes-apple/suggestions/50872211-feature-request-option-to-disable-goodnotes-ai).
- Complaints: need to buy AI credits to generate notes from recordings; AI limited to document Q&A, falls back on general knowledge, summarizes rather than answers directly; request for model choice/tiers; one user calls Goodnotes AI unnecessary — [feedback: credits/performance](https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes-apple/suggestions/50855942-improve-goodnotes-ai-performance), [feedback: unnecessary](https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes-apple/suggestions/50692370-goodnotes-ai-is-unnecessary). Release notes: AI-generated diagrams editable on Pro/AI Pass (via search summary).

### Inferences
- Pattern: persistent assistant panel/chat (one tap) + suggested Quick Actions, with an explicit Create-Mode toggle gating whether AI may modify the document — a clear "read-only by default" model.
- Cost: subscription plus credit add-on.

### Gaps
- Exact on-screen position of the AI button on iPhone vs iPad vs Android; phone-specific layout; diff/undo behaviour; free-tier numbers (conflicting/outdated); iPhone-specific reviews: not found.

## Cross-cutting: chat-first vs button-on-selection vs command on mobile

### Takeaway
Chat-first is dominant in this set (Mem tab, Capacities sparkle tab, Notability chat, Goodnotes assistant, AFFiNE AI Chat); Capacities is the only one with a documented "AI from block selection" step on mobile; Obsidian Copilot is command/selection-driven via plugin (Quick Ask); Tana is capture/node-driven voice sessions.

### Cited Findings
- Chat tab: Mem (bottom tab bar — [Mem blog](https://get.mem.ai/blog/mem-2-0-dev-update-brand-new-ios-app)); Capacities (sparkle tab — [docs](https://docs.capacities.io/reference/mobile)).
- Selection/object → AI: Capacities ([docs](https://docs.capacities.io/reference/mobile)); Obsidian Copilot Quick Ask ([plugin page](https://community.obsidian.md/plugins/copilot)).
- Voice/capture-first: Tana ([blog](https://outliner.tana.inc/blog/ai-voice-chat-on-android-and-ios-can-now-search-tana-and-the-web)).
- System-level launchers: Capacities widgets/Siri/Quick Settings; Tana widgets/Control Center/Action Button — respective docs above.

### Inferences
- A "read-only by default / write on opt-in" pattern appears (Goodnotes Create Mode; Capacities "controlled object creation"; Obsidian Quick Ask's explicit replace/insert/copy buttons).

### Gaps
- No product has a publicly documented mobile diff view; acceptance flows are mostly undocumented.

## Cross-cutting: how scope is limited and shown

### Takeaway
Scope is chosen by launching context: current object or selected blocks (Capacities), the node you started from (Tana), a Project (Copilot), whole library (Notability chat, Mem). Visible scope indicators on mobile are mostly undocumented; Goodnotes shows citations and flags general-knowledge answers.

### Cited Findings
- Capacities: loads selection or current object as context — [docs](https://docs.capacities.io/reference/mobile).
- Tana: long-press node / "+" to chat in that node's context — [Tana blog](https://outliner.tana.inc/blog/ai-voice-chat-on-android-and-ios-can-now-search-tana-and-the-web).
- Copilot: Projects with reusable context; Quick Ask on selection — [plugin page](https://community.obsidian.md/plugins/copilot). Smart Connections can exclude folders/files from indexing — [README](https://github.com/brianpetro/obsidian-smart-connections).
- Notability: "Chat across your notes" over the whole library — [App Store](https://apps.apple.com/us/app/notability-smarter-ai-notes/id360593530).
- Goodnotes: citations to notebook pages and "general knowledge" flag — [info page](https://www.goodnotes.com/for-ai-assistants).

### Inferences
- Source citations (Goodnotes) are the only documented mobile mechanism for showing what the AI actually used.

### Gaps
- Mem and AFFiNE scope UI on mobile not documented.

## Cross-cutting: cost model

### Takeaway
All products use subscriptions with metered AI; credits/budgets are the norm; BYOK exists only through Obsidian plugins (Copilot). Prices conflict across sources for several (flagged).

### Cited Findings
- Mem: $9–$199/mo ladder, usage-limited — [App Store](https://apps.apple.com/us/app/mem-self-organizing-workspace/id1578757028).
- Capacities: Pro/Believer with light monthly AI budget; Plus add-on ≈$8.33/mo with top-ups — [pricing](https://www.capacities.io/pricing).
- Tana: monthly quota; top-ups outside Apple billing — [Tana mobile](https://outliner.tana.inc/learn/features/tana-mobile).
- Obsidian Copilot: free with own key/local model; optional paid license — [plugin page](https://community.obsidian.md/plugins/copilot). Smart Connections core is free and local — [README](https://github.com/brianpetro/obsidian-smart-connections).
- AFFiNE: AI add-on $8.9/mo annual (web) / $106.99/yr (App Store) — [pricing](https://affine.pro/pricing), [App Store](https://apps.apple.com/us/app/notes-whiteboard-ai-affine/id6736937980).
- Notability: Lite/Plus/Pro subscriptions, Classic $49.99 one-time — [App Store](https://apps.apple.com/us/app/notability-smarter-ai-notes/id360593530).
- Goodnotes: Essential $11.99/yr, Pro $35.99/yr, AI Pass $9.99/mo — [info page](https://www.goodnotes.com/for-ai-assistants).

### Inferences
- A user wanting predictable cost on mobile has only the Obsidian BYOK route; everywhere else AI is capped or add-on priced.

### Gaps
- Actual numeric limits for Capacities, Tana, AFFiNE, Notability not published in sources found.
