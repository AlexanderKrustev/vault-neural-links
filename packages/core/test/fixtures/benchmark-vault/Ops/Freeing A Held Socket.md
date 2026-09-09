---
type: atomic
tags: [ops]
---
When a service will not start because something already holds the address it
wants, find whatever owns that address and end it. On Windows use
`netstat -ano` to get the owning identifier, then `taskkill /PID <id> /F`.
On Unix `lsof -i` gives the same answer and `kill -9` ends it.

Related: [[Ops/Service Will Not Start]]
