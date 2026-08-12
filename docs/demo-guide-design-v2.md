# Demo Guide v2 — Design Proposal

**Status:** Approved and implemented August 7, 2026  
**Implementation target:** `js/app.js` and existing Demo Guide styles  
**Scope:** Public Demo Plant only  
**Data/schema impact:** None

## 1. Summary

Demo Guide v2 should help a first-time visitor understand AP Tracker through a short sequence of real actions while making it unmistakable that the public plant is a fictional, temporary sandbox.

The existing seven-task structure remains recognizable, but the guide will:

- disclose that demo names, equipment, people, and issues are fictional;
- use the new synthetic Zone A–F terminology;
- distinguish opening a feature from actually completing a task;
- guide visitors directly to the relevant control;
- explain that demo activity is temporary;
- use a clearer, less sales-oriented completion state.

## 2. Goals

1. A visitor understands the floor map, issue lifecycle, routing, workflow, filters, exports, and supporting tools.
2. A visitor can complete the guide without already knowing AP Tracker gestures or terminology.
3. No guide copy implies that demo data represents a real facility.
4. Progress reflects meaningful user actions, not merely clicking navigation buttons.
5. The experience remains effective on phones and tablets.

## 3. Non-goals

- Redesigning the floor map, issue form, issue cards, or spotlight tour.
- Adding new Firestore collections or analytics infrastructure.
- Changing permissions or Demo Plant reset behavior.
- Teaching every AP Tracker feature.
- Turning the guide into a mandatory onboarding flow.

## 4. Proposed guide structure

### Header

**Kicker:** Demo Guide  
**Title:** Learn AP Tracker with a hands-on sandbox  
**Supporting notice:** All plant names, equipment IDs, people, and issue data in this demo are fictional. Activity in the shared demo is temporary and may be cleared.

Retain the previous/next controls, progress count, Reset, Start tour, and Hide actions.

The privacy notice should be visually secondary but always visible while the guide is expanded. A shield or information icon may accompany it, but the message should not resemble an error warning.

### Tasks

| # | Task | Description | Button | Completion event |
|---|---|---|---|---|
| 1 | Explore the floor | Explore synthetic zones and see how press colors summarize active work. | View map | Visitor selects a press or changes a map mode. |
| 2 | Log an issue | Open a synthetic press and create a sample floor issue. | Log sample issue | A new issue is successfully created during the demo session. |
| 3 | Route the work | Add a status entry and route the issue to the appropriate response team. | Show me how | A non-default routing/status entry is successfully saved. |
| 4 | Move the workflow | Progress routed work through Called, Accepted, In Progress, or Finished. | Open workflow | A workflow state is successfully changed. |
| 5 | Narrow the view | Filter the issue log by zone, press, status, shift, owner, or text. | Open filters | Any filter differs from its default value. |
| 6 | Export a handoff | Preview or download the currently filtered issue report. | Open exports | A PDF preview or file export is initiated. |
| 7 | Explore plant tools | Open Wiki, Notes, Todos, or Messages to see how context stays with the plant. | Show tools | Any named tool is opened. |

## 5. Interaction design

### Navigation versus completion

Guide buttons navigate, open, or highlight the UI needed for a task. They do not mark action-based tasks complete.

Completion is awarded only by the application event listed in the table above. This applies especially to Log an issue, Route the work, and Move the workflow.

If an action cannot be completed because the demo is operating in its local fallback mode, the guide may accept the equivalent successful in-memory action. Opening a surface alone should still not count.

### Task 1: Explore the floor

- Switch to `+ Report` map mode.
- Scroll the synthetic Zone A–F map into view.
- Pulse the first available press, normally `AX-101`.
- Remove the stale `1.01` fallback and use `AX-101` if no configured press can be resolved.

### Task 2: Log an issue

- Open the issue form for the currently selected synthetic press, or `AX-101` by default.
- Optionally prefill a clearly fictional example note such as “Demo: sensor check requested.”
- Do not submit automatically.
- Complete the task only after issue creation succeeds.

### Task 3: Route the work

- Scroll to the visitor's newly created issue when available; otherwise use the first open seeded issue.
- Expand the issue card.
- On touch layouts, demonstrate or pulse the swipe-left area.
- On all layouts, highlight the `+ Add` status control.
- Keep the existing visual route cue, revised to:

`Swipe left or + Add → Response team → Reason (or Skip)`

- Complete only after a routing/status entry succeeds.

### Task 4: Move the workflow

- Keep the relevant issue card expanded.
- Highlight the workflow control associated with its current status entry.
- Explain that teams may progress through Called, Accepted, In Progress, and Finished depending on status configuration.
- Complete after any valid workflow transition succeeds.

### Tasks 5–7

- Preserve the existing navigation behavior.
- Mark complete from the actual filter, export, or tool-open event.
- If several tools satisfy Task 7, the first qualifying tool completes it.

### Progress and celebration

- Keep local progress in browser storage.
- Advance to the next incomplete task after a genuine completion event.
- Retain a lightweight completion animation, but reduce repeated confetti: use confetti only after all tasks are complete. Individual tasks should use a check animation or brief highlight.
- Reset clears guide progress only; it does not delete demo issues or reset the shared plant.

## 6. Completion state

Replace the current completion panel with:

**Title:** You’ve completed the demo  
**Body:** You explored the floor, logged and routed work, used workflow controls, filtered the issue log, and opened reporting and plant tools.

Display two choices:

1. **Explore again** — resets local guide progress and returns to the first task.
2. **Create a live plant** — reveals the existing plant name and role form.

Before revealing the form, show this explanation:

> A live plant creates a private production workspace with its own equipment layout, members, statuses, and issue history. Demo activity is not copied into it.

The live-plant form should not appear automatically merely because the final task was completed. This separates accomplishment from conversion and prevents accidental workspace creation.

## 7. Spotlight tour updates

The spotlight tour and checklist serve different purposes:

- **Checklist:** hands-on tasks and progress.
- **Tour:** passive orientation to screen regions.

Revise the first spotlight step to say:

> This is a fictional, shared sandbox. Use the checklist to try real actions, or continue this tour for a quick look at the main tools. Demo activity is temporary.

Revise the floor-map step to say:

> Synthetic zones and presses model a plant floor without representing a real facility. Colors and zone summaries show where attention is needed.

Keep the tour optional and replayable from the Demo Mode user menu.

## 8. Accessibility and responsive requirements

- Privacy text must be readable by assistive technology and not conveyed by icon or color alone.
- Guide buttons must retain descriptive accessible names.
- Highlighting must not be the only instruction; accompanying text must name the control.
- Swipe instructions must always mention the equivalent `+ Add` action.
- Focus should move into an opened modal, drawer, or menu using the surface's existing focus behavior.
- Progress updates should be announced through a polite live region.
- Motion should respect `prefers-reduced-motion`; disable confetti and reduce pulsing when requested.
- At narrow widths, privacy copy, navigation, and the active task must remain visible without horizontal scrolling.

## 9. Event wiring plan

Reuse `completeDemoGuideStep(key)` and call it only from successful application outcomes:

| Key | Proposed trigger location |
|---|---|
| `floor` | Successful press selection or map-mode change initiated by the visitor. |
| `log` | Issue-create success path after local/remote persistence succeeds. |
| `route` | Status-entry save success path when the saved status represents routing. |
| `workflow` | Workflow-state update success path. |
| `filters` | Filter state-change handler when state is non-default. |
| `export` | PDF preview, PDF download, or spreadsheet export initiation. |
| `tools` | Successful open handler for Wiki, Notes, Todos, or Messages. |

Guide action-button handlers should only navigate. Existing calls that complete a task from those buttons should be removed or narrowed.

## 10. Privacy requirements

- The guide must refer to “synthetic zones” rather than implying a real mapped floor.
- Example press IDs must come from the Demo Plant layout, such as `AX-101`.
- Example people and notes must remain fictional.
- No former press naming scheme should appear in guide copy, fallbacks, seeded examples, or client-visible constants.
- The notice must not claim that every visitor has an isolated session; the current experience is a shared demo with an offline local fallback.

## 11. Acceptance criteria

The design is complete when all of the following are true:

- The expanded guide clearly identifies the demo data as fictional and temporary.
- Every visible guide reference uses synthetic Zone A–F terminology.
- No task is completed solely because its navigation button was clicked.
- Log, route, and workflow tasks complete after their respective successful actions.
- Route guidance expands an issue card and points to both swipe-left and `+ Add` paths.
- The stale `1.01` fallback is replaced with `AX-101`.
- Reset Guide does not imply or perform a Demo Plant data reset.
- The completion panel does not immediately expose the live-plant form.
- The spotlight tour contains the updated sandbox and synthetic-floor language.
- Keyboard, touch, reduced-motion, and narrow-screen behaviors meet Section 8.
- Existing non-demo plant behavior is unchanged.

## 12. Verification plan

1. Start a fresh demo session with empty guide progress.
2. Click every guide button without completing its action and confirm progress does not advance incorrectly.
3. Complete all seven qualifying actions and confirm each task advances once.
4. Repeat using the local demo fallback path.
5. Verify touch routing instructions on a phone-sized viewport and button routing on a wider viewport.
6. Verify the privacy notice and completion state with keyboard-only navigation and reduced motion enabled.
7. Reload midway and confirm local progress is preserved.
8. Reset progress and confirm demo issues remain intact.
9. Open a non-demo plant and confirm guide logic and copy do not appear.

## 13. Approval decisions

Before implementation, approve or revise these choices:

- [ ] Use the proposed privacy notice verbatim.
- [ ] Require genuine application events for all task completion.
- [ ] Prefill the sample issue note with fictional demo text.
- [ ] Reserve confetti for full-guide completion only.
- [ ] Hide the live-plant form behind an explicit “Create a live plant” choice.
- [ ] Keep seven tasks rather than shortening the guide.
