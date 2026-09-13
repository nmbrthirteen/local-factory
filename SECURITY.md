# Security

Report vulnerabilities privately through [security advisories](https://github.com/nmbrthirteen/local-factory/security/advisories/new), not public issues. Include steps and the version you ran.

## Protected

- The API listens on loopback only and needs a session cookie plus matching Host and Origin.
- Agents work in their own worktree with network off and writes limited to it and the package cache.
- Your agent settings, hooks, plugins, and MCP servers stay out of runs.
- Revert and `gh` commands are rebuilt on the server from a fixed allowlist.

## Not protected

- Repository scripts run during setup and checks, so connect only repositories you trust.
- Commands you run from the interface use your shell, outside the sandbox.
- Other local processes running as you can reach the API.
- Task text and code go to the model provider you pick.
