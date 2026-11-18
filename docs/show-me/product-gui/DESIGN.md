# Project atlas

An operator opens this on a laptop during a working day to answer: what needs
me, what changed, and where is the proof? A light mineral surface supports long
reading. Deep ink navigation anchors the workspace. Teal, blue, amber, and plum
identify the four records; names and symbols carry the same meaning without color.

The canvas has stable landmarks rather than freely drifting cards. Progress
gets the largest surface because it answers the immediate question. Vision is
a concise brief, Brain a source directory, and Structure a navigable tree.
Supporters sit along a lower rail. Connections show actual relationships in the
fictional example. Selection opens a side peek with full content and source.

Motion has one job: retain place as the peek opens. Focus moves into the peek,
Escape returns it, and reduced-motion mode removes transitions. Small screens
use a vertical reading map. A list view is available at every size.

## Prototype use

Open prototype.html. Switch projects in the left rail, open any artifact, change
between the reading and source views, search the map, or preview a selected
public snapshot. The connection flow demonstrates repository selection with
fictional data. It does not sign in or send anything.

## Limits

No GitHub API, backend, publication, editable Markdown, saved canvas positions,
or external document fetching. All projects and statuses are fictional.
The production stack and first audience remain undecided. Full requirements
are in ../../product/gui-requirements.md.

## Design guidance

Built using [Impeccable](https://github.com/pbakaus/impeccable) guidance for
Operate and Read surfaces: content hierarchy, restrained decoration, meaningful
motion, keyboard access, and rendered verification. The owner asked to proceed
without a delegate, so design choices and verification are performed locally.

## Verification

Run `python3 docs/show-me/product-gui/verify.py --output /tmp/horsemen-design-check`
from the repository root. It requires the installed agent-browser CLI and uses
an isolated session. It checks seven peeks, source views, search, view switching,
sharing exclusions, project switching, zoom, focus return, and reduced motion
at desktop, tablet, and phone sizes. Screenshots and output stay in that output
directory. The Excalidraw scene was serialized, reloaded, rendered, and visually
inspected. These checks cover the demo, not a production integration.
