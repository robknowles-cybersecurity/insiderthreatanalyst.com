# Insider Threat Analyst Career Framework

A community-built competency framework for insider threat practitioners — the
knowledge, skills, and abilities that define the roles in this field, mapped
across concentrations, clusters, and maturity levels.

Live site: **https://insiderthreatanalyst.com**

## Contributing

Suggestions and corrections are welcome through any of:

- the site's [Suggest page](https://insiderthreatanalyst.com/suggest.html)
- email: **hello@insiderthreatanalyst.com**
- pull requests against this repository

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for details.

## Licensing

This project is split across two licenses:

- **Code** (HTML/CSS/JS) — MIT, see [`LICENSE`](LICENSE)
- **Content** (framework text, KSA data, written material) — CC BY 4.0, see
  [`LICENSE-CONTENT.md`](LICENSE-CONTENT.md)

## Search index

On-site search is powered by [Pagefind](https://pagefind.app) 1.5.2, pinned in
`package.json`. The index itself is a generated build artifact: it is produced at
deploy time under `/pagefind/` and is **not committed to this repository**, so the
`/pagefind/` paths referenced by `assets/search.js` will not resolve here. The
tooling that generates it is not mirrored either — `tools/build-nav.sh` is the only
build script published.

## Credits

Contributor credits are maintained on the site at
[`/contributors.html`](https://insiderthreatanalyst.com/contributors.html).

## History

This repository begins at a clean public baseline (v1.2.1). The full release
history is published on the site at
[`/changelog.html`](https://insiderthreatanalyst.com/changelog.html).
