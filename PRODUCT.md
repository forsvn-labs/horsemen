# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Operators who use Horsemen to keep project context. The first audience is still
undecided. The design uses a solo operator managing several projects as a test
case, not a confirmed market decision.

## Product purpose

Show projects and their records in a canvas. Let operators peek at every
artifact, with a view suited to its content. Connect GitHub for discovery and
support public sharing. Keep the product open source and self-hostable.

## Stack

The design exploration uses offline HTML, CSS, and JavaScript. This is a
prototype choice under the owner's instruction to proceed with design.
The local preview uses the same browser stack and a Python standard-library
server. GitHub CLI supplies the existing sign-in.

## Capabilities and constraints

The owner chose a private local app first on 2026-11-18. The local preview
reads GitHub projects and their Markdown through `gh`. Public sharing and
hosted sign-in remain future work. Markdown remains the source; no GUI edits
are available. The separate offline design still uses labeled fictional data.

## Evidence on hand

[VISION](VISION.md) owns direction. [GUI requirements](docs/product/gui-requirements.md)
own the current requirements draft. Existing records and templates establish
the content contract. No GUI adoption evidence exists yet.
