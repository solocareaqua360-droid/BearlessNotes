# AI in the mobile apps (iOS/Android) of Notion, Craft, Bear, Reflect

Research date: 2026-10-21. Official docs rarely describe the mobile AI UI in detail (button position, accept/discard). Where a source does not say, this is stated in Gaps rather than guessed. Web searches were run through a summarising tool, so some statements are relayed from snippets/summaries rather than read verbatim; this is flagged where it matters.

## 1. Where is the AI entry point on mobile, and is it always visible?

### Takeaway
No product has an official, documented "always-visible AI button in the mobile editor". Notion documents outside-the-app entry points (widget, Siri, Spotlight, Action button) plus a separate Agents iOS app; Craft documents an "Assistant panel" on iPhone but not its button; Bear has no AI; Reflect's mobile AI UI is not documented anywhere I could reach.

### Cited Findings
**Notion**
- Notion's mobile help page lists a Notion AI home-screen widget (start an AI chat, use the camera, or use voice); iOS-only shortcuts: Siri, Spotlight, Shortcuts app, Action button on iPhone 15 Pro. The page does not say whether the widget/shortcuts exist on Android. — [Notion for mobile](https://www.notion.com/help/notion-for-mobile); [Notion AI FAQs](https://www.notion.com/help/notion-ai-faqs)
- Notion's mobile editing toolbar (above the keyboard) lists: @-mention, comment, image, delete, indent, text color/highlight, block duplicate/delete. No AI item is listed. There are no "/" commands or hover menus on mobile; the "+" and "•••" icons are always visible. — [Writing & editing basics](https://www.notion.com/help/writing-and-editing-basics); [Notion for mobile](https://www.notion.com/help/notion-for-mobile)
- Notion's help page on writing/editing says the "Ask AI" option sits in the block action menu opened by hover on desktop; the page does not confirm it exists on mobile. — [Writing & editing basics](https://www.notion.com/help/writing-and-editing-basics)
- Desktop entry points (for contrast): round face icon at the bottom-right of a page, sidebar under Search, Shift+Cmd+J. The official guide does not cover mobile. — [Everything you can do with Notion AI](https://www.notion.com/help/guides/everything-you-can-do-with-notion-ai)
- Third-party (low-quality SEO site, unverified, treat with caution): on mobile, AI is not in the top toolbar but in the page's three-dot menu (top-right) under an "AI" section (e.g. "AI Summarize"); select text, tap-and-hold, and a menu offers AI options. Claims AI section appears only if the AI add-on is active and pages under ~250 words may not show it; says custom AI actions cannot be triggered from iOS/Android. — [WiseChecker: AI Summary missing on mobile](https://wisechecker.com/?p=31001), [WiseChecker: custom action](https://wisechecker.com/?p=27116) (snippet only)
- Notion released a separate **Notion Agents** iOS app (release dated 2026-07-08 on the Notion releases page; a different release note says "Notion 3.7", 2026-09-15 — the two dates conflict). It is a hub for chat with agents rather than a note editor; input: text, voice, photos. Android not mentioned in any source found. — [Notion release 2026-07-08](https://www.notion.com/releases/2026-07-08); [AlternativeTo](https://alternativeto.net/news/2026/7/notion-launches-a-new-standalone-ios-app-for-chatting-with-custom-ai-agents-on-the-go/); [Notion releases](https://www.notion.com/releases)
- Notion release notes 2026-10-19: "chats load up to 50% faster on mobile". — [Notion releases](https://www.notion.com/releases)

**Craft**
- Craft Assistant is "available at space-level and document-level on iPad and iPhone"; you "bring up the Assistant panel", pick model/mode and type a prompt. The article does not name the button or gesture. — [How to Use Craft Assistant](https://support.craft.do/hc/en-us/articles/18337002832156-How-to-Use-Craft-Assistant); [Using the Assistant](https://support.craft.do/en/ai-assistant/using)
- Works in Documents, Tasks, Calendar, Collections, Code Editor, browse views; platforms listed: macOS, iOS (iPhone/iPad), Windows, Web; Android not mentioned. — [Using the Assistant](https://support.craft.do/en/ai-assistant/using)
- App Store: "AI Assistant: searches your notes, answers questions about your content, helps rewrite or summarize documents"; MCP and API support. — [App Store: Craft](https://apps.apple.com/us/app/craft-docs-notes-tasks-ai/id1487937127)

**Bear**
- No built-in AI. Bear 2.8 (April 2026) added BearCLI, a Claude Connector and an MCP server; the developer states "no AI was added to Bear". Install path is a Mac menu (Help → Advanced → Install Claude Connector); the announcement says "update Bear now on macOS". — [Bear blog 2.8](https://blog.bear.app/2026/04/bear-2-8-bearcli-claude-connector-and-mcp-server/); [Bear community announcement](https://community.bear.app/t/bear-2-8-bearcli-claude-connector-and-mcp-server/19072); [Ry Walker summary](https://rywalker.com/research/bear-app) (CLI/MCP bundled only with the Mac app; Bear has no Android or web version)
- App Store listing for Bear does not mention AI. — [Bear App Store](https://apps.apple.com/us/app/bear-markdown-notes/id1016366447) (via search snippet)

**Reflect**
- iOS App Store lists: voice transcription/dictation, "customizable AI prompts that edit notes using GPT-4", "Chat with your notes", and chat using searched notes as context (v1.0.37). Latest version 1.0.43 "fix some bugs". iPhone app requires iOS 16.1+; no Android app is listed. — [Reflect Notes App Store](https://apps.apple.com/app/id1575595407)
- Reflect changelog: iOS lock-screen widget for the voice transcriber (2024-09-17); in-line voice transcriber (2025-02-11); AI chat with notes on iPad (2025-03-25); July 8, 2025 "What's next?" lists "Bringing AI chat to mobile". — [Reflect changelog](https://reflectnotes.canny.io/changelog)

### Inferences
- Notion's mobile AI is oriented to chat/Q&A launched from outside the editor (widget, Siri, Agents app) rather than an in-editor toolbar button; the in-page menu location is only attested by a low-quality third party.
- Reflect's mobile AI probably started as dictation + prompts, chat arriving later (changelog "bringing AI chat to mobile" July 2025, App Store v1.0.37 says chat with searched notes exists on iOS), but exact UI position is undocumented.

### Gaps
- Exact position of the Craft Assistant button on iPhone (not in docs).
- Whether Notion's in-page AI button is a floating button on mobile (official docs silent; third party says three-dot menu).
- Reflect mobile AI entry point (toolbar? palette? tab?) — no source found.
- Android: Notion Android AI widget/Agents app unconfirmed; Craft Android unmentioned; Reflect and Bear have no Android app.

## 2. Selection only or whole page? What can AI do on mobile?

### Takeaway
Craft documents document-level and space-level scope (selection scope not documented); Notion's mobile scope is only anecdotal; Bear has none; Reflect applies AI prompts to notes (selection vs whole not confirmed for mobile).

### Cited Findings
- Craft Assistant: document-level (open doc) vs space-level (e.g. "find all documents about marketing campaigns"); selection scoping not described in the help articles. Editing (Fast and Max models) is supported on macOS and iOS (iPad and iPhone) at both levels; Windows/Web Execute mode "coming later". Capabilities in Execute mode include creating subpages, moving documents, deleting blocks/folders/documents. — [Editing with Craft Assistant](https://support.craft.do/en/ai-assistant/editing.md); [Using the Assistant](https://support.craft.do/en/ai-assistant/using)
- Craft models: Core (read-only, cheap), Fast (space-level, can edit), Max (complex, can edit), Local on-device (Apple Foundation Model, LLaMa 3.2; free, read-only). Preferences (standing instructions) set via Settings > Assistant. — [How to Use Craft Assistant](https://support.craft.do/hc/en-us/articles/18337002832156-How-to-Use-Craft-Assistant)
- Notion (desktop-oriented docs): Notion AI can write, edit, summarize, chat, search the web (can be disabled by owners), generate images (admin-controllable). Mobile-specific capability list not published. — [Notion AI FAQs](https://www.notion.com/help/notion-ai-faqs)
- Notion mobile: widget starts AI chat with camera and voice input; Agents app handles voice notes and photos for agents. — [Notion for mobile](https://www.notion.com/help/notion-for-mobile); [Notion releases](https://www.notion.com/releases)
- Third party (unverified) for Notion mobile: select ≥ ~50 words, tap-hold → "AI Summarize"; whole-page summary from three-dot menu. — [WiseChecker](https://wisechecker.com/?p=31001)
- Reflect: customizable AI prompts to edit notes (GPT-4 per App Store); Reflect's own materials say the assistant can use GPT or Claude; chat with notes; AI link summaries on saved links (2025-09-23). Voice transcription via Whisper per third-party. — [Reflect App Store](https://apps.apple.com/app/id1575595407); [Reflect academy](https://reflect.academy/ai-note-taking); [changelog](https://reflectnotes.canny.io/changelog); [tooliverse](https://tooliverse.ai/tools/reflect)
- Bear: none built in; external AI (Claude, MCP clients) can read/edit notes via CLI — on Mac. — [Bear blog](https://blog.bear.app/2026/04/bear-2-8-bearcli-claude-connector-and-mcp-server/)

### Inferences
- "Make table" / "generate image" on mobile are not documented for any product; do not assume.

### Gaps
- No source confirms table generation or image generation specifically on mobile for any of the four.
- Reflect: whether prompts act on selection or entire note on iPhone.

## 3. How a suggestion is shown, accepted, undone

### Takeaway
Only Craft documents a clear mechanism: Explore mode (propose, approve) vs Execute mode (apply directly, undo whole last response as one step). Notion's docs say "accept, discard or try again" but not the mobile UI. Reflect undocumented.

### Cited Findings
- Craft: Explore = proposes changes, nothing modified until approved; Execute = edits appear in real time. Mode selector at the bottom of the Assistant panel. ⌘Z / Ctrl+Z undoes everything the Assistant did in its last response as one step; you can also ask the Assistant to revert. The docs do not describe how proposed changes are drawn (diff or otherwise) nor the iPhone undo gesture (the docs mention only keyboard shortcuts). — [Editing with Craft Assistant](https://support.craft.do/en/ai-assistant/editing.md); [How to Use Craft Assistant](https://support.craft.do/hc/en-us/articles/18337002832156-How-to-Use-Craft-Assistant)
- Craft conversations are kept 30 days; sessions pause after 5 minutes idle; sessions sync between macOS and iOS, browser sessions stay in the browser. — [Using the Assistant](https://support.craft.do/en/ai-assistant/using)
- Notion: when AI creates or edits content "you can accept or discard the changes, or ask it to try again"; no mobile-specific description. — [Notion AI FAQs](https://www.notion.com/help/notion-ai-faqs)
- Third party for Notion mobile summary: result appears as popup/inline block; copy or insert into the page. — [WiseChecker](https://wisechecker.com/?p=31001) (unverified)

### Inferences
- Craft's "undo as one step" suggests a snapshot per Assistant response rather than per-block diffs; not stated outright.

### Gaps
- Visual form (diff/highlight/inline) of Craft Explore proposals on iPhone.
- Reflect accept/undo behaviour on mobile; Notion exact mobile accept/discard controls.

## 4. How AI can be turned off or hidden

### Takeaway
Craft: per-Space toggle (device-local). Notion: no full off switch documented; owners/admins restrict parts. Bear: nothing to turn off, but Mac CLI was enabled by default and users complained. Reflect: not found.

### Cited Findings
- Craft: Space settings → Assistant toggle off; per Space; "doesn't sync across devices or users", must be turned off on each device. — [How to Use Craft Assistant](https://support.craft.do/hc/en-us/articles/18337002832156-How-to-Use-Craft-Assistant)
- Notion: article does not describe turning AI off entirely; owners can use Settings → Notion AI to disable web search, choose models, set credit limits, and control AI image generation. — [Notion AI FAQs](https://www.notion.com/help/notion-ai-faqs)
- Bear: BearCLI shipped enabled by default (Mac); users asked for it off by default and for hashtag exclusions; encrypted notes can be listed but not read/edited. — [Bear community thread](https://community.bear.app/t/bear-2-8-bearcli-claude-connector-and-mcp-server/19072); [Ry Walker](https://rywalker.com/research/bear-app). A June 2026 forum thread asks whether the Claude connector is gone (no answer seen). — [Bear Community](https://community.bear.app/t/is-claude-connector-gone/19260)

### Gaps
- Reflect: no way-to-disable doc found. Notion: per-user hiding of AI on mobile not documented.

## 5. Price and limits

### Takeaway
Notion bundles AI into Business; Craft sells tiers with usage limits (numbers not obtained); Bear has no AI cost; Reflect ~$10/month (unverified).

### Cited Findings
- Notion: AI available on Business and Enterprise; Free and Plus get a limited number of complimentary AI responses; high-credit models use Notion credits and are off until an owner/admin enables them. — [Notion AI FAQs](https://www.notion.com/help/notion-ai-faqs)
- Secondary sources 2026: Business ~$20/user/month annual includes full AI; Plus $10 and Free have a capped trial; Custom Agents separate credits ($10 per 1,000 credits/month, no rollover); the old $10 AI add-on is gone. Some stale pages still describe the add-on. — [Krater](https://krater.ai/blog/notion-ai-pricing), [eesel](https://eesel.ai/blog/notion-pricing), [Layer3 Labs](https://www.layer3labs.io/guides/notion-ai-pricing) (snippets; confirm on notion.com/pricing)
- Notion Agents iOS app: reported free to download with in-app purchase, requires a Notion account; a Brazilian outlet mentions a Plus tier at R$150/month (single secondary source). — [AlternativeTo](https://alternativeto.net/news/2026/7/notion-launches-a-new-standalone-ios-app-for-chatting-with-custom-ai-agents-on-the-go/); [MacMagazine](https://macmagazine.com.br/post/2026/07/07/notion-agents-app-para-interacao-com-agentes-de-ia-chega-ao-ios/)
- Craft: app free with in-app purchases, tiers Plus/Family/Team/Business, ~$9.99/month up to $299/month by tier/region; Local models always free; usage quotas on the "Usage & Limits" page (not retrieved); token usage and cost are recorded. — [App Store: Craft](https://apps.apple.com/us/app/craft-docs-notes-tasks-ai/id1487937127); [How to Use Craft Assistant](https://support.craft.do/hc/en-us/articles/18337002832156-How-to-Use-Craft-Assistant)
- Bear: no signup/account; privacy label lists only diagnostics. No AI cost. — [Bear App Store](https://apps.apple.com/us/app/bear-markdown-notes/id1016366447) (snippet)
- Reflect: ~$10/month (annual) per aggregator listings and a free trial; App Store listing shows no IAP tiers on the page. Not verified on reflect.app (pricing page fetch returned 404). — [Tooliverse](https://tooliverse.ai/tools/reflect); [Reflect App Store](https://apps.apple.com/app/id1575595407)

### Gaps
- Craft AI usage numbers per plan; Reflect official price; exact Notion Agents app pricing.

## 6. User complaints and praise (mobile AI UX)

### Takeaway
Very little mobile-AI-specific user feedback is findable. No Reddit threads were reached.

### Cited Findings
- Craft: App Store 4.8 from ~6.6K ratings, Editors' Choice; reviewers praise tables, templates, Collections, web sharing (not the AI specifically). — [App Store: Craft](https://apps.apple.com/us/app/craft-docs-notes-tasks-ai/id1487937127). Saner.ai scores Craft mobile 6/10 and AI 6.5/10 (assistant good for drafting, weak at finding connections across a library). — [Saner.ai](https://www.saner.ai/blogs/craft-review). TechRepublic tested on iPadOS/macOS, not iPhone, found no inferior mobile functionality. — [TechRepublic](https://www.techrepublic.com/article/craft-review/)
- Reflect: App Store 4.6 from 88 ratings (a snapshot from AppFollow gave 4.8 from 83 in Feb 2026 — figures differ by date); reviewers praise daily-note structure, AI dictation, "Chat with your notes", speed. A Capterra reviewer says iPhone version needs improvement. — [Reflect App Store](https://apps.apple.com/app/id1575595407); [Capterra](https://www.capterra.com/p/10005017/Reflect/)
- Bear: reaction to Mac AI integration was largely enthusiastic but with privacy complaints (CLI on by default). — [Ry Walker](https://rywalker.com/research/bear-app); [Bear community](https://community.bear.app/t/bear-2-8-bearcli-claude-connector-and-mcp-server/19072). An older forum thread says the developer had no plans for built-in AI due to privacy (search snippet; page later returned 404, date unconfirmed). — [Bear community: AI integration](https://community.bear.app/t/ai-integration-in-bear/5695)
- Notion: third-party troubleshooting posts say AI option missing on mobile for plan/length reasons (unverified). — [WiseChecker](https://wisechecker.com/?p=31001)

### Gaps
- No Reddit/forum complaints on Notion, Craft or Reflect mobile AI UX retrieved; no AI-specific mobile review from a major tech publication for any of the four.

## Desktop-only vs mobile summary (as documented)
- Craft: editing by Assistant on macOS and iOS; Windows/Web Execute "later"; Local models read-only. Mobile has document + space level. — [Editing with Craft Assistant](https://support.craft.do/en/ai-assistant/editing.md)
- Notion: desktop shortcut Shift+Cmd+J and face icon bottom-right are desktop; mobile has widget/Siri/Spotlight/Action button (iOS), Agents iOS app. — [Everything you can do with Notion AI](https://www.notion.com/help/guides/everything-you-can-do-with-notion-ai); [Notion for mobile](https://www.notion.com/help/notion-for-mobile)
- Bear: CLI/Claude Connector/MCP are Mac only; iOS no AI. — [Bear community](https://community.bear.app/t/bear-2-8-bearcli-claude-connector-and-mcp-server/19072)
- Reflect: iOS has dictation, AI prompts, chat (since ~2025); desktop/web parity not verified. — [Reflect App Store](https://apps.apple.com/app/id1575595407)
