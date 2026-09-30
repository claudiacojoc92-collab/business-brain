# Operator cheat sheet: the development loop

For anyone driving Claude Code on Business Brain. Based on Anthropic's
[AI-native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook) (Aug 2026), adapted to
this repo. You decide *what* and approve each gate; Claude does the drafting, building, and checking.

```
 START ──► PLAN ──► BUILD ──► VERIFY ──► SHIP ──► END SESSION
   ▲       intent    code      tests      commit    status log
   │       plan.md             live check PR/deploy handoff
   └──────────────── CONTINUE (next session reads the log) ◄────┘
```

## 0. First time only
```bash
nvm use            # Node 20 (.nvmrc)
make setup         # install, .env, key preflight, local DB up, migrate
```
Read `README.md` and `CLAUDE.md`. Rules you must know: never push without approval, run the env-key
preflight before any api restart, never print secrets, frozen slices stay frozen.

## 1. START a session
Open Claude Code in `~/Desktop/business_brain`. Say:
> "Orient: git status, current branch, last 5 commits, and anything in progress under intent/."

Check you're on the right branch. If picking up existing work, jump to **6. CONTINUE**.

## 2. PLAN (gate: you approve before any code)
**a. Intent.** For anything bigger than a one-line fix:
> "Create intent/<YYYY-MM-DD>-<slug>/ from the template. Here's what I want and why: ... Ask me
> questions until the intent is clear."

Review `intent.md`. Is the Outcome checkable? Are constraints and out-of-scope right? Then approve:
> "Intent approved, commit it."

**b. Spec (only for larger or risky work).** "Write spec.md for this intent." Review, approve.

**c. Plan.** Switch to plan mode (Shift+Tab, or the mode selector), then:
> "Write plan.md for this intent: files, work order, tests, risks."

Correct it. Look hard at **Risks**: frozen code? migration? prod data? Approve:
> "Plan approved. Implement it."

## 3. BUILD
- Let Claude work. It follows `CLAUDE.md` and `docs/operations/agent-sop.md`.
- Independent pieces can go to sub-agents in parallel: "Use sub-agents for X and Y."
- Interrupt freely if it drifts from the plan. Changing the plan = update plan.md first.

## 4. VERIFY (gate: evidence, not claims)
Ask for proof:
> "Run the tests for what changed, tsc, and eslint. Then show me it working live."

You should see real output: test counts, a screenshot, a curl response, or a DB query. "Should work"
is not verified. For UI work, Claude uses the browser pane and sends you a screenshot.

## 5. SHIP (gate: you approve each step)
| Step | Say | Notes |
|---|---|---|
| Commit | "Commit this on the current branch." | Claude never commits unasked |
| Review | "/code-review" | Fix findings before pushing |
| Push | "Push it." | Only when you say so. Never automatic |
| PR | "Open a PR to main." | Human code owner approves; Claude never approves its own code |
| Deploy | "Deploy api" / "Deploy web" | Runs the env-key preflight first, then checks health |

### Approval phrases (the hooks enforce these, even in bypass mode)
When Claude is blocked it stops and asks. Type the phrase in your reply; it's valid for that one turn.

| Type | Lets Claude |
|---|---|
| `approve push` | git push |
| `approve commit` (or just "commit this") | git commit |
| `approve deploy` | railway up / redeploy / variables --set / domain changes |
| `approve prod` | read prod env vars (they contain secrets) |
| `approve prod-write` | write SQL against the prod DB |
| `approve delete` | rm -r outside the scratchpad, docker volume/image removal, db-reset |
| `approve destructive-git` | reset --hard, branch -D, stash drop, worktree remove |
| `approve migration` | create a new DB migration |
| `approve frozen` | edit a frozen slice (regression fixes only) |
| `approve rules` | change the hooks/rules themselves |

Combine them: `approve commit, push`. Never blocked-with-approval (you'd run these yourself): printing
secrets, force push, bare `railway domain`, api restart without the env-key preflight.

## 6. END a session (2 minutes; this is what makes continuation work)
> "End of session: append a status line to plan.md (done / next / blockers), and tell me
> anything uncommitted."

Then decide: commit the work-in-progress, or leave it uncommitted and note that in the status log.
Anything Claude learned that every future session needs → "add it to the SOP" (or to CLAUDE.md if it's
a hard rule).

## 7. CONTINUE (next session, or a new operator)
> "Continue intent/<date>-<slug>: read intent.md, plan.md and its status log, check git status,
> and tell me where we are before doing anything."

Confirm the summary matches reality, then go back to **3. BUILD** (or **2c** if the plan needs changing).

## When production breaks (Maintain stage)
> "Read-only: diagnose <symptom> from railway logs and the prod DB. Don't change anything. Write the
> fix as a new intent."

The fix then goes through the normal loop: intent → plan → build → verify → ship.

## Where things live
| What | Where |
|---|---|
| Rules for Claude | `CLAUDE.md` (+ `apps/*/CLAUDE.md`, `database/CLAUDE.md`) |
| How Claude works day to day | `docs/operations/agent-sop.md` |
| Work records | `intent/<date>-<slug>/{intent,spec,plan}.md` |
| Shared Claude config | `.claude/settings.json` (your personal one: `.claude/settings.local.json`) |
| Setup / running locally | `README.md`, `docs/stand-up-runbook.md` |
| Architecture decisions | `docs/adr/` |

## Not set up yet (next steps from the playbook)
- `REVIEW.md`: review policy and severity levels for `/code-review`.
- Skills in `.claude/skills/` for recurring procedures (deploy, prod read-only diagnosis).
- An eval suite that gates changes to CLAUDE.md, skills, and hooks.
