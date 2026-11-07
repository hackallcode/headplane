---
title: Failover
description: Watch and switch a headscale run by the failover agent.
---

# Failover

When headscale runs on several servers under the
[failover agent](https://github.com/hackallcode/failover), which keeps it
active on one server at a time, Headplane shows a **Failover** page. It lists
each server's agent, which server is active, which can take over, how far its
data is copied and the recent switches, and lets you make another server
active.

## Configuration

List every server's agent API and the token the agents accept:

```yaml
failover:
  token_path: "/run/secrets/failover_token"
  servers:
    - name: "hacode-ru"
      url: "http://100.64.0.110:8480"
    - name: "hacode-nl"
      url: "http://100.64.0.120:8480"
```

- `name` is the agent's node name. A server whose agent answers under another
  name shows as unreachable with that name.
- `token` or `token_path` (see [Sensitive values](/configuration/sensitive-values))
  is sent as a bearer token to `GET /state` and `POST /takeover`.

The page and its navigation entry appear only with `failover` set. Roles that
read the network see it; roles that write the network can switch servers.

## Switching

**Make active** asks the chosen server to take over. The active server stops
and hands over its latest data, the chosen one starts headscale and clients
reconnect without signing in again. When Headplane itself moves with the active
server, the page keeps the last state it saw and answers again once Headplane
starts on the new server.
