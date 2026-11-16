# Docs

The project was built in phases; each folder holds that phase's decisions and its test report. The newest phase is at the bottom, and the [deploy guide](phase-5/deploy-guide.md) is the page to keep open when releasing.

| Folder | What's in it |
| --- | --- |
| [`phase-0`](phase-0/README.md) | The design baseline: architecture, data model, API surface, pricing, threat model, design tokens, hosting, Mercado Pago setup |
| [`design`](design/README.md) | The R1 design spec (from the Figma concept), prototype and screenshots |
| [`phase-1`](phase-1/README.md) | Foundation and security core, and the first-run instructions |
| [`r1`](r1/README.md) | Redesign foundation |
| [`phase-2`](phase-2/README.md) | Payments: Pix via Mercado Pago, checkout, the order page, "Meus pedidos" |
| [`phase-3`](phase-3/README.md) | Reviews, likes, reports, moderation, public profiles |
| [`phase-4`](phase-4/README.md) | Operations: live schedule, orders, people, overlays, media kit, contact |
| [`phase-5`](phase-5/README.md) | Production: images, Compose stack, nginx, [deploy guide](phase-5/deploy-guide.md), backups, [security checklist](phase-5/security-checklist.md) |
| [`phase-6`](phase-6/README.md) | Every change since Phase 5, one numbered section each (§1–§50) |
| [`security`](security/) | Penetration test reports |

Every phase has a `test-report.md` next to its README with what was tested and the results.

Rules that every change follows (lint- and test-enforced) are in [`AGENTS.md`](../AGENTS.md).
