
const PLANNER_BASE =
  "https://wingo.oss-ap-southeast-7.aliyuncs.com/WinGo_1_";

const RESULT_API =
  "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json";

const HISTORY_KEY = "wingo_neon_history_v1";
const RING_CIRCUMFERENCE = 2 * Math.PI * 72;

let history = loadHistory();
let results = [];
let activeTarget = "";
let busy = false;
let plannerRetryAt = 0;

const $ = id => document.getElementById(id);

function loadHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function nextPeriod(period) {
  return (BigInt(period) + 1n)
    .toString()
    .padStart(period.length, "0");
}

function getIssue(item) {
  return String(
    item.issueNumber ?? item.issue ?? item.period ?? ""
  );
}

function getNumber(item) {
  const value = item.number ?? item.result ?? item.openNumber;

  if (value === undefined || value === null || value === "") {
    return null;
  }

  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 9 ? n : null;
}

function getSize(number) {
  return number >= 5 ? "Big" : "Small";
}

function extractResults(json) {
  const candidates = [
    json?.data?.list,
    json?.data?.data?.list,
    json?.list,
    json?.data?.records,
    json?.records
  ];

  return candidates.find(Array.isArray) || [];
}

function setPrediction(value) {
  const element = $("prediction");

  element.textContent = value.toUpperCase();
  element.className =
    "prediction-value " +
    (value === "Big" ? "big" :
     value === "Small" ? "small" : "waiting");
}

function renderHistory() {
  const container = $("historyList");

  if (!history.length) {
    container.innerHTML =
      '<div class="history-empty">Waiting for history...</div>';
    return;
  }

  container.innerHTML = [...history]
    .reverse()
    .slice(0, 100)
    .map(item => {
      const predictionClass =
        item.prediction === "Big" ? "big" : "small";

      const actualClass =
        item.actual === "Big" ? "big" :
        item.actual === "Small" ? "small" : "";

      const badgeClass =
        item.status === "Win" ? "win" :
        item.status === "Loss" ? "loss" : "pending";

      return `
        <div class="history-row">
          <span class="history-period">${item.period}</span>
          <span class="history-prediction ${predictionClass}">
            ${item.prediction.toUpperCase()}
          </span>
          <span class="history-actual ${actualClass}">
            ${(item.actual || "--").toUpperCase()}
          </span>
          <span class="result-badge ${badgeClass}">
            ${item.status.toUpperCase()}
          </span>
        </div>
      `;
    }).join("");
}

function matchHistory() {
  const actuals = new Map();

  for (const item of results) {
    const issue = getIssue(item);
    const number = getNumber(item);

    if (issue && number !== null) {
      actuals.set(issue, getSize(number));
    }
  }

  for (const prediction of history) {
    const actual = actuals.get(prediction.period);

    if (actual && prediction.status === "Pending") {
      prediction.actual = actual;
      prediction.status =
        actual === prediction.prediction ? "Win" : "Loss";
    }
  }

  saveHistory();
  renderHistory();
}

async function fetchActualResults() {
  const response = await fetch(
    RESULT_API + "?_ts=" + Date.now(),
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error("Results unavailable");
  }

  const json = await response.json();
  const list = extractResults(json);

  if (!list.length) {
    throw new Error("Unknown results response");
  }

  results = list
    .filter(item => /^\d+$/.test(getIssue(item)));

  results.sort((a, b) => {
    const x = BigInt(getIssue(a));
    const y = BigInt(getIssue(b));
    return x > y ? -1 : x < y ? 1 : 0;
  });

  return results[0];
}

async function fetchPlanner(target) {
  const url = `${PLANNER_BASE}${target}_planner4_bs_plan`;

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Planner unavailable");
  }

  const json = await response.json();
  const code = json?.content?.bs;

  if (code !== "b" && code !== "s") {
    throw new Error("Invalid planner signal");
  }

  const signal = code === "b" ? "Big" : "Small";

  let entry = history.find(item => item.period === target);

  if (!entry) {
    entry = {
      period: target,
      prediction: signal,
      actual: null,
      status: "Pending",
      createdAt: new Date().toISOString()
    };

    history.push(entry);
  } else if (entry.status === "Pending") {
    entry.prediction = signal;
  }

  saveHistory();
  setPrediction(entry.prediction);

  $("plannerMessage").childNodes[0].textContent =
    "Planner signal received for period";

  $("plannerPeriod").textContent = target;

  matchHistory();
}

async function refresh() {
  if (busy) return;
  busy = true;

  try {
    const latest = await fetchActualResults();
    const current = getIssue(latest);
    const target = nextPeriod(current);

    $("targetPeriod").textContent = target;

    matchHistory();

    if (target !== activeTarget) {
      activeTarget = target;
      plannerRetryAt = 0;

      $("plannerPeriod").textContent = target;
      $("plannerMessage").childNodes[0].textContent =
        "Waiting for planner signal";

      setPrediction("WAITING");
    }

    // Retry a failed planner request after 5 seconds.
    if (Date.now() >= plannerRetryAt) {
      try {
        await fetchPlanner(target);
        plannerRetryAt = Date.now() + 5000;
      } catch {
        plannerRetryAt = Date.now() + 5000;

        // Keep technical errors hidden from the UI.
        setPrediction("WAITING");
      }
    }

    matchHistory();
  } catch {
    // Hide API and network errors from the design.
  } finally {
    busy = false;
  }
}

function updateTimer() {
  const seconds = Math.floor(Date.now() / 1000) % 60;
  const remaining = 59 - seconds;
  const displaySeconds = Math.max(0, remaining);

  $("timer").textContent =
    "00:" + String(displaySeconds).padStart(2, "0");

  const fraction = displaySeconds / 59;

  $("ringProgress").style.strokeDasharray = RING_CIRCUMFERENCE;
  $("ringProgress").style.strokeDashoffset =
    RING_CIRCUMFERENCE * (1 - fraction);
}

renderHistory();
updateTimer();
refresh();

setInterval(updateTimer, 250);
setInterval(refresh, 3000);
