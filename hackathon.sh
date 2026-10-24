mkdir -p "$HOME/vibeforge/hackathon-04"
cat > "$HOME/vibeforge/hackathon-04/STATE.md" <<'VIBE_STATE_001'
# hackathon-04 — Prompt Operations Hackathon — state ledger

## Verified from captured hub data
- Team: Kia.M, solo, kia.mikkonen@gmail.com
- Challenge picked: bahn only (bahnexpress.fi)
- Write-up: hasProject false, readyToSubmit false
- Missing required: project name, description
- Missing recommended: tagline, cover photo, demo link
- Phase: open. Submitted: no.

## Clock
- Deadline: 2026-10-25T13:00:00Z
- Opening ceremony: 2026-10-24 07:00Z to 08:00Z
- Hacking starts: 08:00Z. Challenge picks: 15:00Z. Doors close: 20:00Z.
- Session clock observed at roughly 08:47Z on 2026-10-24, so the locked-brief
 reading is stale and must be re-queried.

## Unverified
- Bahn brief text
- Judging criteria specifics
- Prize summary
- Submission email

## Open risks
- Public gist exposes team join code and rentry edit code. Rotate both.
- Write-up does not exist. This is the only state that loses outright.

## Next
1. Re-query list_challenges for hackathon-04 (brief reveal + email + prizes).
2. Sign in at the hub, create write-up shell with real name and description.
3. Draft Bahn narrative against public positioning, swap specifics on reveal.
VIBE_STATE_001
python3 - <<'VIBE_STATE_002'
from pathlib import Path
p = Path.home() / "vibeforge" / "hackathon-04" / "STATE.md"
t = p.read_text(encoding="utf-8")
print("WROTE:", p)
print("BYTES:", len(t))
print("DEADLINE_PRESENT:", "2026-10-25T13:00:00Z" in t)
print("SECRETS_ABSENT:", "KJ6JBH" not in t and "Vibeforge" not in t)
print("----- first 400 -----")
print(t[:400])
VIBE_STATE_002