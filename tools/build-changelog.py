#!/usr/bin/env python3
"""Render the argus CHANGELOG.md into changelog.html (site chrome, no third-party assets).

Usage: python3 tools/build-changelog.py /path/to/argus/CHANGELOG.md [git-ref]

The page has two parts:
  1. Highlights: tools/changelog-highlights.html (hand-written, short, per release).
  2. Full history: every "## [version]" section of CHANGELOG.md rendered verbatim,
     each in its own <details>, newest open.
Relative links in the changelog are rewritten to GitHub at the given ref (default: main).
"""
import html
import re
import sys
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1])
ref = sys.argv[2] if len(sys.argv) > 2 else "main"
gh = f"https://github.com/RohiRIK/argus/blob/{ref}/"

text = src.read_text(encoding="utf-8")
parts = re.split(r"^## ", text, flags=re.M)
sections = []
for part in parts[1:]:
    head, _, body = part.partition("\n")
    m = re.match(r"\[([^\]]+)\](?:\s*[—-]\s*(.+))?", head.strip())
    if not m:
        continue
    version, date = m.group(1), (m.group(2) or "").strip()
    body_html = markdown.markdown(body.strip(), extensions=["extra", "sane_lists"])
    # Demote headings: ### -> h4 so the page outline stays h1 > h2 > h3 > h4.
    body_html = re.sub(r"<(/?)h3>", r"<\1h4>", body_html)
    body_html = re.sub(
        r'href="(?!https?://|#|mailto:)([^"]+)"',
        lambda mm: f'href="{gh}{mm.group(1).lstrip("./")}"',
        body_html,
    )
    sections.append((version, date, body_html))

if not sections:
    sys.exit("no '## [version]' sections found")

label = lambda v: "Unreleased (on main)" if v.lower() == "unreleased" else f"v{v}"
anchor = lambda v: "unreleased" if v.lower() == "unreleased" else "v" + v.replace(".", "-")

items = []
for i, (v, d, body) in enumerate(sections):
    date = f' <span class="cl-date">{html.escape(d)}</span>' if d else ""
    items.append(
        f'<details class="cl-entry" id="{anchor(v)}"{" open" if i == 0 else ""}>\n'
        f'  <summary><h3>{html.escape(label(v))}{date}</h3></summary>\n'
        f'  <div class="cl-body">\n{body}\n  </div>\n</details>'
    )

highlights = (ROOT / "tools" / "changelog-highlights.html").read_text(encoding="utf-8")
template = (ROOT / "tools" / "changelog-template.html").read_text(encoding="utf-8")
out = (
    template.replace("{{HIGHLIGHTS}}", highlights)
    .replace("{{ENTRIES}}", "\n".join(items))
    .replace("{{SOURCE}}", f"{gh}CHANGELOG.md")
)
(ROOT / "changelog.html").write_text(out, encoding="utf-8")
print(f"changelog.html: {len(sections)} releases from {src} @ {ref}")
