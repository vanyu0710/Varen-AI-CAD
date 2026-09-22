# Varen CAD — an auditable, local-first AI agent for parametric mechanical assemblies

<p align="center">
  <img src="https://raw.githubusercontent.com/vanyu0710/Varen-AI-CAD/main/assets/varen-cad-logo.svg" alt="Varen CAD logo" width="300"/>
</p>

<p align="center">
  <b>From natural language to BOM, verified B-Rep parts, and assembly STEP.</b>
</p>

<p align="center">
  <b><a href="https://github.com/vanyu0710/Varen-AI-CAD/releases">Download for Windows</a></b> ·
  <a href="README.md">简体中文</a> ·
  <a href="https://vanyu0710.github.io/Varen-AI-CAD/">Product page</a> ·
  <a href="docs/beta.md">Apply for the beta</a> ·
  <a href="https://github.com/vanyu0710/Varen-AI-CAD/issues/new?template=task_failure.yml">Report a task failure</a>
</p>

<p align="center">
  <a href="https://github.com/vanyu0710/Varen-AI-CAD/releases"><img alt="Published release" src="https://img.shields.io/github/v/release/vanyu0710/Varen-AI-CAD?include_prereleases" /></a>
  <img alt="Status" src="https://img.shields.io/badge/status-closed%20beta-blue" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20x64-lightgrey" />
  <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0--or--later-green" />
</p>

> **Status:** Windows only, closed beta. Varen CAD is for concept design and rapid prototyping. It is not a SolidWorks replacement, it does not provide a complete 2D drawing workflow or a general assembly mate solver, and `production_ready` is always `false`. Every output requires human engineering review.

## See the result first

The repository contains real end-to-end outputs from the agent workflow:

<p align="center">
  <b>1:100 three-stage gearbox assembly</b> — 8 parts, 53 steps, 758 seconds, 0 hard collisions<br/>
  <img src="https://raw.githubusercontent.com/vanyu0710/Varen-AI-CAD/main/docs/images/varen-gearbox-assembly.png" alt="Varen CAD three-stage gearbox assembly" width="820"/>
</p>

<p align="center">
  <b>Five-speed manual transmission</b> — involute helical gears, 26 parts, 0 hard collisions<br/>
  <img src="https://raw.githubusercontent.com/vanyu0710/Varen-AI-CAD/main/docs/images/varen-transmission-visual.png" alt="Varen CAD five-speed transmission assembly" width="860"/>
</p>

<p align="center">
  <b>Geometry evidence renderer</b> — feature edges without triangulation diagonal noise<br/>
  <img src="https://raw.githubusercontent.com/vanyu0710/Varen-AI-CAD/main/docs/images/render-before-after.png" alt="Geometry evidence renderer comparison" width="860"/>
</p>

<p align="center">
  <b>Startup screen</b><br/>
  <img src="https://raw.githubusercontent.com/vanyu0710/Varen-AI-CAD/main/docs/images/varen-startup.jpg" alt="Varen CAD startup screen" width="820"/>
</p>

<p align="center">
  <b>Workspace and agent conversation</b><br/>
  <img src="https://raw.githubusercontent.com/vanyu0710/Varen-AI-CAD/main/docs/images/varen-workspace-chat-snapshot.jpg" alt="Varen CAD workspace and agent conversation" width="820"/>
</p>

<p align="center">
  <b>Gearbox run overview</b><br/>
  <img src="https://raw.githubusercontent.com/vanyu0710/Varen-AI-CAD/main/docs/images/varen-gearbox-visual.png" alt="Varen CAD gearbox run overview" width="820"/>
</p>

For the planned 45–60 second workflow video, see the [video brief and storyboard](docs/launch/video-brief.md). A playable video has not been added to this README yet.

## Why Varen CAD is different

### 1. Real CAD geometry, not image or mesh generation

- Uses OpenCascade 7.9.3 through the MechKernel CAD kernel.
- Produces boundary representation geometry (B-Rep), with topology and geometry that can be inspected by CAD software.
- Keeps a parameterized feature graph and operation history so features can be edited and replayed.
- Exports STEP and STL for downstream CAD and review workflows.

### 2. An agent workflow, not one-shot generation

A multi-part task follows an explicit sequence:

1. Research and engineering calculations, such as ratios, center distances, shaft estimates, and wall thickness.
2. Structured questions when dimensions or design intent are unclear.
3. BOM planning with part names, quantities, and key parameters.
4. User approval before the plan is allowed to change geometry.
5. Isolated, part-by-part modeling with a separate kernel session for each part.
6. Assembly placement, export, and review.
7. Geometry and interference checks before an artifact is accepted.

The agent operates through constrained kernel operations and structured `StepResult` feedback. It does not receive unrestricted access to an arbitrary CAD Python environment.

### 3. Failure blocks delivery

A successful model response is not treated as a successful delivery. The system can stop or reject an artifact when:

- a part contains more than one solid or a floating feature;
- a feature contract does not match measured hole diameters, counts, or positions;
- two parts have an unapproved interference;
- a script or operation fails during parameterized replay;
- the BOM is incomplete or the validation gates do not pass.

Failures produce structured reports and can trigger rollback or another modeling attempt. `production_ready` remains `false` in every delivery report.

### 4. Local-first and reviewable

- Task data, intermediate state, sessions, and model artifacts can remain under the local `work/` directory.
- Users can inspect tool calls, assumptions, approval cards, feature history, snapshots, and reports as the task runs.
- The model layer accepts OpenAI-compatible endpoints, including endpoints managed by the user.
- The workflow is intended for data-sensitive mechanical, robotics, and hardware teams.

Local storage does not mean offline inference: prompts, attached sketches, and task context sent to a remote endpoint are subject to that provider's data policy.

## Three-minute quick start

### Windows package

The published Windows package checked on GitHub is **v0.22.1-beta** (about 180 MiB). The source [VERSION](VERSION) is `0.22.1-beta`. See [project status](docs/PROJECT_STATUS.md).

1. Open the [v0.22.1-beta release](https://github.com/vanyu0710/Varen-AI-CAD/releases/tag/v0.22.1-beta). Download `VarenCAD-win64-0.22.1-beta.zip` and its `.sha256` attachment under **Assets**, not the source-code archives. Run `Get-FileHash .\VarenCAD-win64-0.22.1-beta.zip -Algorithm SHA256` and compare the result with the checksum file.
2. Extract the archive and run `VarenCAD.exe`.
3. Open **Settings → Model** and configure an OpenAI-compatible endpoint.
4. Try:

   ```text
   Create a 120 x 120 x 12 mm flange with a 30 mm through hole and six 8 mm holes on a 90 mm bolt circle. Report assumptions and refuse export if validation fails.
   ```

### Source checkout

```powershell
git clone https://github.com/vanyu0710/Varen-AI-CAD.git
git clone https://github.com/vanyu0710/mechcad-kernel.git
cd Varen-AI-CAD
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt build123d==0.11.1 cadquery-ocp-novtk==7.9.3.0
.\start-mechcad-pro.cmd
```

The default kernel location is a sibling `mechcad-kernel` checkout. Override it with `MECHCAD_KERNEL_REPO` or `MECHCAD_KERNEL_PYTHON` when needed. See [.env.example](.env.example) and [the getting started guide](docs/GETTING_STARTED.md).

## What the workflow exposes

- **Research:** `design_calculate` records calculations and assumptions in the session.
- **Questions:** `ask_user` presents structured single-choice, multiple-choice, or text questions.
- **Planning:** `propose_plan` creates the BOM and grouped modeling steps; approval is a hard gate.
- **Modeling:** public kernel operations and the constrained `run_build_script` path create real features.
- **Part completion:** `finish_part` runs single-solid and feature-contract checks before archiving STEP/STL files.
- **Editing:** the feature tree supports parameter changes, replay, delete, undo, and redo.
- **Assembly:** `export_assembly` places BOM parts, creates an assembly STEP, and reports pairwise interference.
- **Evidence:** execution reports include assumptions, completed parts, failed gates, geometry checks, and items requiring review.

## Technical boundaries

Varen CAD deliberately does not claim to provide:

- a complete 2D drawing and tolerancing workflow;
- sheet-metal, thread-standard, or complete surface-modeling workflows;
- a general assembly mate, constraint, or motion solver;
- unattended manufacturing approval;
- a promise that a language model's text means the geometry is correct.

The product is currently Windows only and in closed beta. Human engineering review is required before manufacturing use. `production_ready` is always `false`.

## Beta and failure reports

We are recruiting mechanical, robotics, and hardware design partners who can test a real, anonymized task and inspect the resulting STEP in another CAD tool.

- [Apply for the closed beta](https://github.com/vanyu0710/Varen-AI-CAD/issues/new?template=beta_application.yml)
- [Report a task failure](https://github.com/vanyu0710/Varen-AI-CAD/issues/new?template=task_failure.yml)
- [Open a discussion](https://github.com/vanyu0710/Varen-AI-CAD/discussions)
- [Read the known issues](KNOWN_ISSUES.md)

Failure reports are useful even when the agent stops at a gate. They become reproducible regression cases rather than being presented as successful output.

## Documentation

- [Architecture](ARCHITECTURE.md)
- [Feature support matrix](FEATURE_SUPPORT.md)
- [Getting started](docs/GETTING_STARTED.md)
- [User guide](docs/USER_GUIDE.md)
- [Known issues and privacy notes](KNOWN_ISSUES.md)
- [Closed beta rules](docs/beta.md)
- [Development and testing](DEVELOPMENT.md)
- [License strategy](docs/license-strategy.md)
- [Changelog](CHANGELOG.md)

## License

The repository and its MechKernel integration are licensed under AGPL-3.0-or-later. Commercial licensing for closed-source distribution and OEM integration is available separately; see [docs/license-strategy.md](docs/license-strategy.md).
