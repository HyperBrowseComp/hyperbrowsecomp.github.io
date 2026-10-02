"""Export public aggregate site data from the local benchmark and evaluation files.

No question, answer, canary, trace, or dataset key is read into the output.
"""

import argparse
import collections
import ctypes
import json
import re
import struct
import subprocess
import zipfile
from pathlib import Path

import pyarrow.parquet as parquet


LANGUAGES = {
    "ARZ": "Egyptian Arabic", "DE": "German", "ES": "Spanish",
    "FIL": "Filipino", "ID": "Indonesian", "JV": "Javanese",
    "KO": "Korean", "RU": "Russian", "TE": "Telugu", "TH": "Thai",
    "UZ": "Uzbek", "VI": "Vietnamese", "ZH": "Chinese",
}

MODEL_FILES = {
    "builtin": [
        ("Gemini 3.7 Flash", "HyperBrowseComp_gemini-3.7-flash_*.eval"),
        ("Gemini 3.1 Pro", "HyperBrowseComp_gemini-3.1-pro-preview_*_complete.eval"),
        ("GPT-5.6 Sol", "HyperBrowseComp_gpt-5.6-sol_*.eval"),
        ("GPT-5.6 Terra", "HyperBrowseComp_gpt-5.6-terra_*.eval"),
        ("GPT-5.6 Luna", "HyperBrowseComp_gpt-5.6-luna_*.eval"),
    ],
    "exa": [
        ("GPT-5.6 Sol", "exa/gpt 5.6 sol/*part-*.eval"),
        ("Gemini 3.1 Pro", "exa/gemini pro/*part-*.eval"),
        ("Gemini 3.7 Flash", "exa/gemini-3.7-flash/HyperBrowseComp_gemini-3.7-flash.eval"),
    ],
}

PRIMARY_DOMAINS = [
    "Economics & Business", "Media & Entertainment", "Education",
    "Geography & Transport", "Games", "Music", "Arts & Culture",
    "Science & Technology", "History", "Politics & Law", "Sports",
    "Food & Drink", "Other",
]

QUESTION_MODALITIES = [
    "Video / YouTube", "PDF / book / OCR", "Arithmetic", "Image",
    "Audio", "Tables", "Maps", "Plots / graphs",
]

libzstd = ctypes.CDLL("/opt/homebrew/lib/libzstd.dylib")
libzstd.ZSTD_decompress.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t]
libzstd.ZSTD_decompress.restype = ctypes.c_size_t
libzstd.ZSTD_isError.argtypes = [ctypes.c_size_t]
libzstd.ZSTD_isError.restype = ctypes.c_uint


def read_member(archive, file_handle, info):
    if info.compress_type != 93:
        return archive.read(info)
    file_handle.seek(info.header_offset)
    header = file_handle.read(30)
    name_length, extra_length = struct.unpack_from("<HH", header, 26)
    file_handle.seek(info.header_offset + 30 + name_length + extra_length)
    compressed = file_handle.read(info.compress_size)
    source = ctypes.create_string_buffer(compressed)
    destination = ctypes.create_string_buffer(info.file_size)
    size = libzstd.ZSTD_decompress(destination, info.file_size, source, len(compressed))
    if libzstd.ZSTD_isError(size) or size != info.file_size:
        raise RuntimeError(f"Could not decompress {info.filename}")
    return destination.raw[:size]


def scores_from_eval(path):
    scores = {}
    with zipfile.ZipFile(path) as archive, path.open("rb") as file_handle:
        for info in archive.infolist():
            if not info.filename.startswith("samples/") or not info.filename.endswith(".json"):
                continue
            sample = json.loads(read_member(archive, file_handle, info))
            sample_id = str(sample["id"])
            grade = sample.get("scores", {}).get("browse_comp_scorer", {}).get("value", {})
            score = grade.get("score") if isinstance(grade, dict) else grade
            if sample_id in scores and scores[sample_id] != score:
                raise ValueError(f"Conflicting score for {sample_id} in {path.name}")
            scores[sample_id] = score
    return scores


def table2_results_from_paper(paper_text, total):
    table = paper_text.split("Table 2: Performance", 1)[1].split(
        "Retrieval and harness sensitivity", 1
    )[0]
    pattern = re.compile(
        r"^\s*(?:\d+\s+)?(Built-in|Exa|OWL)\s+(.+?)\s+"
        r"(\d+)\s+([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*$",
        re.MULTILINE,
    )
    results = {}
    for match in pattern.finditer(table):
        setting = {"Built-in": "builtin", "Exa": "exa", "OWL": "owl"}[match.group(1)]
        model = match.group(2).rstrip("†").strip()
        correct = int(match.group(3))
        published_accuracy = float(match.group(4))
        total_tokens_m = float(match.group(5))
        if round(correct / total * 100, 2) != published_accuracy:
            raise ValueError(f"The manuscript's count and accuracy disagree for {setting} {model}")
        if total_tokens_m <= 0:
            raise ValueError(f"The manuscript's token count is invalid for {setting} {model}")
        key = (setting, model)
        if key in results:
            raise ValueError(f"Duplicate manuscript result for {setting} {model}")
        results[key] = {
            "model": model, "correct": correct, "total": total,
            "total_tokens_m": total_tokens_m,
        }
    expected = {
        (setting, label)
        for setting, specs in MODEL_FILES.items()
        for label, _ in specs
    } | {("owl", "Gemini 3.7 Flash")}
    if set(results) != expected:
        raise ValueError(f"Manuscript results do not match the expected models: {set(results) ^ expected}")
    return results


def figure_counts_from_paper(paper_text, labels, total, exclusive=False):
    figure = paper_text.split("Figure 2: Distributions", 1)[0].rsplit("\f", 1)[-1]
    rows = []
    for label in labels:
        match = re.search(
            re.escape(label) + r"\s+(\d+)\s+\(([\d.]+)%\)", figure
        )
        if not match:
            raise ValueError(f"Could not find {label} in the manuscript distribution figure")
        count = int(match.group(1))
        published_percent = float(match.group(2))
        if round(count / total * 100, 1) != published_percent:
            raise ValueError(f"Count and percentage disagree for {label}")
        rows.append({"name": label, "count": count})
    if exclusive and sum(row["count"] for row in rows) != total:
        raise ValueError("Primary-domain counts do not sum to the benchmark total")
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--retained-ids", type=Path, required=True)
    parser.add_argument("--results-dir", type=Path, required=True)
    parser.add_argument("--paper", type=Path, default=Path("assets/Hyper_BrowseComp.pdf"))
    parser.add_argument("--output", type=Path, default=Path("data/site-data.json"))
    args = parser.parse_args()

    ids = parquet.read_table(args.dataset, columns=["id"]).column("id").to_pylist()
    retained = {line.strip() for line in args.retained_ids.read_text().splitlines() if line.strip()}
    if set(ids) != retained:
        raise ValueError("Dataset IDs and retained evaluation IDs differ")
    language_counts = collections.Counter(item.split("_", 1)[0] for item in ids)
    unknown = set(language_counts) - set(LANGUAGES)
    if unknown:
        raise ValueError(f"Unknown language codes: {unknown}")

    result_groups = {}
    for setting, specs in MODEL_FILES.items():
        rows = []
        for label, pattern in specs:
            paths = sorted(args.results_dir.glob(pattern))
            if not paths:
                raise FileNotFoundError(f"No result file matching {pattern}")
            combined = {}
            for path in paths:
                for sample_id, score in scores_from_eval(path).items():
                    if sample_id in combined and combined[sample_id] != score:
                        raise ValueError(f"Conflicting results for {sample_id} across {pattern}")
                    combined[sample_id] = score
            missing = retained - set(combined)
            # Terminal failures and unavailable scores count as incorrect.
            correct = {sample_id for sample_id in retained if combined.get(sample_id) == "C"}
            rows.append({"model": label, "correct": len(correct), "total": len(retained)})
            print(f"{setting:7} {label:20} {len(correct):3}/{len(retained)}; missing score records: {len(missing)}")
        result_groups[setting] = rows

    paper_text = subprocess.check_output(
        ["pdftotext", "-layout", str(args.paper), "-"], text=True
    )
    paper_results = table2_results_from_paper(paper_text, len(retained))
    for setting, rows in result_groups.items():
        for row in rows:
            paper_row = paper_results[(setting, row["model"])]
            if row["correct"] != paper_row["correct"]:
                raise ValueError(f"Evaluation and manuscript disagree for {setting} {row['model']}")
            row["total_tokens_m"] = paper_row["total_tokens_m"]
    result_groups["owl"] = [paper_results[("owl", "Gemini 3.7 Flash")]]
    public_data = {
        "dataset": {
            "questions": len(ids),
            "languages": [
                {"name": LANGUAGES[code], "count": count}
                for code, count in sorted(language_counts.items(), key=lambda item: (-item[1], LANGUAGES[item[0]]))
            ],
            "primary_domains": figure_counts_from_paper(
                paper_text, PRIMARY_DOMAINS, len(retained), exclusive=True
            ),
            "modalities": figure_counts_from_paper(
                paper_text, QUESTION_MODALITIES, len(retained)
            ),
        },
        "results": result_groups,
        "provenance": "Question and language counts come from retained dataset IDs. Primary-domain and modality counts are extracted from the attached manuscript distribution figure. Built-in/Exa accuracy comes from Inspect .eval score records; OWL accuracy and all token totals come from the manuscript results table. No question, answer, or trace is included.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(public_data, indent=2, ensure_ascii=False) + "\n")
    print(f"owl     Gemini 3.7 Flash     {result_groups['owl'][0]['correct']}/{len(retained)}; source: manuscript results table")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
