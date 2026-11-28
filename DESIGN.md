---
name: Horsemen viewer
description: The record canvas and reader for Horsemen projects.
colors:
  ground: "#f1ebdf"
  surface: "#fbf8f2"
  ink: "#16130f"
  primary: "#16130f"
  vision: "#7a5808"
  progress: "#a8301d"
  brain: "#33407a"
  anatomy: "#22604f"
typography:
  body:
    fontFamily: Vellum
    fontSize: 1.03125rem
rounded:
  card: 12px
---

# Horsemen viewer

## Overview

Lead with the next action, then show the map and its evidence. The canvas
orients; the reader supplies detail. This file follows the open
[DESIGN.md format](https://github.com/google-labs-code/design.md).

## Colors

These tokens describe Engraved Bone, the default light palette. Use record
colors for emphasis, not as a substitute for the record’s name and seal. Use
the active light or dark palette in [the stylesheet](web/style.css).

## Typography

Engraved uses Vellum for long reading, Halden for controls, and Signal for
code. Other themes can change typefaces without changing hierarchy.

## Layout

Keep the four core records prominent and supporting material separate. Offer
a path to the source and evidence from both the canvas and the reader.

## Components

Pair each record seal with a text label. A section card opens the right part
of the reader. The Junction icon remains four connected core records.

## Do's and Don'ts

- Do preserve keyboard focus and respect reduced-motion choices.
- Do check the reader at desktop and narrow widths.
- Don't hard-code the light palette into shared components.
- Don't use fictional demo data to describe a live project.
