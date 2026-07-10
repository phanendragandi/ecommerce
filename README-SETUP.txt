QuickCart — Claude Code Orchestration Bundle
============================================

Copy these into your repository root:

  CLAUDE.md                      → repo root (Claude Code reads it every session)
  ORCHESTRATION.md               → repo root
  .claude/agents/*.md            → 8 subagents (commit them so the team shares them)

Then, inside the repo, start Claude Code and kick off with:

  "Read CLAUDE.md and ORCHESTRATION.md. Start Phase 0, then proceed
   phase by phase, delegating to the subagents and enforcing every gate."

Notes:
- Subagent files are loaded at session start — restart Claude Code after copying.
- Before Phase 1, create your Supabase project and run `npx supabase link`.
- Before Phase 6, confirm your Hostinger plan is a VPS (shared hosting cannot run Node).
