"use strict";

const motionReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const settingNames = {
  builtin: "Built-in search",
  exa: "Exa",
  owl: "OWL"
};
const domainColors = [
  "#a94d38", "#728da0", "#b78a62", "#879b85", "#b7797a",
  "#8b7da2", "#729c9a", "#c3a469", "#9a8990", "#7386ad",
  "#9fae77", "#b79694", "#a8adb4"
];

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateCounts(rows, total, exclusive = false) {
  if (!Array.isArray(rows) || !rows.length || rows.some((row) => !row.name || !isCount(row.count) || row.count > total)) {
    throw new Error("A dataset distribution is incomplete.");
  }
  if (exclusive && rows.reduce((sum, row) => sum + row.count, 0) !== total) {
    throw new Error("Exclusive category counts do not match the benchmark total.");
  }
}

function validateSiteData(data) {
  const dataset = data.dataset;
  if (!isCount(dataset?.questions)) throw new Error("Dataset total is missing.");
  validateCounts(dataset.languages, dataset.questions, true);
  validateCounts(dataset.primary_domains, dataset.questions, true);
  validateCounts(dataset.modalities, dataset.questions);
  for (const setting of Object.keys(settingNames)) {
    const rows = data.results?.[setting];
    if (!Array.isArray(rows) || !rows.length) throw new Error(`Missing ${setting} results.`);
    for (const row of rows) {
      if (!row.model || !isCount(row.correct) || row.total !== dataset.questions ||
          row.correct > row.total || !Number.isFinite(row.total_tokens_m) || row.total_tokens_m <= 0) {
        throw new Error(`Invalid ${setting} result.`);
      }
    }
  }
}

function makeElement(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function observeReveal(element, threshold = 0.9, onReveal = () => {}) {
  const reveal = () => {
    element.classList.add("is-visible");
    onReveal();
  };
  if (motionReduced || !("IntersectionObserver" in window)) {
    reveal();
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.intersectionRatio >= threshold)) {
      reveal();
      observer.disconnect();
    }
  }, { threshold, rootMargin: "0px 0px -10% 0px" });
  observer.observe(element);
}

function animateCount(element, target) {
  if (motionReduced || !("requestAnimationFrame" in window)) {
    element.textContent = target.toLocaleString("en-US");
    return;
  }
  const duration = 1300;
  let start;
  const frame = (time) => {
    if (start === undefined) start = time;
    const progress = Math.min((time - start) / duration, 1);
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = Math.round(target * eased).toLocaleString("en-US");
    if (progress < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function renderStats(data) {
  const questions = document.querySelector('[data-stat="questions"]');
  const languages = document.querySelector('[data-stat="languages"]');
  questions.textContent = "0";
  languages.textContent = "0";
  window.addEventListener("beforeprint", () => {
    questions.textContent = data.dataset.questions.toLocaleString("en-US");
    languages.textContent = data.dataset.languages.length.toLocaleString("en-US");
  });
  observeReveal(questions.closest(".stat-item"), 0.9, () => animateCount(questions, data.dataset.questions));
  observeReveal(languages.closest(".stat-item"), 0.9, () => animateCount(languages, data.dataset.languages.length));
  observeReveal(document.querySelector(".stat-modality"));
}

function renderBars(rows, chartId) {
  const chart = document.getElementById(chartId);
  const maximum = Math.max(...rows.map((row) => row.count));
  for (const item of rows) {
    const row = makeElement("div", "distribution-row");
    const label = makeElement("span", "label", item.name);
    const track = makeElement("span", "bar-track");
    const fill = makeElement("span", "bar-fill");
    fill.style.setProperty("--fill", `${item.count / maximum * 100}%`);
    track.append(fill);
    const value = makeElement("span", "value", item.count.toLocaleString("en-US"));
    row.setAttribute("aria-label", `${item.name}: ${item.count} questions`);
    row.append(label, track, value);
    chart.append(row);
    observeReveal(row);
  }
}

function piePath(start, end) {
  const center = 100;
  const radius = 91;
  const x1 = center + radius * Math.cos(start);
  const y1 = center + radius * Math.sin(start);
  const x2 = center + radius * Math.cos(end);
  const y2 = center + radius * Math.sin(end);
  return `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${end - start > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`;
}

function renderDomains(data) {
  const svg = document.getElementById("domain-pie");
  const legend = document.getElementById("domain-legend");
  const detail = document.getElementById("domain-detail");
  const total = data.dataset.questions;
  const slices = [];
  const legendItems = [];
  const defaultDetail = detail.textContent;
  const showDomain = (index) => {
    const domain = data.dataset.primary_domains[index];
    detail.textContent = `${domain.name}: ${domain.count} questions (${(domain.count / total * 100).toFixed(1)}%)`;
    svg.classList.add("has-active");
    slices.forEach((slice, sliceIndex) => slice.classList.toggle("is-active", sliceIndex === index));
    legendItems.forEach((item, itemIndex) => item.classList.toggle("is-active", itemIndex === index));
  };
  const clearDomain = () => {
    detail.textContent = defaultDetail;
    svg.classList.remove("has-active");
    slices.forEach((slice) => slice.classList.remove("is-active"));
    legendItems.forEach((item) => item.classList.remove("is-active"));
  };
  let angle = -Math.PI / 2;
  for (const [index, domain] of data.dataset.primary_domains.entries()) {
    const nextAngle = angle + domain.count / total * Math.PI * 2;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", piePath(angle, nextAngle));
    path.setAttribute("fill", domainColors[index % domainColors.length]);
    path.setAttribute("class", "domain-slice");
    path.setAttribute("role", "img");
    path.setAttribute("tabindex", "0");
    path.setAttribute("aria-label", `${domain.name}: ${domain.count} questions, ${(domain.count / total * 100).toFixed(1)} percent`);
    path.style.setProperty("--delay", `${index * 65}ms`);
    path.addEventListener("pointerenter", () => showDomain(index));
    path.addEventListener("focus", () => showDomain(index));
    path.addEventListener("click", () => showDomain(index));
    svg.append(path);
    slices.push(path);
    angle = nextAngle;

    const item = makeElement("div", "domain-item");
    const swatch = makeElement("span", "domain-swatch");
    swatch.style.backgroundColor = domainColors[index % domainColors.length];
    const label = makeElement("span", "domain-name", domain.name);
    const value = makeElement("span", "domain-value", `${domain.count} · ${(domain.count / total * 100).toFixed(1)}%`);
    item.append(swatch, label, value);
    legend.append(item);
    legendItems.push(item);
  }
  svg.addEventListener("pointerleave", clearDomain);
  svg.addEventListener("focusout", (event) => {
    if (!svg.contains(event.relatedTarget)) clearDomain();
  });
  const hole = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  hole.setAttribute("cx", "100");
  hole.setAttribute("cy", "100");
  hole.setAttribute("r", "54");
  hole.setAttribute("fill", "#fff");
  svg.append(hole);
  observeReveal(svg, 0.55);
}

function renderAccuracy(data) {
  const chart = document.getElementById("accuracy-chart");
  const head = makeElement("div", "accuracy-head");
  const axis = makeElement("div", "accuracy-axis");
  for (let tick = 0; tick <= 4; tick += 1) {
    axis.append(makeElement("span", "", `${tick * 25}%`));
  }
  head.append(axis, makeElement("span", "token-column-title", "Tokens (M)"));
  chart.append(head);

  for (const [setting, label] of Object.entries(settingNames)) {
    const group = makeElement("div", `chart-group ${setting}`);
    const rows = [];
    group.append(makeElement("h4", "chart-group-heading", label));
    for (const result of data.results[setting]) {
      const accuracy = result.correct / result.total * 100;
      const row = makeElement("div", "accuracy-row");
      const model = makeElement("span", "accuracy-model", result.model);
      const track = makeElement("span", "accuracy-track");
      const fill = makeElement("span", "bar-fill accuracy-fill");
      fill.style.setProperty("--fill", `${accuracy}%`);
      track.append(fill);
      const value = makeElement("span", "accuracy-value", `${accuracy.toFixed(2)}%`);
      const tokens = makeElement("span", "token-value", result.total_tokens_m.toFixed(1));
      row.setAttribute("aria-label", `${label}, ${result.model}: ${accuracy.toFixed(2)} percent accuracy, ${result.total_tokens_m.toFixed(1)} million total tokens`);
      row.append(model, track, value, tokens);
      group.append(row);
      rows.push(row);
    }
    chart.append(group);
    rows.forEach((row) => observeReveal(row));
  }
}

function renderTokenScatter(data) {
  const container = document.getElementById("token-scatter");
  const legend = document.getElementById("token-legend");
  const detail = document.getElementById("token-detail");
  const defaultDetail = detail.textContent;
  const results = Object.entries(settingNames).flatMap(([setting, label]) =>
    data.results[setting].map((result) => ({
      setting, label, ...result,
      accuracy: result.correct / result.total * 100
    }))
  );
  const yMaximum = Math.ceil(Math.max(...results.map((row) => row.accuracy)) / 10) * 10;
  const smallest = Math.min(...results.map((row) => row.total_tokens_m));
  const largest = Math.max(...results.map((row) => row.total_tokens_m));
  const xMinimum = 10 ** (Math.floor(Math.log10(smallest)) - 0.15);
  const xMaximum = 10 ** (Math.ceil(Math.log10(largest)) + 0.12);
  const xPosition = (value) => (Math.log10(value) - Math.log10(xMinimum)) /
    (Math.log10(xMaximum) - Math.log10(xMinimum)) * 100;

  container.append(makeElement("p", "scatter-y-title", "Accuracy (%)"));
  const area = makeElement("div", "scatter-area");
  const yScale = makeElement("div", "scatter-y-scale");
  const field = makeElement("div", "scatter-field");
  const xScale = makeElement("div", "scatter-x-scale");
  for (let tick = 0; tick <= 4; tick += 1) {
    const position = `${(1 - tick / 4) * 100}%`;
    const label = makeElement("span", "", `${Math.round(yMaximum * tick / 4)}%`);
    label.style.top = position;
    yScale.append(label);
    const line = makeElement("span", "scatter-grid-y");
    line.style.top = position;
    field.append(line);
  }
  for (let power = Math.floor(Math.log10(xMinimum)); power <= Math.ceil(Math.log10(xMaximum)); power += 1) {
    for (const factor of [1, 3]) {
      const tick = factor * 10 ** power;
      if (tick < xMinimum || tick > xMaximum) continue;
      const position = `${xPosition(tick)}%`;
      const label = makeElement("span", "", tick.toLocaleString("en-US"));
      label.style.left = position;
      xScale.append(label);
      const line = makeElement("span", "scatter-grid-x");
      line.style.left = position;
      field.append(line);
    }
  }

  const points = [];
  const clearActive = () => {
    points.forEach((point) => point.classList.remove("is-active"));
    detail.textContent = defaultDetail;
  };
  for (const [index, result] of results.entries()) {
    const point = makeElement("button", `scatter-point ${result.setting}`);
    point.type = "button";
    point.style.left = `${xPosition(result.total_tokens_m)}%`;
    point.style.top = `${(1 - result.accuracy / yMaximum) * 100}%`;
    point.style.setProperty("--delay", `${index * 65}ms`);
    point.setAttribute("aria-label", `${result.label}, ${result.model}: ${result.accuracy.toFixed(2)} percent accuracy and ${result.total_tokens_m.toFixed(1)} million total tokens`);
    const showActive = () => {
      points.forEach((item) => item.classList.toggle("is-active", item === point));
      detail.textContent = `${result.label} · ${result.model}: ${result.accuracy.toFixed(2)}% accuracy, ${result.total_tokens_m.toFixed(1)}M tokens`;
    };
    point.addEventListener("pointerenter", showActive);
    point.addEventListener("focus", showActive);
    point.addEventListener("click", showActive);
    point.addEventListener("pointerleave", () => {
      if (document.activeElement !== point) clearActive();
    });
    point.addEventListener("blur", clearActive);
    field.append(point);
    points.push(point);
  }
  area.append(yScale, field, xScale);
  container.append(area, makeElement("p", "scatter-x-title", "Total tokens (millions; log scale)"));
  for (const [setting, label] of Object.entries(settingNames)) {
    const item = makeElement("span", "token-legend-item");
    item.append(makeElement("span", `token-legend-dot ${setting}`), document.createTextNode(label));
    legend.append(item);
  }
  observeReveal(field, 0.55);
}

async function loadSiteData() {
  const response = await fetch("data/site-data.json");
  if (!response.ok) throw new Error("Could not load aggregate data.");
  const data = await response.json();
  validateSiteData(data);
  renderStats(data);
  renderBars(data.dataset.languages, "language-chart");
  renderDomains(data);
  renderBars(data.dataset.modalities, "modality-chart");
  renderAccuracy(data);
  renderTokenScatter(data);
}

const exampleState = {
  examples: [],
  index: 0,
  step: 0,
  view: "translation",
  visible: false,
  timer: null,
  imageRequest: 0
};

function stopExampleTimer() {
  if (exampleState.timer) clearInterval(exampleState.timer);
  exampleState.timer = null;
}

function syncExampleTimer() {
  stopExampleTimer();
  if (!exampleState.visible || document.hidden || motionReduced) return;
  exampleState.timer = setInterval(() => {
    const example = exampleState.examples[exampleState.index];
    showStep((exampleState.step + 1) % example.route.length);
  }, 6000);
}

function updateQuestion() {
  const example = exampleState.examples[exampleState.index];
  const question = document.getElementById("example-question");
  const content = example.question[exampleState.view];
  const phrases = example.route[exampleState.step].highlights[exampleState.view];
  const ranges = phrases.map((phrase) => {
    const start = content.indexOf(phrase);
    if (start === -1) throw new Error(`Example highlight not found: ${phrase}`);
    return { start, end: start + phrase.length };
  }).sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) throw new Error("Example highlights overlap.");
    parts.push(document.createTextNode(content.slice(cursor, range.start)));
    parts.push(makeElement("mark", "question-highlight", content.slice(range.start, range.end)));
    cursor = range.end;
  }
  parts.push(document.createTextNode(content.slice(cursor)));
  question.replaceChildren(...parts);
  question.lang = exampleState.view === "original" ? example.language.code : "en";
  for (const [id, view] of [["show-english", "translation"], ["show-original", "original"]]) {
    const button = document.getElementById(id);
    const selected = exampleState.view === view;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

function updateEvidenceImage(step) {
  const first = document.getElementById("evidence-image-a");
  const second = document.getElementById("evidence-image-b");
  const current = first.classList.contains("is-active") ? first : second;
  const next = current === first ? second : first;
  const request = ++exampleState.imageRequest;
  next.alt = step.label;
  const reveal = () => {
    if (request !== exampleState.imageRequest) return;
    next.classList.add("is-active");
    next.removeAttribute("aria-hidden");
    current.classList.remove("is-active");
    current.setAttribute("aria-hidden", "true");
  };
  next.onload = reveal;
  next.src = step.image;
  if (next.complete && next.naturalWidth) reveal();
}

function showStep(index) {
  const example = exampleState.examples[exampleState.index];
  exampleState.step = index;
  const step = example.route[index];
  document.getElementById("evidence-index").textContent = `Evidence ${index + 1} of ${example.route.length}`;
  document.getElementById("evidence-title").textContent = step.label;
  document.getElementById("evidence-description").textContent = step.text;
  updateQuestion();
  updateEvidenceImage(step);
  const progress = document.getElementById("evidence-progress");
  progress.replaceChildren();
  example.route.forEach((_, stepIndex) => {
    const segment = makeElement("span");
    if (stepIndex < index) segment.className = "is-past";
    if (stepIndex === index) segment.className = "is-current";
    progress.append(segment);
  });
}

function renderExample(index) {
  exampleState.index = index;
  exampleState.step = 0;
  exampleState.view = "translation";
  const example = exampleState.examples[index];
  document.getElementById("question-language").textContent = `Question · ${example.language.label}`;
  document.getElementById("example-answer").textContent = example.answer;
  for (const [tabIndex, tab] of [...document.querySelectorAll("#example-tabs button")].entries()) {
    const selected = tabIndex === index;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  document.getElementById("example-panel").setAttribute("aria-labelledby", `example-tab-${index}`);
  showStep(0);
  syncExampleTimer();
}

function buildExampleTabs() {
  const tabs = document.getElementById("example-tabs");
  for (const [index, example] of exampleState.examples.entries()) {
    const tab = makeElement("button", "", example.language.label);
    tab.type = "button";
    tab.id = `example-tab-${index}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", "example-panel");
    tab.addEventListener("click", () => renderExample(index));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = (index + direction + exampleState.examples.length) % exampleState.examples.length;
      renderExample(next);
      tabs.children[next].focus();
    });
    tabs.append(tab);
  }
}

async function loadExamples() {
  const response = await fetch("data/examples.json");
  if (!response.ok) throw new Error("Could not load example data.");
  const examples = await response.json();
  if (!Array.isArray(examples) || !examples.length || examples.some((example) =>
    !example.language?.code || !example.question?.original || !example.question?.translation ||
    !example.answer || !Array.isArray(example.route) || !example.route.length ||
    example.route.some((step) => !step.label || !step.text || !step.image ||
      !Array.isArray(step.highlights?.translation) || !step.highlights.translation.length ||
      !Array.isArray(step.highlights?.original) || !step.highlights.original.length)
  )) throw new Error("Example data is incomplete.");
  exampleState.examples = examples;
  buildExampleTabs();
  renderExample(0);
  document.getElementById("show-english").addEventListener("click", () => {
    exampleState.view = "translation";
    updateQuestion();
  });
  document.getElementById("show-original").addEventListener("click", () => {
    exampleState.view = "original";
    updateQuestion();
  });
  document.getElementById("previous-step").addEventListener("click", () => {
    const length = exampleState.examples[exampleState.index].route.length;
    showStep((exampleState.step - 1 + length) % length);
    syncExampleTimer();
  });
  document.getElementById("next-step").addEventListener("click", () => {
    const length = exampleState.examples[exampleState.index].route.length;
    showStep((exampleState.step + 1) % length);
    syncExampleTimer();
  });
  document.addEventListener("visibilitychange", syncExampleTimer);
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      exampleState.visible = entries.some((entry) => entry.intersectionRatio >= 0.7);
      syncExampleTimer();
    }, { threshold: 0.7, rootMargin: "0px 0px -10% 0px" });
    observer.observe(document.querySelector(".evidence-stage"));
  } else {
    exampleState.visible = true;
    syncExampleTimer();
  }
}

loadSiteData().catch((error) => {
  console.error(error);
  for (const id of ["language-chart", "domain-legend", "modality-chart", "accuracy-chart"]) {
    document.getElementById(id).textContent = "Aggregate data could not be loaded. Serve the site over HTTP.";
  }
});

loadExamples().catch((error) => {
  console.error(error);
  document.getElementById("example-question").textContent = "Examples could not be loaded. Serve the site over HTTP.";
});
