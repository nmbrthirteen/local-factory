# Security

Report vulnerabilities privately through [security advisories](https://github.com/nmbrthirteen/local-factory/security/advisories/new), not public issues. Include steps and the version you ran.

## Protected

- The API listens on loopback only and needs a session cookie plus matching Host and Origin.
- Agents work in their own worktree with network off and writes limited to it and the package cache.
- The OpenCode server runs under `sandbox-exec` too. It keeps network access for the model provider and writes only to the worktree, the cache, and OpenCode's own folders.
- The worktree's `.git` file stays read-only in the factory's sandboxes, and factory Git calls use the gitdir recorded in the main repository.
- The preview app can listen on loopback and connect only to its own port. The preview browser reaches that port alone, so pages cannot reach the factory's API.
- Merge and pull requests ask you to confirm when no check ran.
- Your agent settings, hooks, plugins, and MCP servers stay out of runs.
- Revert and `gh` commands are rebuilt on the server from a fixed allowlist.

## Not protected

- "Automatic, full access" approves every escalation an agent asks for: network hosts, commands outside the sandbox, and edits outside the worktree. It removes the sandbox protections above for every harness. Use "Automatic, sandboxed" when you are not watching.
- Repository scripts run during setup and checks, so connect only repositories you trust.
- Merge runs your repository's Git hooks in your main checkout. Hooks kept in the repository, such as Husky's, run the version on the task branch.
- Commands you run from the interface use your shell, outside the sandbox.
- Other local processes running as you can reach the API.
- Task text and code go to the model provider you pick.
