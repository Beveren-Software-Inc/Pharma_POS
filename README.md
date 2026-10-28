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

## Support

[info@beverensoftware.com](mailto:info@beverensoftware.com)
