# Contributing — Demo Branch

This is the `demo` branch. It contains the full demo server and web UI for testing cross-chain swaps and cross-pay flows, in addition to the core protocol package.

## Branch Structure

- **`main`** — Clean protocol package only. This is what gets submitted upstream to `tetherto/wdk-protocol-swap-near-intents`. Contains only `src/`, `tests/`, `types/`, and convention files.
- **`demo`** — Everything in `main` plus `demo/`, `.env.example`, and demo-related dependencies (`dotenv`). This branch is for development and testing.

## Keeping In Sync

When you make changes to the protocol itself (anything in `src/`, `tests/`, `types/`, `README.md`, `package.json` config, etc.), those changes **must also be applied to `main`** so they can be upstreamed to the tetherto repo.

### Workflow

1. Make your changes on the `demo` branch
2. If the changes touch protocol code (not demo-only), cherry-pick or merge them into `main`:
   ```bash
   git checkout main
   git cherry-pick <commit-hash>   # for individual commits
   # or
   git merge demo -- src/ tests/   # be selective
   git push origin main
   ```
3. Push both branches:
   ```bash
   git push origin main demo
   ```

### What goes where

| Change type | Branch |
|---|---|
| Protocol source (`src/`) | `main` + `demo` |
| Tests (`tests/`) | `main` + `demo` |
| README protocol docs | `main` + `demo` |
| Demo server/UI (`demo/`) | `demo` only |
| `.env.example` | `demo` only |
| Demo-specific deps (`dotenv`) | `demo` only |

### Upstream (tetherto)

The `main` branch is intended to be cloned/forked into `tetherto/wdk-protocol-swap-near-intents`. When the upstream repo exists:

1. Add it as a remote: `git remote add upstream git@github.com:tetherto/wdk-protocol-swap-near-intents.git`
2. Push `main` to upstream: `git push upstream main`
3. The `demo` branch stays in the personal repo only
