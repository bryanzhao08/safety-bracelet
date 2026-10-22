# Homebound: rules for every agent

Read ARCHITECTURE.md and CONTRACT.md first. They are the source of truth, and **only Claude edits them**. If
something in them is wrong or missing, stop and write the question in `QUESTIONS.md` instead of improvising.

## Ownership (don't touch files you don't own)
- Codex: `server/**`, `package.json`, `test/**`, `scripts/**`
- Antigravity: `web/**`
- Claude: `ARCHITECTURE.md`, `CONTRACT.md`, `AGENTS.md`, `GEMINI.md`, `README.md`

## Ground rules
- Node 24, ES modules, `node:sqlite`. The only allowed runtime dependency is `web-push`. No frameworks or build steps for web.
- **Privacy rule:** organizer and monitor surfaces must never show or receive who-left-with-whom, destination,
  circle data or device ids. See the invariants in CONTRACT.md.
- Run locally with `npm start` (server on :4400 serving web/). Tests: `npm test` (node --test).
- Commit small and often on branch `main` with clear messages. Never push (there's no remote yet). Never commit secrets.
- Accessibility: guest screens must work one-handed, at night, slightly impaired: big targets (≥ 56 px), high
  contrast, plain words, no tiny text. Help is always one tap away.
- When done with a task, append a short status note to `STATUS.md` (what works, how to run it, what's left).
