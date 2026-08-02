# GitHub required check setup

The renderer refactor workflow is defined in `.github/workflows/verify-refactor.yml`.

For the `main` branch, require the pull request check named:

```text
Verify Renderer Refactor / Verify Renderer Refactor
```

Keep the ruleset bypass list empty so the check cannot be bypassed by ordinary repository roles. This file exists as a reference while the first draft pull request runs the workflow and publishes the check context.
