"""
Checks what Kolibri itself recorded after play_in_kolibri.py (runs inside Kolibri's shell):

    kolibri manage shell -c "exec(open('tests/kolibri/check_saved.py').read())"

  - the save is in the learner's record for the resource (SCORM suspend_data, as the kit
    writes it: {"_v": 1, "_save": "..."}), and
  - the resource counts as done (the first shipment sets SCORM status "passed").
"""
import json
import sys

from kolibri.core.auth.models import FacilityUser
from kolibri.core.logger.models import ContentSummaryLog

info = json.load(open("tests/kolibri/channel.json"))
FAILURES = []


def check(cond, what):
    print(("ok   " if cond else "FAIL ") + what, flush=True)
    if not cond:
        FAILURES.append(what)


user = FacilityUser.objects.get(username=info["learner"])
log = ContentSummaryLog.objects.filter(user=user, content_id=info["content_id"]).first()
check(log is not None, "Kolibri has a record of the learner playing")
if log is not None:
    scorm = ((log.extra_fields or {}).get("contentState") or {}).get("SCORM") or {}
    cmi = scorm.get("cmi") or {}
    data = cmi.get("suspend_data") or ""
    print("       progress %s, %d seconds, status %r, suspend_data %d characters"
          % (log.progress, log.time_spent, (cmi.get("core") or {}).get("lesson_status"), len(data)))
    try:
        record = json.loads(data)
    except ValueError:
        record = {}
    check(isinstance(record.get("_save"), str) and len(record["_save"]) > 20, "the game's save is in Kolibri")
    check(len(data) <= 4096, "the save fits SCORM 1.2 (%d of 4096 characters)" % len(data))
    check(log.progress >= 1, "the resource counts as done after the first shipment (progress %s)" % log.progress)

if FAILURES:
    print("%d check(s) failed" % len(FAILURES))
    sys.exit(1)
print("KOLIBRI RECORDED THE SAVE OK")
