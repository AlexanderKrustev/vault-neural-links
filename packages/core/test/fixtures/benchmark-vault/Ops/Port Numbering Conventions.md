---
type: atomic
tags: [ops]
---
A note that talks about ports and processes constantly without answering how
to kill anything. Ports below 1024 are privileged. The process of assigning
a port to a service is conventional, not enforced. Registered ports run to
49151, and the ephemeral port range sits above that.
