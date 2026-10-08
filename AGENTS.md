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
