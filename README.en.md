# Varen CAD — an auditable, local-first mechanical CAD agent

Varen CAD turns a natural-language mechanical design task into a reviewable,
parametric assembly prototype. The agent plans parts, executes constrained CAD
operations, records its steps, validates geometry, and refuses to export when
the hard checks fail.

> **Status:** Windows closed beta. This is a concept-design and rapid-prototyping
> tool, not a SolidWorks replacement and not a production-release guarantee.

[中文 README](README.md) · [3-minute quick start](docs/GETTING_STARTED.md) ·
[Beta application](https://github.com/vanyu0710/aicad/issues/new?template=beta_application.yml) ·
[Discussions](https://github.com/vanyu0710/aicad/discussions) ·
[Releases](https://github.com/vanyu0710/aicad/releases)

## Why this repository exists

Most text-to-CAD demos stop when a shape appears on screen. Varen treats the
shape as an untrusted intermediate result. The useful question is whether the
result can be inspected, replayed, exported, and rejected when it violates a
geometric contract.

The current harness includes:

- BOM-first multi-part planning and per-part execution;
- parameter history and structured step results;
- single-solid and feature-contract checks;
- assembly STEP export and pairwise interference checks;
- a failure report intended to become a public regression benchmark.

## What is deliberately out of scope today

The beta does not provide complete 2D drawings, sheet-metal workflows, surface
modeling, thread standards, or a general assembly mate/constraint solver.
`production_ready` remains false. Every output needs engineering review before
manufacturing use.

## Quick start

The supported public build is Windows x64. Download the beta archive from
[Releases](https://github.com/vanyu0710/aicad/releases), verify its SHA256 file,
extract it, and run `VarenCAD.exe`. Then configure an OpenAI-compatible model
endpoint in Settings → Model and try:

```text
Create a 120 x 120 x 12 mm flange with a 30 mm through hole and six 8 mm holes
on a 90 mm bolt circle. Report every assumption and refuse export if validation fails.
```

For source development, see [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).

## How to contribute without becoming a CAD developer

The most valuable contributions are external evidence, not drive-by stars:

1. submit a real, anonymized mechanical task;
2. report where the agent failed or incorrectly passed a gate;
3. inspect an exported STEP in FreeCAD, build123d, or another CAD tool;
4. review the validation protocol or add a reproducible regression test.

Use the templates in [Issues](https://github.com/vanyu0710/aicad/issues/new/choose)
and the design discussion flow in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

The repository and the MechKernel integration are licensed under
AGPL-3.0-or-later. Commercial licensing for closed-source distribution and OEM
integration is available separately; see [docs/license-strategy.md](docs/license-strategy.md).
