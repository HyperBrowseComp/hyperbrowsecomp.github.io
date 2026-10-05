# HyperBrowseComp project page

A plain HTML, CSS, and JavaScript research project page. It has no framework, build step, or runtime dependency. The logo and example evidence images are stored in `assets/`. The animated statistics and charts read `data/site-data.json`; the example viewer reads `data/examples.json`.

## Preview locally

From this directory:

```sh
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000). Use an HTTP server because the page fetches its data JSON; opening `index.html` directly as a file will not load that data in most browsers.

## Data provenance

`data/site-data.json` contains only public aggregates. `scripts/build_public_data.py` produces the question and language counts from the local encrypted Parquet ID column and retained ID list; built-in/Exa scores come from final Inspect evaluation logs. It extracts domain and modality counts from the attached manuscript's distribution figure, and token totals and the OWL row from its main results table. The script checks printed percentages against counts and verifies that the evaluation scores match the table. It does not export questions, answers, canaries, keys, or traces.

`data/examples.json` and `assets/examples/` preserve the example questions, answers, evidence steps, and screenshots from the original project website. Each evidence step also maps to exact phrases in the English and original-language questions for synchronized highlighting. The viewer uses these local files; it does not request the old site at runtime.

To regenerate it on the project machine, supply the private data and manuscript paths:

```sh
python3 scripts/build_public_data.py \
  --dataset /path/to/hyperbrowsecomp_encrypted.parquet \
  --retained-ids /path/to/retained_ids.txt \
  --results-dir /path/to/final-results \
  --paper /path/to/manuscript.pdf \
  --output data/site-data.json
```

Regeneration needs `pyarrow`, the local `libzstd` library, and `pdftotext`. Visitors and GitHub Pages need none of these. If the evaluation records or manuscript change, regenerate the JSON before publishing.

## Before publishing

- Replace the Code header placeholder when the public repository is available.

The local manuscript PDF is ignored by Git and is not part of the site commit.

To deploy, copy the site files into the GitHub Pages repository root or its configured Pages source folder. GitHub Pages can serve them as-is.
