---
type: atomic
tags: [ops]
---
A database process consuming the machine can be ended without restarting the
server: find the session identifier, then terminate that backend
specifically. Killing the whole process would take every other connection
with it.

Related: [[Ops/Service Will Not Start]]
