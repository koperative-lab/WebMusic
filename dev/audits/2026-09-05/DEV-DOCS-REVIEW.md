# dev documentation fact, completeness and SSOT audit — 2026-09-05

> Editorial note (2026-09-05): translated to English and given portable file links during the documentation reorganization. Findings, measurements, and verification limits remain historical; cited source line numbers refer to the reviewed snapshot. Current work is tracked in [STATUS](../../STATUS.md). Raw evidence is unchanged; portable log copies are listed in [the evidence manifest](evidence/portable-evidence.json).

> Audit snapshot, not new development rules or the current backlog. The scope was the 16 Markdown documents present before this report, totaling 5,252 lines. Findings concern the local main working tree, including uncommitted changes, at HEAD 086905cacb7b22de57b9dc4a191bb67f268dd271. Historical proposals are evaluated as historical material; unadopted features are not required to be implemented.

## Conclusion

**dev/ was a valuable development reference collection, but not yet a reliable current SSOT.** It already had ownership assignments, source-verification requirements, four page templates, corrections to historical plans and audit evidence. The main problems were insufficient separation between current facts, intended rules and historical state, and rules maintained in several places that had drifted apart.

| Dimension | Assessment | Evidence |
| --- | --- | --- |
| Factual accuracy | Partly accurate, with explicit errors | CI audit coverage, tags, snippet compilation, MP3 decoding, page migrations and some delivery claims conflicted with local evidence |
| Completeness | Broad coverage, incomplete follow-through | Detailed site rules, but incomplete Headless-template adoption, gate boundaries, architecture-policy navigation and historical outcome tracking |
| Duplication | Both useful references and risky parallel ownership | Snippet checks, component counts, migration state and integration steps were recorded in several documents, sometimes contradicting one another |
| Suitability as a development SSOT | Not yet; a foundation for a layered SSOT | DEVELOPMENT supplied navigation and ownership, but current-state claims were inaccurate, rules conflicted, and dev's factual prose was not automatically checked |

SSOT does not require putting every fact in one file. Each kind of fact needs one authoritative source, references from other locations, and explicit version, historical-state and verification boundaries.

## Scope, method and evidence limits

- Covered 7 documents at the dev root, 7 under plans, and the 2 earlier audit/remediation records. Cross-checked key facts, executable steps, completion claims and ownership rules against source, configuration and local Git records.
- Reran check:docs, check:doc-snippets and check:architecture; all passed, reporting 119 pages/31 elements/119 routes, 153 compiled snippets, and 5 packages/355 source modules respectively. The full tests and builds were not repeated for this documentation audit.
- Inspected Kernel-page anchors in the existing documentation build and checked the prior repair logs' test totals: 197 files and 2,205 tests, matching FIXES.md.
- A lightweight scan, excluding code fences, checked 110 local Markdown file links; all targets existed, and 68 used machine-specific absolute paths. This was not a complete Markdown/MDX, external-link or fragment check.
- A machine-wide Git ignore rule for *.log ignored 20 audit log files.
- SHA-256 hashes of the original 16 documents, scan scope, ignored files and command results are in the [machine-readable evidence](evidence/dev-docs-review-evidence.json). These hashes identify the audited documents; they do not constitute a recoverable snapshot of the entire uncommitted working tree.
- npm publication, organization/name ownership, tombstone/support-ticket state, sibling-repository archival on GitHub and remote Actions history remained unverified external facts. Attempts to read the npm registry and public pages for some sibling repositories did not yield verifiable content. Read failures do not prove that a package or repository is absent. Cross-references between local documents cannot establish external state. origin/dev is a local remote-tracking ref, not evidence of a fresh remote fetch during this audit.

## Records requiring correction or completion

P2 means sufficient risk of misleading development, acceptance or release judgments. P3 means lower-risk explanatory or maintenance issues. These are documentation findings, not newly identified runtime vulnerabilities.

### D01 · P2 · CI production-audit coverage is misstated

[DEVELOPMENT.md](../../DEVELOPMENT.md) line 125 says CI runs audit:production alongside the gate. In fact, [ci.yml](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/.github/workflows/ci.yml) lines 34–47 run only npm ci, npm run check and npm run docs:build. [package.json](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/package.json) lines 23, 27 and 31 define audit:production without wiring it into those chains.

Impact: readers may mistake passing CI for a completed dependency vulnerability check. Document the actual coverage. Adding it to CI is a later implementation choice, not something prose can declare complete.

### D02 · P2 · Release instructions still direct maintainers to use an existing tag

[DEVELOPMENT.md](../../DEVELOPMENT.md) lines 140–144 say the repository has no tags and v0.1.0 is available. Locally, annotated tag v0.1.0 already exists: tag object c09ff2b761413d306332a7b809452a65945a5657 points to commit 0d01ee29ae6039e74330842ed45be8b7fe1216c5.

A historical statement that no tag existed then cannot be deemed fabricated because one exists today. Continuing to treat it as available in current release instructions is nevertheless incorrect. A tag also does not prove a successful npm publication; verify them separately.

### D03 · P2 · Release-surface, branch and next-step descriptions are stale

- [DEVELOPMENT.md](../../DEVELOPMENT.md) lines 20, 43–46 and 83 describe 30 elements, five per capability and one nonvisual exception. [check-architecture.mjs](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/scripts/check-architecture.mjs) lines 20–36 explicitly specify 6 for Score Play and 5 each elsewhere, totaling 31. [ui-catalog.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/apps/doc/shared/ui-catalog.ts) lines 21–26 include rack-part; the behavior entries are rack-part and audio-analysis. rack-part exists in main's commit history, not only in uncommitted changes.
- Handbook lines 99–101 say dev lacks these governance documents, but local origin/dev@ccf8d2e already contains them; local dev@7fae2c5 has diverged from that ref. Distinguish the local branch, remote-tracking ref and specific commit.
- Handbook lines 132–139 list Quick Start, the UI Kit migration and Headless split as next steps, while [docs-site-backlog.md](../../plans/docs-site-backlog.md) line 8 already declares all nine items closed and the pages exist.
- [HEADLESS-PAGE-TEMPLATE.md](../../docs/HEADLESS-PAGE-TEMPLATE.md) lines 9–12 still describe today's pages as aggregated; [UIKIT-PAGE-TEMPLATE.md](../../docs/UIKIT-PAGE-TEMPLATE.md) lines 10–11 still say today's path is /ui/; [DOCS-CONVENTIONS.md](../../docs/DOCS-CONVENTIONS.md) line 122 still says 30 elements.

Move dynamic state out of durable templates. Date historical counts against a commit, and reference the current inventory when updating the active work list rather than copying the old execution plan.

### D04 · P2 · Architecture SSOT navigation omits actual policies

[DEVELOPMENT.md](../../DEVELOPMENT.md) lines 275–282 call package-policy.mjs the sole review point. Actual policy also includes per-tag composition constraints in [element-composition-policy.mjs](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/scripts/element-composition-policy.mjs), element counts in [check-architecture.mjs](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/scripts/check-architecture.mjs) lines 29–36, and presenter categories in lines 46–52.

All affect architecture judgments. Editing only the single file named by the handbook is insufficient for adding elements or changing presenters. List the policy entry points and their responsibilities, or consolidate scattered declarations into an explicit source. Having tables in source does not mean there is only one table.

### D05 · P2 · Several documents misdescribe the current snippet checker

[DOCS-CONVENTIONS.md](../../docs/DOCS-CONVENTIONS.md) lines 148–160 and [DOCS-SITE-PLAN.md](../../docs/DOCS-SITE-PLAN.md) lines 378–382 explicitly say only imports are checked and bodies are not, contradicting the implementation. Handbook line 117 discusses only import validation, omitting existing body compilation. Historical backlog lines 252–262 record the older implementation and are not themselves factually wrong.

[check-doc-snippets.mjs](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/scripts/check-doc-snippets.mjs) lines 125, 156 and 169–176 run tsc twice: first to identify undeclared inputs and supply any placeholders, then to compile bodies and detect some invalid methods, arguments and other uses. The current run passed 153 snippets.

Document the limits too: lines 50–81 collect only ts fences containing the exact single-quoted text from '@webmusic/; line 114 disables strict mode, and undeclared inputs become any. It does not prove runtime success or cover the MDX export const sandbox strings recommended by API-template line 45. The sandbox carriers in [score/api/play.mdx](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/apps/doc/webmusic/src/content/docs/score/api/play.mdx) lines 206 and 254 fall outside the scan. Historical backlog text may preserve the old implementation, but cannot describe the current gate.

### D06 · P2 · UI/Bridge API existence and coverage are misstated

[DOCS-CONVENTIONS.md](../../docs/DOCS-CONVENTIONS.md) lines 43–46 say /uikit/api/ and /bridge/api/ do not yet exist and therefore lack coverage. Both pages exist, and [check-docs.mjs](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/scripts/check-docs.mjs) lines 712 and 717 already invoke checkRootEntryCoverage for them.

The limitation also matters: Bridge is a single-entry package. Excluding root and package.json leaves no subentries, so this check cannot prove that every function, class and type appears in API Reference. Script lines 713–716 explicitly state this limit.

### D07 · P2 · Templates conflict on page ownership and duplication rules

1. [COMPONENT-PAGE-TEMPLATE.md](../../docs/COMPONENT-PAGE-TEMPLATE.md) lines 5–9 require one page per tag, while lines 251 and 261 accept an owning page, anchored section or workflow. [DOCS-SITE-PLAN.md](../../docs/DOCS-SITE-PLAN.md) line 83 also permits companion ownership through anchors. rack-part currently lives on rack-control's page and score-recorder at note-input/#score-recorder; the catalog and redirects explicitly record this design. The template needs a consistent exception for declaration/companion elements so authors do not split out duplicate pages.
2. DOCS-CONVENTIONS lines 36–41 call a capability's partial map duplication, while [API-PAGE-TEMPLATE.md](../../docs/API-PAGE-TEMPLATE.md) lines 124–133 require capabilities to list every subentry. Distinguish the complete authoritative inventory from referenced or generated local navigation, instead of both forbidding and requiring the same handwritten table.
3. API-template lines 170–181 prescribe a fixed Kind set without class/factory, while Site Plan lines 156–167 require Bridge's root API to list ScoreAudioSync and its factories. The template's cross-layer separation rule does not sufficiently state the exception for Bridge root exports; the current Bridge page follows the Site Plan.

These conflicts require clear ownership and applicable exceptions, not merely deleting repeated sentences.

### D08 · P2 · Claims of complete enforcement do not match checker responsibilities

[DOCS-CONVENTIONS.md](../../docs/DOCS-CONVENTIONS.md) lines 3–6 say check-docs.mjs enforces every rule, while lines 79–81 admit some rules are not gated. Its line 156 and [DOCS-SITE-PLAN.md](../../docs/DOCS-SITE-PLAN.md) lines 395–400 still broadly say section order is unchecked and UI Kit lacks shape validation.

[check-architecture.mjs](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/scripts/check-architecture.mjs) lines 1400–1449 iterate all 18 presenter pages, require one LiveDemo and one Related section, and enforce LiveDemo → Import → API → Styling → Related order. The word Aligned in an error message does not exempt some pages. For element pages, [check-docs.mjs](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/scripts/check-docs.mjs) lines 218–224 require only at least one demo and API/Styling blocks; they do not verify every template rule.

Map each rule to its owner, checker, coverage and uncovered portion, with manual rules separate. Passing both gates does not prove dev's factual prose correct; the scripts do not read those statements as claims to verify.

### D09 · P2 · Completing the Headless page split does not establish complete template content

[HEADLESS-PAGE-TEMPLATE.md](../../docs/HEADLESS-PAGE-TEMPLATE.md) lines 64–65 require one owner per symbol, and lines 219–239 require complete API tables. None of Score Play's 13 object pages has the required Import heading and collapsible API table. For example, [score-player.mdx](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/apps/doc/webmusic/src/content/docs/score/headless/play/score-player.mdx) has only 23 lines of introduction and demo. Lines 17–21 already explain borrowing/disposal, so it would be incorrect to say ownership is entirely undocumented.

The template's HeadlessComposedBy component is not implemented. headless-params/index.ts aggregates only score-play, which currently defines only ScorePlayer. The src/lib/headless-params/bridge.ts specified by Site Plan lines 167–168 does not exist and is not marked pending; distinguish target structure from implemented structure.

The Headless check in [check-docs.mjs](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/scripts/check-docs.mjs) lines 392 and 452–454 searches concatenated capability pages for backtick-wrapped value names, excluding types. It does not verify complete API tables, a unique owner for every export, or that overview links reach the page actually documenting an export. checkLinks separately checks ordinary site-absolute links. Track route splitting separately from per-page content and supporting infrastructure so the historical backlog's closed status is not mistaken for acceptance of every template requirement.

### D10 · P2 · Link-check limits are underdocumented and existing broken anchors escape

[DOCS-CONVENTIONS.md](../../docs/DOCS-CONVENTIONS.md) line 30 has site-absolute context, so its claim should not be expanded to all links. It nevertheless omits the fact that same-page fragments are unchecked, while the script header claims every internal link/fragment.

[check-docs.mjs](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/scripts/check-docs.mjs) line 581 matches only ](/...), missing ](#...). All 8 short anchors in [kernel/api.mdx](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/apps/doc/webmusic/src/content/docs/kernel/api.mdx) lines 12–19 are broken: the existing built HTML uses IDs such as events--webmusickernelevents, not short IDs such as events. The documentation gate still passes.

Correct the coverage description and include same-page links in validation. This is a concrete example of a passing check not proving that a reference is complete and usable. The dev-file link scan in this audit did not cover these site fragments.

### D11 · P2 · The MP3 example restriction is too broad

[DOCS-CONVENTIONS.md](../../docs/DOCS-CONVENTIONS.md) lines 100–101 say only WAV can decode, with MP3 limited to streaming without mpg123-decoder. In fact, [decode.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/audio/src/play/core/decode.ts) lines 46–56 first call decodeAudioData when supplied a context, then try WASM after failure. load.ts forwards the context, and the audio-playlist element supplies its player's context.

The actual boundary depends on both a context supporting the format and the installed decoder peer. Source support for native decoding does not establish that every format was tested in every browser during this audit.

### D12 · P3 · Some everyday-check descriptions are inaccurate

[DEVELOPMENT.md](../../DEVELOPMENT.md) lines 269–271 say format checks exclude untracked files, but [check-format.mjs](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/scripts/check-format.mjs) line 14 uses git ls-files -co --exclude-standard and includes non-ignored untracked files. Handbook line 118 also omits kernel and documentation tests from test-typecheck scope, although [tsconfig.test.json](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/tsconfig.test.json) includes them.

### D13 · P2 · audio-view's implementation corrections contain an invalid inference and an overstated delivery claim

- [audio-view-elements.md](../../plans/audio-view-elements.md) lines 371–378 infer that ordinary beat-axis data is unreachable because no downbeats producer exists. [BeatGrid.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/audio/src/core/time/BeatGrid.ts) lines 5–10 require beats and make downbeats optional; the conversions at lines 55 and 79 do not need downbeats. [audio-analysis-timeline.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/audio/src/analyze/element/audio-analysis-timeline.ts) lines 177–191 display ordinary Beat markers, promoting downbeats only to optional Bar markers. Missing automatic downbeat detection does not mean ordinary beat-axis data is absent. The design conclusion that a new ruler element is unnecessary need not be reversed, but its reasoning must be accurate.
- Plan lines 403–407 say every differentiator shipped on audio-view, while the original list at lines 123–127 includes webaudio:probe frequency/db hover events and color-scale binding. Current audio-view event and interaction contracts contain no probe; the same correction at lines 408–409 admits color-scale was never built. Distinguish delivered, unimplemented and unadopted items individually. This finding does not require implementing every old proposal.

### D14 · P3 · Historical-plan outcome tracking and repeated procedures need organization

[DEVELOPMENT.md](../../DEVELOPMENT.md) line 20 explicitly classifies the five expansion plans as Historical, not a work queue. That boundary is sound: original target counts and unadopted components are not automatically documentation defects. Each plan's corrected five-element list broadly matches its capability's current barrels/catalog.

Traceability within the historical material still needs improvement:

- audio-play line 392 and score-view line 367 retain four touchpoints and no package-policy change. audio-view line 321 claims all plans were updated, while its own lines 455–459 admit they were not. These are not current element-authoring instructions; navigation should lead to the actual policies in D04.
- The setLoop/pitch-preservation prerequisites at audio-play lines 50, 135 and 424 exist in player.ts lines 187 and 200. The LiveScrollBuffer/recorder-analyser prerequisites at audio-view line 170 also exist, but outcome tracking does not fully record them.
- score-analyze line 189 proposes a rhythms session/worker path. The actual rhythm-patterns.ts line 77 calls core directly, with no corresponding session field. Correction line 432 explains only the type union, not the complete implementation-path deviation.
- The plans' 30-element/five-per-capability implementation counts should identify their dated snapshots, not continue representing the current 31-element inventory. audio-play lines 415 and 436 also repeat Section 6, making cross-references ambiguous.

Add historical/superseding-source notices at the start and a short outcome table. Preserve the original reasoning without maintaining five current development procedures in five old plans.

### D15 · P2 · The new audit records lack portable references and complete evidence retention

The earlier [project audit](README.md) and [remediation record](FIXES.md) clearly distinguish pre-fix and post-fix state, and their test totals can be verified in existing logs. They are nevertheless unsuitable as unchanged long-term team records:

- The two files contain 68 local Markdown links tied to /Users/mamingchen/GitHub/WebMusic, which do not work as repository-relative links from another checkout or on GitHub.
- A machine-wide ignore rule excludes 20 .log files under evidence and repair-evidence, and they are not tracked. Ordinary git add does not include the referenced evidence; committing only the reports loses essential logs.
- Pre-fix reproduction text explicitly depends on machine-specific absolute paths and the source as it existed then, with many uncommitted changes in the audited tree. No recoverable pre-fix source baseline accompanies the report; today's source and old line numbers alone cannot recreate the same failure state.

These are findings too, even though the reports were newly generated. Use repository-relative links, trackable evidence filenames or explicit retention rules, and preserve the baseline commit, necessary diff and execution instructions when reproducibility is required. Archiving logs and maintaining current behavior documentation are different responsibilities.

## Duplication and ownership: what to retain and what to consolidate

| Information | Parallel maintenance | Recommendation |
| --- | --- | --- |
| Snippet-gate implementation | Handbook, conventions, site plan, backlog | Conventions own current scope; historical records retain date/commit and link to it |
| Migration completion | Handbook next steps, site-plan Done/Open, closed backlog, old review status | One current-status entry; historical state is not a task queue, and old snapshots link to follow-up |
| Public-element counts and branch surfaces | Handbook, catalog, architecture policy, multiple plans | Current counts come from policy/catalog validation; authored summaries are generated or identified as snapshots |
| New element/presenter integration | Each of the five expansion plans | Maintain one current procedure and link to it from historical plans |
| Capability overview/entry-map responsibilities | Site plan, component/API templates, conventions | Site Plan owns page responsibilities; templates elaborate their page kind and exceptions; checker descriptions do not invent new rules |

The lightweight repeated-paragraph scan found only the shared "single backlog" pointer in three templates. Such navigation duplication is harmless. The problem is mostly multiple semantic copies of state and rules, not extensive verbatim copying. Do not delete useful navigation, template structure or dated evidence to pursue zero duplication.

## Per-file assessment

| Audited file | Value to retain | Limit as a current reference |
| --- | --- | --- |
| DEVELOPMENT.md | Operational navigation, build/release cautions, ownership index | Refresh current facts and work; do not keep using stale tag/CI/branch instructions |
| DOCS-CONVENTIONS.md | Gate inventory, directory organization, writing conventions | Correct coverage, media limits and counts; distinguish automated from manual rules |
| DOCS-SITE-PLAN.md | IA, page ownership, URL/sidebar rules | Durable rules mix with migration history; correct Headless-file and checker-state claims |
| COMPONENT-PAGE-TEMPLATE.md | Element-page structure and parameter guidance | Reconcile one-tag/one-page with shared-workflow exceptions |
| HEADLESS-PAGE-TEMPLATE.md | Target object, lifecycle and API structure | Some targets are unimplemented; it is not an inventory of current implementation |
| UIKIT-PAGE-TEMPLATE.md | Presenter structure with substantial automated checks | Remove old-URL "today" claims; preserve verified structure |
| API-PAGE-TEMPLATE.md | Export ownership and reference rules | Clarify capability maps versus root inventory, Bridge exceptions and sandbox-check limits |
| plans/docs-site-backlog.md | Dated migration execution record | Nine items closed; read old snippet behavior and phase status historically |
| plans/repo-review-2026-08-22.md | Commit-specific historical audit that explicitly owns no rules | Preserve its findings; the 2026-08-23 status is not today's backlog or remote state |
| plans/audio-play-elements.md | Component selection and implementation corrections | Historical proposal; add shared-prerequisite outcomes and fix numbering ambiguity |
| plans/audio-analyze-elements.md | Analysis-surface reduction and delivered-component explanations | Historical proposal; replace current-count/integration claims with references |
| plans/audio-view-elements.md | Consolidation, minimap and region-list decisions | Historical proposal; correct the beat-axis reasoning and complete-delivery claim |
| plans/score-analyze-elements.md | Analysis-component proposals and reduction rationale | Record the rhythm session/worker deviation; historical counts are not the current total |
| plans/score-view-elements.md | View proposals and partial-completion record | Recorded partial outcomes are broadly sound; the old integration checklist is not executable guidance |
| audits/2026-09-05/README.md | Pre-fix findings and verification limits | Historical evidence; add portable links, log retention and a reproduction baseline |
| audits/2026-09-05/FIXES.md | Post-fix changes, compatibility and verification | Test totals are verifiable; portable links and log retention still need work |

## Proposed SSOT responsibilities and completion order

These are recommendations, not overrides of maintainer decisions.

| Fact or rule | Authority | dev's responsibility |
| --- | --- | --- |
| Actual public APIs, versions, dependencies and entries | Package manifests, barrels, public types | Reference or generate inventories rather than hand-copy another set |
| Architectural permissions and rationale | ARCHITECTURE.md, all explicit policy tables and their checkers | Complete navigation, decision rationale and exceptions |
| Development commands and actual CI coverage | package.json, ci.yml, tsconfig, checkers | Handbook explains execution; conventions specify accurate coverage limits |
| Site IA and page responsibilities | DOCS-SITE-PLAN.md | One responsibility owner, elaborated by four templates; checker descriptions map rules |
| Current priorities and unfinished work | One explicit current-status/backlog entry | Link findings, acceptance criteria and implementation evidence without repeating completion state |
| Historical proposals, audits and experiments | Archives with date/commit/status/follow-up pointers | Preserve evidence and mark it as neither current implementation nor next-step list |
| External publication, archival and deployment state | Remote evidence with verification time | Distinguish verified from unverified; do not infer npm state from local tags or prose |

Priority order:

1. Correct D01–D06 and D11–D12, removing CI, tag, gate and current-state claims that directly mislead execution.
2. Reconcile D07's exceptions and explicitly record D08–D10's actual coverage and unfinished Headless work; page splitting does not establish content acceptance.
3. Retain historical reasoning in the five plans, add status/follow-up pointers and key outcomes, and correct D13's substantive errors.
4. Repair D15's evidence retention and portability, then add lightweight dev-documentation checks for links, baseline/status fields, authority navigation and dynamic inventories derived from manifests/policy.

The existing DEVELOPMENT ownership table can evolve into navigation; adding a file is not a reason to create a duplicate handbook. A short dev/README may route readers, but should not store another copy of current counts, rules or work.
