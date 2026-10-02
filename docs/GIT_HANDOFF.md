# Apply the changes, then push once

## What you received

- `source/`: complete working source, including the finished film and reproduction script.
- `patches/`: ordered Git commits for all changes after the uploaded snapshot.
- This local branch is `feature/atelier-platform`. No push or merge was performed.

The uploaded archive did not include Git history. The local baseline (`71909e2`) represents the untouched ZIP, not an upstream commit. **Do not replace your existing `.git` folder or merge this unrelated baseline.** Apply the patches to a branch in your original clone instead.

## Existing clone workflow

First make sure your working tree is clean. The commands below are for a POSIX shell / Git Bash; adjust the extracted patch path.

```sh
git status --short
git switch main
git pull --ff-only
git switch -c feature/atelier-platform
git am /absolute/path/to/REFLUENZ-delivery/patches/*.patch
npm run lint
npm test
npm run build
```

If the upstream branch has changed since the ZIP, Git may report a conflict. Resolve it and use `git am --continue`, or use `git am --abort` to return to the clean starting state. Do not force-push or use `--allow-unrelated-histories`.

Run the outstanding real-browser gate before merging:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:browser
npm run dev
```

Review the landing page, app, creator/member workflows and film on desktop and mobile. Self-host Hanken Grotesk if exact font matching is required; the archive did not contain the font asset and the authoring network could not fetch it.

When satisfied, make your single branch push:

```sh
git push -u origin feature/atelier-platform
```

Then open a pull request into `main` and merge using your usual repository policy. The branch contains the local implementation-round commits; the remote history remains intact.

## Production scope

This delivery is a functional, local demo suitable for product walkthroughs. It is not an authenticated, multi-user production service. The README lists the integrations needed for that step. Browser QA is outstanding because Chromium could not be installed in the authoring workspace.
