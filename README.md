<p align="center">
  <img src="icon.png" alt="Strip 'em All!" width="160" />
</p>

<h1 align="center">Strip 'em All!</h1>

<p align="center">
  A Figma plugin that detaches every style and variable applied to your selection, replacing them with literal values.
</p>

## Lint mode

Switch to the **Lint** tab in the header to scan a Selection, the
current Page, or the whole File for styles and variables whose source
library is not on this file's allow-list. Findings are grouped by
source library; for each item you can select the affected layers in
the canvas or detach it. Libraries can also be detached in one click,
or you can detach every intruder at once.

The allow-list is per file. By default it includes the file's local
styles and every subscribed library; you can mark or unmark any
detected library to refine it.

Identification of the source library for remote styles is best-effort
(it uses the style's name prefix as a fallback). Variables are
identified reliably.
