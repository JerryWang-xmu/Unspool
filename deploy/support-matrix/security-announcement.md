# Security announcement process

Security fixes are announced with an affected-version matrix, impact, prerequisites, mitigations, and validation evidence. Advisories never include secrets, private content, exploit canaries, or production paths.

Emergency advice starts with **disable federation** and **stop affected Runs**. Upgrade advice requires a verified cold backup, schema compatibility check, and restored-history verification. Each Beta level has an independent release decision; passing B0 does not imply B1, and passing either does not imply GA.

Current explicit validation limitation: Docker runtime bypass is not claimed because the daemon was unavailable. Some GUI E2E fixtures remain unexecuted. These limitations must be listed as open items, never converted into passes for an announcement.
