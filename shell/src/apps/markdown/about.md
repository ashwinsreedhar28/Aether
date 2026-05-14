# Markdown

A holographic markdown viewer for **Aether**. Open any `.md` or `.markdown`
file via the button above — the rendered output lands here.

## What this app does

Read-only rendering, today. One file at a time. The first instance of the
file-as-source-of-truth doctrine landing in Aether — the same pattern future
content apps (JSON viewer, ticker CSVs, the morning brief output) will use.

## Supported features

- Headings, paragraphs, **bold**, *italic*, ~~strikethrough~~
- Inline `code` and fenced blocks
- Ordered and unordered lists
- Task lists, like:
  - [x] read `.md` from disk
  - [x] render with the holographic theme
  - [ ] live-reload on edit (future PR)
- Tables, blockquotes, horizontal rules
- Links — they open in the system browser, not in-app

## A small code block

```ts
import { aether } from './shell'

const path = await aether.files.openDialog({
  filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
})
if (path) {
  const text = await aether.files.readText(path)
  render(text)
}
```

## A small table

| Surface       | Status         | Notes                         |
|---------------|----------------|-------------------------------|
| Welcome       | shipped        | v0.0.1                        |
| News          | shipped, faked | v0.0.3                        |
| Markdown      | shipped        | this app                      |
| Mesh devtools | future         | wakes when the spine does     |

> Markdown is the cheapest, most-useful proof of the file-based pattern.
> Once it lands, every later content app drops in behind the same fileApi.

For the design choices behind this app, see `DECISIONS.md` at the repo
root.
