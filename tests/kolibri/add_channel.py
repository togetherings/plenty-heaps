"""
Adds the built game to a test channel inside a real Kolibri, and makes a learner.

Runs inside Kolibri's shell (used by the "Real Kolibri" job in .github/workflows/build.yml):

    PH_ZIP=dist/plenty-heaps-0.1.0.zip kolibri manage shell -c "exec(open('tests/kolibri/add_channel.py').read())"

This is what importing a channel from Kolibri Studio does, done by hand: the zip goes into
Kolibri's content storage under its checksum, and a channel with one HTML5 resource points
at it. Only use it on a throwaway Kolibri.
Writes tests/kolibri/channel.json ({channel_id, node_id, content_id}) for the browser test.
"""
import hashlib
import json
import os
import shutil
import uuid

from kolibri.core.auth.models import Facility, FacilityUser
from kolibri.core.content.models import ChannelMetadata, ContentNode, File, LocalFile
from kolibri.core.content.utils.paths import get_content_storage_file_path

ZIP = os.environ["PH_ZIP"]
LEARNER, PASSWORD = "amina", "learner123"

# 1. The zip, in content storage under its checksum (as Kolibri keeps every file)
with open(ZIP, "rb") as f:
    checksum = hashlib.md5(f.read()).hexdigest()
target = get_content_storage_file_path("%s.zip" % checksum)
os.makedirs(os.path.dirname(target), exist_ok=True)
shutil.copyfile(ZIP, target)
local = LocalFile.objects.create(id=checksum, extension="zip", available=True, file_size=os.path.getsize(target))

# 2. A channel: a topic with one HTML5 resource in it
channel_id = uuid.uuid4().hex
root = ContentNode.objects.create(
    id=channel_id, content_id=uuid.uuid4().hex, channel_id=channel_id,
    title="Plenty Heaps test channel", kind="topic", available=True,
)
node = ContentNode.objects.create(
    id=uuid.uuid4().hex, content_id=uuid.uuid4().hex, channel_id=channel_id, parent=root,
    title="Plenty Heaps", kind="html5", available=True,
)
File.objects.create(id=uuid.uuid4().hex, local_file=local, contentnode=node, preset="html5_zip")
ChannelMetadata.objects.create(id=channel_id, name="Plenty Heaps test channel", root=root, version=1)
try:  # newer Kolibris keep a few summary fields on the channel (language, size, ...)
    from kolibri.core.content.utils.annotation import set_channel_metadata_fields
    set_channel_metadata_fields(channel_id)
except Exception as e:  # not needed to play, so carry on
    print("note: couldn't set the channel's summary fields: %r" % e)

# 3. A learner
facility = Facility.get_default_facility()
user = FacilityUser.objects.create(username=LEARNER, full_name="Amina Learner", facility=facility)
user.set_password(PASSWORD)
user.save()

with open(os.path.join("tests", "kolibri", "channel.json"), "w") as f:
    json.dump({"channel_id": channel_id, "node_id": node.id, "content_id": node.content_id,
               "learner": LEARNER, "password": PASSWORD, "facility": facility.id}, f)
print("Added %s as resource %s in channel %s; learner %s" % (os.path.basename(ZIP), node.id, channel_id, LEARNER))
