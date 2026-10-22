# Antigravity: CSV-first guest import (web/admin/ only)
The organizer doesn't have Luma Plus, so CSV is the main path. In web/admin:
1. Put **Upload guest list (CSV)** first, with a drop zone and two short how-tos:
   - Luma (free): your event → Manage → Guests → Download / Export CSV.
   - Partiful: your event → Guest list → Export (CSV).
   Then show the result "Imported 84 · skipped 12 (declined 5, waitlist 4, maybe 3)" from the response's skippedReasons.
2. Move the Luma API form under a collapsed "Luma API (Luma Plus only)" section.
Keep it small. Commit if git works; append one line to STATUS.md.
