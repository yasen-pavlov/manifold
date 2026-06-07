# AUR packaging

[`manifold-steam`](https://aur.archlinux.org/packages/manifold-steam) is the
Arch User Repository package for Manifold. It is a **source** package: it builds
Manifold from the tagged release (`npm ci` + `tauri build`) and installs the
binary, a `.desktop` entry, and icons.

> Named `manifold-steam` (not `manifold`) on purpose: `extra/manifold` is the
> unrelated geometry library, and a same-named package would let `pacman -Syu`
> "upgrade" this app into it. The installed binary and window title stay
> `manifold` / "Manifold".

## Files

- `manifold-steam/PKGBUILD` — the package recipe (from-source build).
- `manifold-steam/manifold-steam.install` — refreshes the icon cache + desktop
  database on install/upgrade/remove.

`pkgver` and `sha256sums` in the committed PKGBUILD are a placeholder — the
release workflow sets them from the published release tag, so don't rely on the
committed values. (Note: v0.1.0 predates the bundled SVG icon, so the package
targets v0.2.0+.)

## Automated publishing

`.github/workflows/aur-publish.yml` runs when a GitHub **release is published**
(`release: released`, never for drafts/pre-releases). It:

1. derives `pkgver` from the release tag and computes the source tarball
   `sha256`,
2. rewrites the PKGBUILD's `pkgver` / `pkgrel` / `sha256sums`,
3. generates `.SRCINFO` and pushes to the AUR via
   [`KSXGitHub/github-actions-deploy-aur`](https://github.com/KSXGitHub/github-actions-deploy-aur).

It can also be run manually: **Actions → Publish to AUR → Run workflow**, passing
a tag.

> **Why the release must be published by you (not the build workflow).** GitHub
> does not start a new workflow run from events triggered by the default
> `GITHUB_TOKEN`. `release.yml` builds a **draft** (`releaseDraft: true`); when
> *you* publish it (UI, or `gh release edit <tag> --draft=false` with your own
> auth) that is a user event, which triggers this workflow. If `release.yml`
> were changed to auto-publish with `GITHUB_TOKEN`, this workflow would never
> fire — you'd need a PAT/App token for the release step, or to fold the AUR
> step into `release.yml` directly. The draft gate is kept on purpose.

## One-time setup (required before the first publish)

The workflow needs an AUR account whose SSH key it can push with:

1. Create an [AUR account](https://aur.archlinux.org/) if you don't have one.
2. Generate a dedicated key pair:
   ```sh
   ssh-keygen -t ed25519 -C "aur@manifold" -f ~/.ssh/aur_manifold
   ```
3. Add the **public** key (`~/.ssh/aur_manifold.pub`) to your AUR account
   (My Account → SSH Public Key).
4. Add these repository secrets (Settings → Secrets and variables → Actions):
   - `AUR_SSH_PRIVATE_KEY` — the **private** key (`~/.ssh/aur_manifold`).
   - `AUR_USERNAME` — your AUR username (used as the commit author name).
   - `AUR_EMAIL` — the commit author email.

The first successful run creates the `manifold-steam` package on the AUR.

## Build / test locally

```sh
cd packaging/aur/manifold-steam
makepkg -si          # build the tagged release from source and install
```

To test an unreleased state, point `source` at a local
`git archive` tarball and set `sha256sums=('SKIP')`.
