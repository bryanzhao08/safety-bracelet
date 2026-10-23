# Task: Sample-event entry points + meetups in the UI (Antigravity, agent B).

Own ONLY these folders: `web/site/`, `web/pilot/`, `web/admin/`, `web/dashboard/`, `web/door/`, `web/program/`.
Agent A is adding, in `web/shared/config.js` and `api.js`:
- `startDemo()`, `exitDemo()` and `isDemo()` (an in-browser sample event)
- `recordMeetup()`

Read STATUS.md for their final names. If they aren't there yet, write against these names, guarded by
`typeof === 'function'`.

1. **Site hero and the pilot page:**
   - Add a primary button "Try a sample event". It calls `startDemo()`, then goes to `../dashboard/`.
   - Under it, one line: "Opens a pretend party in your browser. No sign-up."
2. **Every app page** (door, dashboard, admin, program): when `isDemo()` is true, show a slim glass banner at the
   top, "Sample event. Nothing here is real.", with links to "Open door scanner", "Open dashboard" and "Exit
   sample" (`exitDemo()`, then go to `../site/`).
3. **Meetups:**
   - The admin guest timeline renders `type:'met'` entries ("Met Jess" with a pink dot) among the in/out
     events, in time order.
   - Dashboard roster rows show a small meetup count when > 0 ("3 meetups").
4. **Site "How it works":** add a step about meetups: guests tap their phone to a friend's band to log that they
   met. It works on iPhone and Android with no app.
5. Keep Liquid Glass, relative URLs, and no sideways scroll at 390 px.

## Verify
- Using Chrome DevTools Protocol mobile emulation at 390 × 844, click "Try a sample event" on `/site/`.
  Screenshot to `web/_screens/demo-*.png`:
  - the dashboard
  - the door (check someone in using a demo band code)
  - the admin timeline for a guest with meetups
- Look at them and fix problems.
- `npm test` passes.
- Append to STATUS.md. Don't run git.
