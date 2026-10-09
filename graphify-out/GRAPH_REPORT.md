# Graph Report - apps  (2026-10-09)

## Corpus Check
- Large corpus: 645 files · ~528,974 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 4206 nodes · 12787 edges · 205 communities (166 shown, 39 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 229 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- acceptance-app.ts
- contracts.ts
- gitRun
- localization.ts
- tr
- ManagedWorktree
- shared/browser-annotations.ts
- VoiceService
- useApp
- shared/subtasks.ts
- agent.ts
- diff.tsx
- worker-protocol.ts
- Thread
- shortcuts.ts
- SandboxLauncher
- shared/composer.ts
- messages.ts
- JsonStore
- OperationRecord
- Scheduler
- app.tsx
- browser-history-harness.tsx
- temp-paths.ts
- ModelSettings.tsx
- composer.tsx
- application.ts
- localizeAppError
- shared/browser-tools.ts
- session-tools.ts
- shared/goals.ts
- background.js
- dependencies
- extract-tokens.mjs
- Settings.tsx
- model-oauth-runtime.test.ts
- panels.spec.ts
- review-panel.tsx
- content.js
- DesktopRequest
- Settings
- PreviewService
- tool-results.ts
- sherpa-onnx.d.ts
- provider-oauth-ui-harness.tsx
- compilerOptions
- agent-worker.ts
- WindowState
- preview.ts
- shared/plugins.ts
- git-panel.tsx
- desktop-views.ts
- ModelProvider
- browser-tool.ts
- shared/workbench-tools.ts
- file-search.ts
- Memories
- ProviderAuthHarnessApi
- worktree-transfer.ts
- DesktopAgent
- manifest.json
- codex-reference.mjs
- WorktreeCreations
- browser-tools.nonvisual.spec.ts
- TerminalInfo
- chrome-bridge.ts
- ChromeBridge
- TimelineItem
- Project
- TerminalPanel.tsx
- conversation-ui-harness.tsx
- mcp-settings-harness.tsx
- plugins.nonvisual.spec.ts
- fidelity-report.mjs
- reference-contract.mjs
- DesktopEvent
- useLocale
- applyUiPatch
- cleanup-desktop-temp.mjs
- main/index.ts
- Plugins
- terminal-workbench.test.ts
- voice-control.tsx
- timeline-groups.ts
- git-panel.spec.ts
- reference-activity.mjs
- reference-states.mjs
- browser-bridge-harness.tsx
- McpConfig
- shared/memories.ts
- main/operation-tools.ts
- project-action-recovery-harness.tsx
- memory-settings-harness.tsx
- artifact-recovery-harness.tsx
- browser-annotations-harness.tsx
- devDependencies
- alignment-reference.mjs
- reference-surfaces.mjs
- HunkRecovery
- summary.spec.ts
- settings-updates.ts
- skillPathKey
- settings-save.test.ts
- DesktopBridge
- project-actions.tsx
- layout.ts
- worker/timeline.ts
- shared/message-input.ts
- composer-harness.tsx
- goal-recovery-harness.tsx
- subtask-recovery-harness.tsx
- terminal-recovery-harness.tsx
- worktree-controls-harness.tsx
- provider-oauth.nonvisual.spec.ts
- terminal-inspection.ts
- terminal-text.ts
- MemoryHarness
- composer.spec.ts
- file-editor-harness.tsx
- sidechat-recovery-harness.tsx
- alignment-regions.mjs
- alignment-visual.mjs
- defaultData
- ask-user-tool.ts
- browser.nonvisual.spec.ts
- plugin-management-harness.tsx
- reference-harness.tsx
- scripts
- message-revisions.ts
- quick-shortcut.ts
- reference.spec.ts
- browser-sites-harness.tsx
- build
- alignment-report.mjs
- visual-preview.mjs
- memories.nonvisual.spec.ts
- settings.spec.ts
- package.json
- mcp-oauth.ts
- sidebar.spec.ts
- satang-reference.mjs
- reference-icons.mjs
- runtime-preferences.ts
- timeline-groups.test.ts
- artifact-pdf-fake.ts
- nsis
- satang-shell-reference.mjs
- tabs.tsx
- desktop-tools.nonvisual.spec.ts
- satang.spec.ts
- files
- win
- alignment-gallery-check.mjs
- satang-workspace-reference.mjs
- VoiceCaptureProcessor
- activity.spec.ts
- primitives.spec.ts
- provider-oauth-ui.spec.ts
- plugins.test.ts
- reference-theme.mjs
- satang-management-reference.mjs
- satang-review-reference.mjs
- ChatWriteGate
- releaseSidechatWrite
- releaseTaskWrite
- releaseWindowWrite
- mcp-rich-server.mjs
- electron.vite.config.ts
- satang-palette-reference.mjs
- satang-workspace.spec.ts
- CreationGate
- OwnerGate
- mcp-credentials-server.mjs
- mcp-wait-server.mjs
- react
- reference-icon-data.ts
- activity-source.ts
- mcp-lifecycle-server.mjs
- mcp-policy-server.mjs
- mcp-server.mjs
- 浏览器桥接弹窗
- Pi Desktop Browser Bridge
- Pi Desktop 应用说明
- Pi Desktop 应用图标
- Renderer HTML 入口
- 欢迎页截图（深色）
- 欢迎页截图（浅色）
- 桌面视觉回归截图（1280x800，深色）
- 桌面视觉回归截图（1280x800，浅色）
- 桌面视觉回归截图（1440x940，深色）
- 桌面视觉回归截图（1440x940，浅色）

## God Nodes (most connected - your core abstractions)
1. `tr()` - 223 edges
2. `useLocale()` - 204 edges
3. `useApp()` - 174 edges
4. `Thread` - 144 edges
5. `gitRun()` - 119 edges
6. `localizeAppError()` - 107 edges
7. `DesktopApplication` - 93 edges
8. `DesktopRequest` - 88 edges
9. `mkdtemp()` - 82 edges
10. `modelResultContent()` - 68 edges

## Surprising Connections (you probably didn't know these)
- `MigrationResult` --references--> `DesktopData`  [EXTRACTED]
  desktop/src/main/data-migrations.ts → desktop/src/shared/contracts.ts
- `assertRestored()` --calls--> `gitRun()`  [EXTRACTED]
  desktop/test/e2e/worktree-restore.nonvisual.spec.ts → desktop/src/main/git.ts
- `harnessSnapshot()` --indirect_call--> `activeSubtask()`  [INFERRED]
  desktop/src/main/harness-tools.ts → desktop/src/shared/subtasks.ts
- `updateTrayMenu()` --calls--> `translate()`  [EXTRACTED]
  desktop/src/main/index.ts → desktop/src/shared/localization.ts
- `ThinkingLevels()` --calls--> `tr()`  [EXTRACTED]
  desktop/src/renderer/src/ModelSettings.tsx → desktop/src/shared/localization.ts

## Import Cycles
- None detected.

## Communities (205 total, 39 thin omitted)

### Community 0 - "acceptance-app.ts"
Cohesion: 0.03
Nodes (43): draftSnapshotSchema, sendReceiptSchema, Bootstrap, GitProcessProblem, mcpSchema, projectEnvironmentSchema, idle(), send() (+35 more)

### Community 1 - "contracts.ts"
Cohesion: 0.04
Nodes (81): migrateDesktopData(), MigrationOptions, UnsupportedDataVersionError, evaluateAction(), captureSidechat(), ProjectDirectoryConfig, ReviewAnnotationChange, StoreRecoveryError (+73 more)

### Community 2 - "gitRun"
Cohesion: 0.04
Nodes (61): commitSelected(), currentHead(), currentReference(), reconcileIndex(), gitPatch(), gitRun(), GitService, PreparedWorktree (+53 more)

### Community 3 - "localization.ts"
Cohesion: 0.06
Nodes (66): BindProject(), BindProjectControl(), ComposerPanel(), ContextUsage(), HomeProjectMenu(), suggestions, ArtifactAnnotations(), Props (+58 more)

### Community 4 - "tr"
Cohesion: 0.06
Nodes (62): Diff(), questionStatuses, statuses, SubtaskConversation(), SubtaskLink(), SubtaskPanel(), SubtaskRunSettings(), subtaskStatus() (+54 more)

### Community 5 - "ManagedWorktree"
Cohesion: 0.07
Nodes (23): RoundSnapshots, directoryBytes(), WorktreeArchives, metadata(), WorktreeIndexPreparation, matches(), metadata(), WorktreeReclamation (+15 more)

### Community 6 - "shared/browser-annotations.ts"
Cohesion: 0.05
Nodes (32): annotationDocument(), artifactFile(), artifactHash(), artifactKind(), artifactMime(), ArtifactPreview, Bounds, Capture (+24 more)

### Community 7 - "VoiceService"
Cohesion: 0.07
Nodes (35): childPath(), filesIn(), hashFile(), manifestSchema, ownerSchema, tar(), VoiceModels, reject() (+27 more)

### Community 8 - "useApp"
Cohesion: 0.08
Nodes (43): Composer(), DraftHistory(), PromptTemplates(), ReferenceDetail(), HomeUtility(), QueueControls(), SelectionQuote(), ComposerSuggestions() (+35 more)

### Community 9 - "shared/subtasks.ts"
Cohesion: 0.07
Nodes (23): publishSubtasks(), SubtaskRuntime, Subtasks, subtaskCreations(), askParentSchema, Subtask, SubtaskDefinition, subtaskDefinitionSchema (+15 more)

### Community 10 - "agent.ts"
Cohesion: 0.08
Nodes (63): readCapturedReviewFile(), browserControlAllowed(), validateReviewSubmission(), modelResultContent(), automationTool(), browserTool(), manageMessagesTool(), manageProjectsTool() (+55 more)

### Community 11 - "diff.tsx"
Cohesion: 0.06
Nodes (50): FileHead(), fileKey(), gutters(), kindLabel, LineAction, rowClass, SplitDiff(), SplitRow() (+42 more)

### Community 12 - "worker-protocol.ts"
Cohesion: 0.05
Nodes (64): approvalSchema, mcpStateSchema, resourceLoadSchema, desktopViewToolSchema, HarnessApproval, harnessApprovalSchema, harnessApprovalsToolSchema, HarnessArtifact (+56 more)

### Community 13 - "Thread"
Cohesion: 0.11
Nodes (7): DesktopApplication, sessionSummary, archiveBlocker(), worktreeContains(), Thread, allowedThinkingLevels(), resolveThinkingLevel()

### Community 14 - "shortcuts.ts"
Cohesion: 0.06
Nodes (53): FileNavigator(), controlsByThread, controlsFor(), controlsListeners, emptyControls, queryByTerminal, subscribeControls(), TerminalControls (+45 more)

### Community 15 - "SandboxLauncher"
Cohesion: 0.08
Nodes (33): AccessControlType, Action, BasicLimit, BasicLimit, Capabilities, ExtendedLimit, Grant, IoCounters (+25 more)

### Community 16 - "shared/composer.ts"
Cohesion: 0.09
Nodes (33): ComposerService, excluded, imageTypes, sendFingerprint(), listFiles(), pendingWrites, readProjectFile(), writeProjectFile() (+25 more)

### Community 17 - "messages.ts"
Cohesion: 0.06
Nodes (28): appErrorPatterns, appErrors, artifactMessages, automationMessages, browserMessages, chatMessages, composerMessages, extraMessages (+20 more)

### Community 18 - "JsonStore"
Cohesion: 0.09
Nodes (14): asRecord(), isRecord(), LegacyModel, MigrationResult, ProviderKeyMove, records(), rename(), renameExecution() (+6 more)

### Community 19 - "OperationRecord"
Cohesion: 0.07
Nodes (23): Operations, PullRequests, GhStatus, OperationRecord, OperationResult, operationSchema, PullRequest, pullRequestSchema (+15 more)

### Community 20 - "Scheduler"
Cohesion: 0.10
Nodes (15): publishAutomationState(), publishRows(), saveAutomationConfiguration(), dueAutomations(), pending(), Scheduler, SchedulerRuntime, SchedulerState (+7 more)

### Community 21 - "app.tsx"
Cohesion: 0.09
Nodes (33): automationDraft(), AutomationsPage(), Draft, initial, runStatuses, ManagementEmpty(), ManagementFilters(), ManagementSearch() (+25 more)

### Community 22 - "browser-history-harness.tsx"
Cohesion: 0.08
Nodes (21): BrowserHistory, BrowserClearOptions, browserClearSchema, BrowserDataRange, browserDataRangeSchema, BrowserHistoryEntry, browserHistoryEntrySchema, BrowserHistoryPage (+13 more)

### Community 23 - "temp-paths.ts"
Cohesion: 0.12
Nodes (10): translate(), evidence, cleanupTemporaryDirectories(), directories, mkdtemp(), evidence, settingsEvidence, harness (+2 more)

### Community 24 - "ModelSettings.tsx"
Cohesion: 0.10
Nodes (28): Encryption, FieldRow(), FieldRowProps, API_LABELS, ModelConnection(), compactTokens(), ModelDrawer, ModelSettings() (+20 more)

### Community 25 - "composer.tsx"
Cohesion: 0.10
Nodes (29): AttachmentPreview(), InputPicker(), ModelCapabilities(), SelectedQuote, Choice, SuggestionsHandle, MenuOption, SelectContext (+21 more)

### Community 26 - "application.ts"
Cohesion: 0.16
Nodes (35): contentVersion(), HarnessFocusResolution, latestMessage(), planFor(), resolveHarnessFocus(), addHarnessDraftAttachments(), appendHarnessDraft(), attachmentIdentity() (+27 more)

### Community 27 - "localizeAppError"
Cohesion: 0.12
Nodes (29): AppearanceSettings(), McpOAuthControls(), McpTestProgress(), useMcpTest(), McpToolPolicies(), BrowserHistoryPanel(), historyErrorText(), Controls (+21 more)

### Community 28 - "shared/browser-tools.ts"
Cohesion: 0.10
Nodes (19): browserDocument(), BrowserDocumentRequest, cancelBrowserDocument(), browserKeyboardEvents(), browserMouseEvents(), KeyData, modifiers, namedKeys (+11 more)

### Community 29 - "session-tools.ts"
Cohesion: 0.09
Nodes (31): thinkingSchema, DesktopToolAction, desktopToolCatalog, desktopToolCatalogFor(), desktopToolFamilies, DesktopToolFamily, forbiddenDesktopFields, forbiddenDesktopOps (+23 more)

### Community 30 - "shared/goals.ts"
Cohesion: 0.12
Nodes (12): GoalRuntime, Goals, criterionInput, Goal, GoalCheckpoint, goalCheckpointSchema, GoalDefinition, goalDefinitionSchema (+4 more)

### Community 31 - "background.js"
Cohesion: 0.15
Nodes (31): cancelOperation(), connect(), deriveKey(), disconnect(), encryptPayload(), endpoint(), execute(), fromBase64() (+23 more)

### Community 32 - "dependencies"
Cohesion: 0.06
Nodes (33): dependencies, @earendil-works/pi-ai, @earendil-works/pi-coding-agent, highlight.js, lucide-react, @modelcontextprotocol/sdk, node-pty, pdfjs-dist (+25 more)

### Community 33 - "extract-tokens.mjs"
Cohesion: 0.13
Nodes (31): BS, classifyConditions(), countInRanges(), desktopApplies(), fail(), FAMILIES, familyOf(), greater() (+23 more)

### Community 34 - "Settings.tsx"
Cohesion: 0.10
Nodes (23): BrowserSettings(), Invoke, statusOf(), GeneralSettings(), Removal, CATEGORIES, CATEGORY_DESCRIPTIONS, CATEGORY_GROUPS (+15 more)

### Community 35 - "model-oauth-runtime.test.ts"
Cohesion: 0.12
Nodes (19): generateMemories(), credentialSchema, Vault, filterOAuthErrorStream(), oauthFailureMessage(), oauthRuntimeProvider(), redactOAuthFailure(), redactOAuthStrings() (+11 more)

### Community 36 - "panels.spec.ts"
Cohesion: 0.07
Nodes (8): Bridge, Calls, CR, ids(), openTerminal(), panelsDir, showTerminal(), Window

### Community 37 - "review-panel.tsx"
Cohesion: 0.13
Nodes (24): FilePreview(), FileTabPanel(), controls, controlsFor(), emptyControls, emptyFinding, Finding(), FindingDraft (+16 more)

### Community 38 - "content.js"
Cohesion: 0.15
Nodes (24): bounds(), cancelledOperations, collectDocuments(), controls, documentId, documents, ensureOperationActive(), execute() (+16 more)

### Community 39 - "DesktopRequest"
Cohesion: 0.09
Nodes (10): assertSubtaskObserverRequest(), DesktopRequest, PluginHarness, directory, FixtureState, log(), native, observeWindow() (+2 more)

### Community 40 - "Settings"
Cohesion: 0.10
Nodes (15): appearanceFromSettings(), appearanceProperties(), Appearance, appearanceSchema, Settings, themeDocumentSchema, broadcast(), calls (+7 more)

### Community 41 - "PreviewService"
Cohesion: 0.18
Nodes (3): cssKeys, samples, PreviewService

### Community 42 - "tool-results.ts"
Cohesion: 0.17
Nodes (15): mcpResourceTarget(), mcpToolDecision(), McpToolPolicies, mcpToolPoliciesSchema, McpToolPolicy, mcpToolPolicySchema, jsonObject, mcpResourceResultSchema (+7 more)

### Community 43 - "sherpa-onnx.d.ts"
Cohesion: 0.08
Nodes (10): GenerationConfig, OfflineRecognizer, OfflineTts, RecognizerConfig, sherpa-onnx-node, Stream, TtsConfig, Vad (+2 more)

### Community 44 - "provider-oauth-ui-harness.tsx"
Cohesion: 0.09
Nodes (23): actions, calls, catalog, changeProvider(), Harness(), heldAnswers, heldStarts, heldStatus (+15 more)

### Community 45 - "compilerOptions"
Cohesion: 0.08
Nodes (24): compilerOptions, allowImportingTsExtensions, esModuleInterop, jsx, lib, module, moduleResolution, noEmit (+16 more)

### Community 46 - "agent-worker.ts"
Cohesion: 0.13
Nodes (14): AgentHost, DesktopToolRequest, WorkerCommand, workerCommandSchema, WorkerConfig, WorkerEvent, workerEventSchema, agent (+6 more)

### Community 47 - "WindowState"
Cohesion: 0.17
Nodes (4): WindowEntry, WindowRecord, WindowState, UiState

### Community 48 - "preview.ts"
Cohesion: 0.11
Nodes (13): BrowserFind, FindResult, FindTarget, Bounds, BrowserAction, Page, Surface, browserAddress() (+5 more)

### Community 49 - "shared/plugins.ts"
Cohesion: 0.15
Nodes (17): exec, unpackPluginZip(), Progress, mcpConfigurationErrors, mcpSecretEntries(), parseMcpSecrets(), validateMcpConfiguration(), pluginCatalogSchema (+9 more)

### Community 50 - "git-panel.tsx"
Cohesion: 0.12
Nodes (19): Action, Commit, commitWarnings, Conflict, controls, controlsFor(), emptyControls, GitJob (+11 more)

### Community 51 - "desktop-views.ts"
Cohesion: 0.19
Nodes (15): openDesktopView(), ViewContext, ViewRuntime, DesktopViewTarget, desktopViewTargetSchema, fileSelectionPatch(), fileTabId(), isPanelKind() (+7 more)

### Community 52 - "ModelProvider"
Cohesion: 0.26
Nodes (4): checkedProviderAuthUrl(), ProviderAuth, providerOAuthKey(), ModelProvider

### Community 53 - "browser-tool.ts"
Cohesion: 0.12
Nodes (16): automationToolConfiguration, AutomationToolRequest, automationToolSchema, BrowserDataToolRequest, browserDataToolSchema, directoryId, McpToolRequest, mcpToolSchema (+8 more)

### Community 54 - "shared/workbench-tools.ts"
Cohesion: 0.12
Nodes (21): directoryId, ManageCommentsToolRequest, manageCommentsToolSchema, ManageFilesToolRequest, manageFilesToolSchema, ManageGitToolRequest, manageGitToolSchema, ManagePreviewToolRequest (+13 more)

### Community 55 - "file-search.ts"
Cohesion: 0.18
Nodes (13): EXCLUDED, FileSearchService, scan(), SearchRequest, SearchSession, SearchState, FILE_SEARCH_PAGE_SIZE, FileSearchPage (+5 more)

### Community 56 - "Memories"
Cohesion: 0.18
Nodes (7): Memories, Draft, MemoryDocument, MemoryEntry, MemoryScope, memoryScopeKey(), fixture()

### Community 57 - "ProviderAuthHarnessApi"
Cohesion: 0.11
Nodes (3): Login, ProviderAuthStatus, ProviderAuthHarnessApi

### Community 58 - "worktree-transfer.ts"
Cohesion: 0.22
Nodes (13): FileVersion, hash, readTransferJournal(), saveTransferJournal(), TransferAssociation, transferAssociationSchema, transferDirectory(), TransferJournal (+5 more)

### Community 59 - "DesktopAgent"
Cohesion: 0.19
Nodes (3): QueueChange, DesktopAgent, handle()

### Community 60 - "manifest.json"
Cohesion: 0.10
Nodes (20): action, default_popup, default_title, background, service_worker, type, content_scripts, description (+12 more)

### Community 61 - "codex-reference.mjs"
Cohesion: 0.16
Nodes (20): BS, DESKTOP_PATTERNS, fail(), fromAsarPath(), globToRegExp(), installedArchive(), main(), pick() (+12 more)

### Community 62 - "WorktreeCreations"
Cohesion: 0.21
Nodes (7): exists(), key(), processRunning(), Receipt, receiptSchema, WorktreeCreations, WorktreeCreationIssue

### Community 63 - "browser-tools.nonvisual.spec.ts"
Cohesion: 0.12
Nodes (8): ToolResult, test, idle(), PolicyProbe, requests, run(), slowResponses, TemporaryDirectories

### Community 64 - "TerminalInfo"
Cohesion: 0.18
Nodes (5): actionArguments(), findShell(), TerminalService, TerminalInfo, exec

### Community 65 - "chrome-bridge.ts"
Cohesion: 0.17
Nodes (17): bridgeKey(), BridgeSession, BridgeTab, CHROME_BRIDGE_PROTOCOL, decryptBridgePayload(), encryptBridgePayload(), extensionIdHeader(), isExtensionOrigin() (+9 more)

### Community 66 - "ChromeBridge"
Cohesion: 0.24
Nodes (3): ChromeBridge, publicTab(), createFixture()

### Community 67 - "TimelineItem"
Cohesion: 0.17
Nodes (13): listSessions(), searchSessions(), SessionMessage, sessionMessages(), SessionSearchHit, visibleSessions(), TimelineItem, firstMatch() (+5 more)

### Community 68 - "Project"
Cohesion: 0.15
Nodes (13): byUpdatedDesc(), groupThreadList(), matchesSearch(), ThreadGroup, ThreadListInput, Project, projectSchema, itemSearchTexts() (+5 more)

### Community 69 - "TerminalPanel.tsx"
Cohesion: 0.16
Nodes (18): acquire(), ANSI_HUES, BLACK, Color, css(), hex(), luminance(), mix() (+10 more)

### Community 70 - "conversation-ui-harness.tsx"
Cohesion: 0.14
Nodes (11): cacheHitPercent(), outputPerSecond(), broadcast(), calls, data, invoke(), listeners, makeThread() (+3 more)

### Community 71 - "mcp-settings-harness.tsx"
Cohesion: 0.11
Nodes (11): calls, data, held, invoke(), McpHarness, params, pending, render() (+3 more)

### Community 72 - "plugins.nonvisual.spec.ts"
Cohesion: 0.15
Nodes (7): idle(), job(), plugin(), PluginWriteGate, prepareOAuthPlugin(), state(), oauthServer()

### Community 73 - "fidelity-report.mjs"
Cohesion: 0.11
Nodes (17): activity, contract, ledger, lines, output, outputFlag, result, resultsOnly (+9 more)

### Community 74 - "reference-contract.mjs"
Cohesion: 0.11
Nodes (18): constants, constantsStart, defaults, defaultsStart, files, fixture, initial, injectedThemes (+10 more)

### Community 75 - "DesktopEvent"
Cohesion: 0.11
Nodes (12): dataSchema, DesktopEvent, bridge, data, listeners, waits, Window, bridge (+4 more)

### Community 76 - "useLocale"
Cohesion: 0.17
Nodes (13): Shell(), BrowserAddressInput(), BrowserFindBar(), FileBody(), SplitCell(), UnifiedRow(), FileSearchResults(), LoadingScreen() (+5 more)

### Community 77 - "applyUiPatch"
Cohesion: 0.16
Nodes (15): applyUiPatch(), UiPatch, appearance(), bridge, data, emit(), listeners, params (+7 more)

### Community 78 - "cleanup-desktop-temp.mjs"
Cohesion: 0.13
Nodes (15): age, apply, args, gitRemnants(), identify(), inside(), KNOWN_DATA_VERSIONS, knownPrefixes (+7 more)

### Community 79 - "main/index.ts"
Cohesion: 0.17
Nodes (10): configureWindow(), directory, log(), updateTrayMenu(), builds, inside(), launcher(), recoverSandboxRuns() (+2 more)

### Community 80 - "Plugins"
Cohesion: 0.25
Nodes (3): Plugins, Plugin, PluginRevision

### Community 81 - "terminal-workbench.test.ts"
Cohesion: 0.20
Nodes (8): inspectTerminal(), appendTerminalOutput(), mergeTerminalSnapshot(), TERMINAL_OUTPUT_LIMIT, TerminalOutput, terminalOutputEnd(), fixture(), TestCell

### Community 82 - "voice-control.tsx"
Cohesion: 0.20
Nodes (8): labels, Phase, VoiceControl(), Outlet, VoiceLayer(), VoiceOutletContext, VoicePlayback, VoiceRecorder

### Community 83 - "timeline-groups.ts"
Cohesion: 0.18
Nodes (12): appendEntry(), distinctToolNames(), entryKind(), finishTurn(), groupTurns(), TurnArtifact, turnArtifacts(), TurnBlock (+4 more)

### Community 84 - "git-panel.spec.ts"
Cohesion: 0.12
Nodes (6): fail(), GitHarness, harness, owned, Pending, Window

### Community 85 - "reference-activity.mjs"
Cohesion: 0.12
Nodes (14): anchors, chevron, cssFiles, fixtures, glyphSource, input, motion, probes (+6 more)

### Community 86 - "reference-states.mjs"
Cohesion: 0.12
Nodes (14): anchors, approval, classes, cssFiles, fixtures, input, loading, newline (+6 more)

### Community 87 - "browser-bridge-harness.tsx"
Cohesion: 0.12
Nodes (12): data, disconnect(), emit(), invoke(), listeners, PanelHarness(), params, pending (+4 more)

### Community 88 - "McpConfig"
Cohesion: 0.41
Nodes (3): checkedUrl(), McpOAuth, McpConfig

### Community 89 - "shared/memories.ts"
Cohesion: 0.23
Nodes (12): memoryInput, memoryDocumentSchema, MemoryGeneration, memoryGenerationSchema, memoryPreferencesSchema, memoryRequests, memorySafeText(), memoryScopeSchema (+4 more)

### Community 90 - "main/operation-tools.ts"
Cohesion: 0.23
Nodes (8): bounded(), cursorSchema, OperationToolRuntime, projectAction(), runOperationTool(), OperationToolRequest, operationToolSchema, fixture()

### Community 91 - "project-action-recovery-harness.tsx"
Cohesion: 0.17
Nodes (14): EditorState, ProjectEnvironment, Action, bridge, changed(), data, directory(), environment() (+6 more)

### Community 92 - "memory-settings-harness.tsx"
Cohesion: 0.17
Nodes (14): memoryEntrySchema, calls, changed(), complete(), data, held, invoke(), locale() (+6 more)

### Community 93 - "artifact-recovery-harness.tsx"
Cohesion: 0.14
Nodes (13): bridge, capture, data, emit(), listeners, locale(), markDeleting(), params (+5 more)

### Community 94 - "browser-annotations-harness.tsx"
Cohesion: 0.14
Nodes (13): bridge, captures, data, emit(), listeners, locale(), markDeleting(), page (+5 more)

### Community 95 - "devDependencies"
Cohesion: 0.13
Nodes (15): devDependencies, electron, electron-builder, electron-vite, @playwright/test, @types/react, @types/react-dom, vite (+7 more)

### Community 96 - "alignment-reference.mjs"
Cohesion: 0.15
Nodes (13): donor, excluded, extraction, failed(), hasErrorBody(), manifest, original, output (+5 more)

### Community 97 - "reference-surfaces.mjs"
Cohesion: 0.13
Nodes (13): anchors, cssFiles, fixtures, input, probes, properties, richProperties, root (+5 more)

### Community 99 - "summary.spec.ts"
Cohesion: 0.15
Nodes (4): GitStatus, harness, SummaryHarness, Window

### Community 100 - "settings-updates.ts"
Cohesion: 0.25
Nodes (8): mcpCredentialReference(), retiredMcpCredentials(), oauthCredentialKey(), pluginMcpConfigurations(), applySettingsPatch(), sameSetting(), settingsChanges(), encryption

### Community 101 - "skillPathKey"
Cohesion: 0.29
Nodes (9): inputCatalog(), inspectResources(), createSharedSkill(), discoverSharedSkills(), updateIgnoredSkills(), ResourceDiagnostic, ResourceInspection, defaultSkillsDirectory() (+1 more)

### Community 102 - "settings-save.test.ts"
Cohesion: 0.20
Nodes (12): changedWorkerSettingGroups(), sameValue(), WORKER_SETTING_GROUPS, WorkerSettingGroup, edit(), editModel(), editProvider(), model (+4 more)

### Community 103 - "DesktopBridge"
Cohesion: 0.16
Nodes (8): App(), Window, DesktopBridge, bridge, data, listeners, params, Window

### Community 104 - "project-actions.tsx"
Cohesion: 0.22
Nodes (13): editorFor(), editors, emptyEditor, emptyEnvironment, emptyRequest, listeners, ProjectActions(), requestFor() (+5 more)

### Community 105 - "layout.ts"
Cohesion: 0.31
Nodes (9): Resizer(), ResizerProps, clampLayout(), layoutBounds(), ResizeKey, resizeStep(), summaryPlacement(), workspaceSizes() (+1 more)

### Community 106 - "worker/timeline.ts"
Cohesion: 0.36
Nodes (11): toolDetailsSchema, validMessageInput(), mergeTimelineItem(), storedToolResult(), contentBlocks(), contentText(), eventItem(), historyItems() (+3 more)

### Community 107 - "shared/message-input.ts"
Cohesion: 0.20
Nodes (8): MESSAGE_INPUT_ENTRY, MessageInput, MessageInputPart, messageInputPartSchema, messageInputSchema, storedMessageInputSchema, inputSignature(), PendingMessageInputs

### Community 108 - "composer-harness.tsx"
Cohesion: 0.15
Nodes (10): bridge, contextRequests, data, listeners, log, params, Probe(), publish() (+2 more)

### Community 109 - "goal-recovery-harness.tsx"
Cohesion: 0.20
Nodes (12): bridge, data, emit(), goal(), listeners, locale(), params, replaceGoal() (+4 more)

### Community 110 - "subtask-recovery-harness.tsx"
Cohesion: 0.19
Nodes (12): bridge, children, data, emit(), ids, listeners, locale(), params (+4 more)

### Community 111 - "terminal-recovery-harness.tsx"
Cohesion: 0.19
Nodes (12): Action, bridge, data, emit(), listeners, locale(), params, pending (+4 more)

### Community 112 - "worktree-controls-harness.tsx"
Cohesion: 0.20
Nodes (12): Action, bridge, changed(), data, directory(), Harness(), issues(), listeners (+4 more)

### Community 113 - "provider-oauth.nonvisual.spec.ts"
Cohesion: 0.23
Nodes (10): assertBusyGuards(), assertNoCredential(), configuredModel(), configuredProvider(), configureProvider(), invoke(), login(), OAuthFixtureState (+2 more)

### Community 114 - "terminal-inspection.ts"
Cohesion: 0.18
Nodes (8): cursorSchema, metadata(), TerminalMetadata, TerminalReadResult, TerminalReadRuntime, terminalReadParametersSchema, TerminalReadRequest, terminalToolSchema

### Community 115 - "terminal-text.ts"
Cohesion: 0.23
Nodes (8): Buffer, Cell, findTerminalMatches(), Line, LogicalLine, terminalBufferText(), TerminalMatch, terminalTextLines()

### Community 118 - "file-editor-harness.tsx"
Cohesion: 0.17
Nodes (10): bridge, data, emit(), listeners, params, reads, selectContext(), Window (+2 more)

### Community 119 - "sidechat-recovery-harness.tsx"
Cohesion: 0.18
Nodes (11): bridge, data, emit(), listeners, locale(), params, parents, selectThread() (+3 more)

### Community 120 - "alignment-regions.mjs"
Cohesion: 0.17
Nodes (10): manifest, output, pixelmatchModule, { PNG }, referenceRequire, regions, report, require (+2 more)

### Community 121 - "alignment-visual.mjs"
Cohesion: 0.17
Nodes (10): manifest, output, pixelmatchModule, { PNG }, referenceRequire, require, results, root (+2 more)

### Community 122 - "defaultData"
Cohesion: 0.18
Nodes (8): defaultData(), fixture(), legacyData(), recoveryFixture(), GEOMETRY, SIZES, THEMES, fixture()

### Community 123 - "ask-user-tool.ts"
Cohesion: 0.35
Nodes (9): AskUserRequest, askUserToolSchema, questionKind(), questionResultText(), askUserTool(), UserQuestionAsker, Call, invoked (+1 more)

### Community 124 - "browser.nonvisual.spec.ts"
Cohesion: 0.24
Nodes (8): BrowserEvent, evidence, open(), query(), search(), showFind(), status(), Window

### Community 125 - "plugin-management-harness.tsx"
Cohesion: 0.20
Nodes (11): bridge, calls, complete(), data, held, listeners, pending, publish() (+3 more)

### Community 126 - "reference-harness.tsx"
Cohesion: 0.17
Nodes (8): approvalKind, bridge, data, listeners, params, Reply, terminals, Window

### Community 127 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, package:dir, package:win, start, test, test:nonvisual (+3 more)

### Community 128 - "message-revisions.ts"
Cohesion: 0.36
Nodes (6): importAttachmentBatch(), prepareMessageRevision(), AttachmentUpload, attachmentUploadSchema, MAX_ATTACHMENT_BYTES, ComposerPayload

### Community 129 - "quick-shortcut.ts"
Cohesion: 0.27
Nodes (3): QuickShortcut, Registry, ShortcutStatus

### Community 130 - "reference.spec.ts"
Cohesion: 0.24
Nodes (6): CapturedScene, expectAdaptedAppearance(), manifest, homeContract, shellContract, selectors

### Community 131 - "browser-sites-harness.tsx"
Cohesion: 0.20
Nodes (9): bridge, data, emit(), listeners, locale(), params, pending, Surface() (+1 more)

### Community 132 - "build"
Cohesion: 0.20
Nodes (10): build, appId, asarUnpack, directories, npmRebuild, productName, output, **/*.node (+2 more)

### Community 133 - "alignment-report.mjs"
Cohesion: 0.20
Nodes (9): directory, escaped, html, manifest, newline, { results: rows }, root, summary (+1 more)

### Community 134 - "visual-preview.mjs"
Cohesion: 0.20
Nodes (9): assets, files, output, reference, root, scenes, server, styles (+1 more)

### Community 136 - "settings.spec.ts"
Cohesion: 0.22
Nodes (5): html, levelNames, modelIdMetadata(), rowFor(), Window

### Community 137 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, license, main, name, private, type, version

### Community 138 - "mcp-oauth.ts"
Cohesion: 0.25
Nodes (5): Credentials, Vault, McpOAuthStatus, mcpOAuthStatusSchema, mcpSecretStatusSchema

### Community 139 - "sidebar.spec.ts"
Cohesion: 0.22
Nodes (3): sheetDir, sheets, specDir

### Community 140 - "satang-reference.mjs"
Cohesion: 0.25
Nodes (6): properties, record, root, samples, selectors, sources

### Community 141 - "reference-icons.mjs"
Cohesion: 0.29
Nodes (6): assets, icons, input, newline, root, sources

### Community 143 - "timeline-groups.test.ts"
Cohesion: 0.48
Nodes (6): turnFiles(), item(), notice(), say(), tool(), user()

### Community 144 - "artifact-pdf-fake.ts"
Cohesion: 0.29
Nodes (3): PDFWorker, waits, Window

### Community 145 - "nsis"
Cohesion: 0.33
Nodes (6): nsis, allowToChangeInstallationDirectory, deleteAppDataOnUninstall, oneClick, perMachine, runAfterFinish

### Community 146 - "satang-shell-reference.mjs"
Cohesion: 0.33
Nodes (4): properties, root, samples, sources

### Community 147 - "tabs.tsx"
Cohesion: 0.47
Nodes (3): TabItem, Tabs(), TabsProps

### Community 148 - "desktop-tools.nonvisual.spec.ts"
Cohesion: 0.53
Nodes (4): idleThread(), siblingChat(), thread(), turn()

### Community 149 - "satang.spec.ts"
Cohesion: 0.33
Nodes (5): management, Measurement, palette, review, surfaces

### Community 150 - "files"
Cohesion: 0.40
Nodes (4): files, out/**/*, !**/*.pdb, resources/**/*

### Community 151 - "win"
Cohesion: 0.40
Nodes (5): win, icon, signExecutable, target, nsis

### Community 152 - "alignment-gallery-check.mjs"
Cohesion: 0.40
Nodes (4): directory, errors, result, { results }

### Community 153 - "satang-workspace-reference.mjs"
Cohesion: 0.40
Nodes (4): keys, samples, sources, unavailable

### Community 161 - "satang-management-reference.mjs"
Cohesion: 0.50
Nodes (3): keys, samples, sources

### Community 162 - "satang-review-reference.mjs"
Cohesion: 0.50
Nodes (3): keys, samples, sources

### Community 167 - "mcp-rich-server.mjs"
Cohesion: 0.50
Nodes (3): send, server, transport

## Knowledge Gaps
- **911 isolated node(s):** `state`, `documentId`, `refs`, `observers`, `documents` (+906 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **39 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Thread` connect `Thread` to `message-revisions.ts`, `contracts.ts`, `acceptance-app.ts`, `localization.ts`, `tr`, `shared/browser-annotations.ts`, `memories.nonvisual.spec.ts`, `useApp`, `shared/subtasks.ts`, `agent.ts`, `runtime-preferences.ts`, `shared/composer.ts`, `JsonStore`, `OperationRecord`, `Scheduler`, `app.tsx`, `temp-paths.ts`, `composer.tsx`, `application.ts`, `localizeAppError`, `shared/goals.ts`, `review-panel.tsx`, `DesktopRequest`, `Settings`, `tool-results.ts`, `git-panel.tsx`, `desktop-views.ts`, `worktree-transfer.ts`, `DesktopAgent`, `TimelineItem`, `Project`, `conversation-ui-harness.tsx`, `mcp-settings-harness.tsx`, `timeline-groups.ts`, `shared/memories.ts`, `summary.spec.ts`, `skillPathKey`, `provider-oauth.nonvisual.spec.ts`, `browser.nonvisual.spec.ts`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Why does `DesktopRequest` connect `DesktopRequest` to `acceptance-app.ts`, `contracts.ts`, `gitRun`, `localization.ts`, `browser-sites-harness.tsx`, `useApp`, `settings.spec.ts`, `Thread`, `OperationRecord`, `app.tsx`, `browser-history-harness.tsx`, `temp-paths.ts`, `ModelSettings.tsx`, `application.ts`, `localizeAppError`, `Settings.tsx`, `Settings`, `provider-oauth-ui-harness.tsx`, `preview.ts`, `git-panel.tsx`, `file-search.ts`, `ProviderAuthHarnessApi`, `conversation-ui-harness.tsx`, `mcp-settings-harness.tsx`, `DesktopEvent`, `applyUiPatch`, `git-panel.spec.ts`, `browser-bridge-harness.tsx`, `project-action-recovery-harness.tsx`, `memory-settings-harness.tsx`, `artifact-recovery-harness.tsx`, `browser-annotations-harness.tsx`, `summary.spec.ts`, `DesktopBridge`, `composer-harness.tsx`, `goal-recovery-harness.tsx`, `subtask-recovery-harness.tsx`, `terminal-recovery-harness.tsx`, `worktree-controls-harness.tsx`, `provider-oauth.nonvisual.spec.ts`, `MemoryHarness`, `file-editor-harness.tsx`, `sidechat-recovery-harness.tsx`, `plugin-management-harness.tsx`, `reference-harness.tsx`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `DesktopApplication` connect `Thread` to `gitRun`, `ManagedWorktree`, `shared/browser-annotations.ts`, `VoiceService`, `shared/subtasks.ts`, `shared/composer.ts`, `JsonStore`, `OperationRecord`, `Scheduler`, `browser-history-harness.tsx`, `temp-paths.ts`, `application.ts`, `shared/browser-tools.ts`, `shared/goals.ts`, `DesktopRequest`, `PreviewService`, `WindowState`, `ModelProvider`, `Memories`, `worktree-transfer.ts`, `WorktreeCreations`, `TerminalInfo`, `ChromeBridge`, `main/index.ts`, `Plugins`, `McpConfig`, `HunkRecovery`, `settings-updates.ts`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `useLocale()` (e.g. with `getLocale()` and `subscribeLocale()`) actually correct?**
  _`useLocale()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `state`, `documentId`, `refs` to the rest of the system?**
  _911 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `acceptance-app.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.030622243998040175 - nodes in this community are weakly interconnected._
- **Should `contracts.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.04141935483870968 - nodes in this community are weakly interconnected._
## Graph Health
- 4206 nodes, 14775 raw edges; 12787 edges retained in the undirected graph.
- Warning: 1741 edges reference endpoints that were not emitted as nodes; these are mostly external types or unresolved symbols from static extraction and may lower cross-module completeness.
- 245 same-endpoint edge groups collapsed by undirected graph construction.
- Semantic API extraction was skipped because no Gemini/Google API key was configured; 11 document/image source nodes were registered locally without invented relationships.
