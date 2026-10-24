# 06: Linked notes

**What to build:** The summary uses notes one link away from the book, in both directions. Outgoing: each note the book note links to is included in full, up to 1,500 words per note. Incoming: for each note that links to the book, only the paragraph or list item (with its children) holding the link is included. Hub notes like `Books Read` and `2026 Plan` link to dozens of books, and sending them whole would crowd out the book. The book note comes first in the request, then each linked part, labelled with its source path. The footer reports how many notes and words were used.

**Blocked by:** 02 — Tracer bullet

**Status:** ready-for-agent

- [ ] Outgoing wikilinks (including `[[Note|alias]]` and heading links) resolve to notes; unresolved links are skipped silently
- [ ] Incoming links send only the containing paragraph or list item plus its children, never the whole note
- [ ] `Templates/`, `Archive/tana/`, frontmatter-only stubs and anything inside a `book-recall` block are never included
- [ ] Mentions of the book in daily notes outside recall blocks are included
- [ ] Linked context is capped by `maxLinkedWords` (default 4,000) and trimmed before the book note is ever cut
- [ ] `linkedNotes: false` turns the feature off
- [ ] The footer reads e.g. `from 1 book note and 2 linked notes (3,104 words)`
- [ ] Tests cover a book with no links, one with outgoing links only, and one linked from a hub note
