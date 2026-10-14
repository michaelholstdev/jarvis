# Issue tracker: Local Markdown

Issues and specs live under `.scratch/<feature-slug>/`.

- Spec: `spec.md`.
- Tickets: `issues/<NN>-<slug>.md`, numbered from `01`.
- Record triage state as a `Status:` line near the top.
- Append comments under `## Comments`.
- Publishing means creating the corresponding local Markdown file.
- Fetching means reading the referenced file.

For wayfinding:

- Map: `.scratch/<effort>/map.md`.
- Child tickets use the numbered issue convention.
- Record `Type:`, `Status:`, and any `Blocked by:` dependencies.
- Claim before working; resolve with an `## Answer` and a map pointer.
- Choose the lowest-numbered open, unblocked, unclaimed ticket.
