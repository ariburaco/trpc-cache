# Contributing to trpc-redis-cache

Thanks for your interest in contributing to this project! Here's how you can help and how the release process works.

## Development

1. Fork and clone the repository
2. Install dependencies with pnpm:
   ```bash
   pnpm install
   ```
3. Run tests:
   ```bash
   pnpm test
   ```
4. Make your changes
5. Make sure tests pass and linting is clean:
   ```bash
   pnpm run ci
   ```

## Making Changes

When making changes that should be released in a new version:

1. Run the changeset CLI to document your changes:
   ```bash
   pnpm changeset
   ```
2. Follow the prompts to describe your changes and choose a version bump (patch, minor, major)
3. Commit the generated changeset file along with your changes

## Release Process

This project uses [Changesets](https://github.com/changesets/changesets) to manage versions and publishing to npm.

### Automatic Publishing

When changes are pushed to the `master` branch, the GitHub Actions workflow will:

1. Run the CI checks
2. Generate a "Version Packages" PR if there are changesets
3. When that PR is merged, automatically publish the new version to npm

### Manual Publishing

If you need to publish manually:

1. Make sure you have npm publish access
2. Run:
   ```bash
   pnpm run local-release
   ```

## GitHub Actions Workflow

The `.github/workflows/publish.yml` file contains the GitHub Actions workflow that:

1. Runs on pushes to the `master` branch
2. Installs dependencies with pnpm
3. Uses the Changesets Action to either:
   - Create a PR with version bumps based on changesets
   - Publish to npm when the version PR is merged

For any questions about the release process, please open an issue.
