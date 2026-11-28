# Security policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue or pull request for a security
problem.

This repository currently has **no published security contact address**, and
GitHub private vulnerability reporting is **disabled** on the repository
(checked with `gh api repos/engralaminn-collab/friendconnect_alo/private-vulnerability-reporting`
→ `{"enabled":false}`). The repository owner must enable it under
*Settings → Code security → Private vulnerability reporting*, or publish a
contact address here, before reports can be received safely. Until then, report
privately to the repository owner through the channel they already use with you.

When reporting, include: the affected route or file, steps to reproduce, the
account type used (anonymous, user, admin), and the expected versus observed
behaviour. Do not include real user data, credentials, or production secrets.

## Scope and status

Security work is tracked in `docs/SECURITY_AUDIT.md` and
`docs/REMEDIATION_MATRIX.md`. Status labels there are evidence-based; a finding
marked OPEN or BLOCKED is not represented as fixed.

## Licence

The repository has no licence file and `package.json` declares none. No licence
is granted by this file. The owner must choose one before others may reuse the
code.
