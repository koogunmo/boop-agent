# Contributing

Boop is a small personal-agent template. The codebase stays tight because that's the whole point — it should be small enough to read cover-to-cover in an afternoon and fork without fear.

## What lands in source

- Bug fixes
- Security fixes
- Simplifications (less code doing the same thing)
- Clear improvements to core behavior — memory decay tuning, consolidation robustness, dispatcher policy, cost tracking, etc.
- New channels, integrations, or runtime skills if they fit the template spirit (small, opinionated, well-scoped)

Keep the diff focused — one concern per PR. A feature PR and a refactor PR should be two PRs.

## Bug-fix PRs

- One fix per PR.
- Update `CHANGELOG.md` under **Unreleased** with a one-line entry.
- If the fix changes external behavior (env vars, Convex schema, HTTP routes, webhook shapes), mark the CHANGELOG entry `[BREAKING]` — see conventions below.

## CHANGELOG conventions

- Entries live under **Unreleased** until a release cut.
- Prefix user-actionable changes with `[BREAKING]`.
- If a breaking change needs a migration (backfill, env var rename, schema transform), ship a **migration skill** at `.claude/skills/<name>/SKILL.md` that Claude can run against a user's fork, and reference it in the CHANGELOG:

  ```
  [BREAKING] <description>. Run `/<skill-name>` to <action>.
  ```

  `/upgrade-boop` parses this format and offers to run the referenced skill during upgrades. The format is the only coupling — without a migration, just write `[BREAKING] <description>.` without the skill reference.

## Skills

Two kinds of skills live in `.claude/skills/`:

**Migration skills** — instruction-only `SKILL.md` triggered by `[BREAKING]` CHANGELOG entries during `/upgrade-boop`. Pure markdown, no branch, no supporting code. Example: `/upgrade-boop` itself is this shape.

**Runtime skills** — `SKILL.md` loaded into the execution agent at spawn time via the Claude Agent SDK's `settingSources`. The model autonomously invokes them when a task matches the skill's `description`. Example: `.claude/skills/youtube-script-writer/`. See the **Skills** section in the README for wiring details.

Both are just Markdown under `.claude/skills/<name>/SKILL.md` with YAML frontmatter. No branching model, no maintainer-owned sibling branches — features land directly on `main` like any normal project.

## Writing a migration skill

1. Fork, branch from `main`.
2. Create `.claude/skills/<name>/SKILL.md`:
   ```yaml
   ---
   name: <name>
   description: One-line trigger description — when /upgrade-boop should offer this.
   ---
   ```
3. Body: numbered operating steps Claude should execute. Lean on `git`, `npm`, file edits. Make the skill idempotent — a user running it twice should be safe.
4. Add the matching `[BREAKING]` line to `CHANGELOG.md` under **Unreleased**.
5. Open a PR with the code change + the SKILL.md + the CHANGELOG entry in one commit.

## Writing a runtime skill

1. Create `.claude/skills/<name>/SKILL.md` with a specific, trigger-rich `description` so the SDK's routing picks it up reliably.
2. Body: the playbook the execution agent should follow when it invokes this skill.
3. That's it — no server code changes needed. The execution agent already loads `.claude/skills/` via `settingSources: ["project"]`.
