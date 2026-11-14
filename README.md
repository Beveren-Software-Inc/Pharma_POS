<div align="center">

<img src="./docs/screenshots/beveren-logo.png" alt="Beveren" width="280"/>

<h1>Pharma POS</h1>

[![CI](https://github.com/Beveren-Software-Inc/Pharma_POS/actions/workflows/ci.yaml/badge.svg)](https://github.com/Beveren-Software-Inc/Pharma_POS/actions/workflows/ci.yaml)

Pharmacy point of sale for ERPNext.

</div>

Pharma POS is the dispensing checkout for an ERPNext site. Open it at `/klik_pos` after the app is installed. Set up a POS Profile before the first sale.

## Install

Requires Frappe and ERPNext v16.

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app https://github.com/Beveren-Software-Inc/Pharma_POS --branch version-16
bench install-app klik_pos
bench start
```

The installed app name is `klik_pos`. The site serves the POS at `http://your-site:8000/klik_pos`.

## Develop

From this repository, with a bench already running:

```bash
yarn install
yarn dev
```

The UI dev server is `klik_spa` and proxies API calls to the bench.

### Pre-commit hooks

Git hooks are **not** part of the repository (they live in `.git/hooks/`, which git
never clones), so each clone needs them installed once. Run this after
`bench get-app`, after re-cloning, and after `bench update` replaces the checkout:

```bash
pre-commit install
# if `pre-commit` is not on PATH, use the bench virtualenv:
# ../../env/bin/pre-commit install
```

Verify the hook is live with `ls -l .git/hooks/pre-commit` (it must exist and be
executable — the default clone only ships `*.sample` files). To check the whole
tree instead of just staged files, run `pre-commit run --all-files`.

## Support

[info@beverensoftware.com](mailto:info@beverensoftware.com)
