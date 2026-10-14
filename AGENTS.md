# Agent Instructions for RapidCal

## 1. Pre-Push Quality Gate

Before committing and pushing any changes to the repository, you **must** run the full local verification suite so that formatting, linting, type-checking, and unit tests pass cleanly:

1. **Frontend Typecheck & Build**:
   ```bash
   npm run build
   ```
2. **Rust Formatting (`rustfmt`)**:
   ```bash
   cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
   ```
   *(If formatting fails, run `cargo fmt --manifest-path src-tauri/Cargo.toml --all` before committing.)*
3. **Rust Clippy Linting**:
   ```bash
   cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
   ```
4. **Tauri Custom-Protocol Check**:
   ```bash
   cargo check --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol
   ```
5. **Rust Unit & Integration Tests**:
   ```bash
   cargo test --manifest-path src-tauri/Cargo.toml
   ```

---

## 2. Mandatory Post-Push CI Verification on `main`

Whenever anything is pushed to `main`, you **must wait and verify that all automatic GitHub Actions workflows succeed** before reporting completion to the user:

1. **Identify the Workflow Run**:
   - After `git push origin main`, query the latest workflow run matching the pushed `HEAD` commit SHA via the GitHub API (`https://api.github.com/repos/Smit2553/RapidCal/actions/runs?branch=main&per_page=5`) or the GitHub CLI (`gh run list --branch main --limit 5`).
2. **Wait for Completion**:
   - Monitor the triggered workflow run until its `status` is `"completed"` across all matrix jobs (`Frontend Typecheck & Build`, `Rust Formatting & Clippy Lint`, and `Rust Test Suite` on `ubuntu-latest`, `macos-latest`, and `windows-latest`).
3. **Verify Success or Fix Failures**:
   - Confirm that the workflow `conclusion` is `"success"`.
   - If any job fails (`conclusion == "failure"`), immediately inspect the failed job steps (`https://api.github.com/repos/Smit2553/RapidCal/actions/runs/<run_id>/jobs`), fix the issue locally, push the fix, and repeat verification until all GitHub Actions checks are green.

---

## 3. Release Notes & Changelog Requirements

Whenever creating or publishing a new release, the release notes **must** accurately document the actual changes that occurred between the previous release and the new release:

1. **Diff Against the Previous Release Tag**:
   - Identify the most recent release tag (e.g., `git describe --tags --abbrev=0` or `git tag -l --sort=-v:refname`) and inspect all commits and code diffs since that tag (`git log <prev_tag>..HEAD --oneline` and `git diff <prev_tag>..HEAD --stat`).
2. **Update `CHANGELOG.md` and `.github/workflows/release.yml`**:
   - Add a new version section to `CHANGELOG.md` summarizing the concrete features, bug fixes, and improvements introduced since the previous release.
   - Update the `releaseBody` ("What's New in `v__VERSION__`") in `.github/workflows/release.yml` (and the GitHub Release body if edited directly via `gh release edit`) so that published GitHub Release notes and the in-app update checker always reflect the real changes in that release rather than stale notes from a prior version.

