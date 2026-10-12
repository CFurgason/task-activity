const SHEET_ID = "1RrTxVhzt7iDnVCB0c_sUnUbqix7RKfaDe9NA0IdkBus";
const SHEET_GID = "0";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
const JSONP_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json;responseHandler:__sheetLoaded&gid=${SHEET_GID}`;

const $ = (id) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat("en-US");
const percentFormat = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

let shopRows = [];
let allRows = [];
let currentAgents = [];
let currentShops = [];

loadDashboard();

async function loadDashboard() {
  try {
    const csv = await fetchCsv();
    render(parseCsv(csv));
  } catch (error) {
    try {
      const rows = await fetchJsonp();
      render(rows);
    } catch (jsonpError) {
      console.error(error, jsonpError);
      showLoadError();
    }
  }
}

async function fetchCsv() {
  const response = await fetch(CSV_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Sheet responded with ${response.status}`);
  return response.text();
}

function fetchJsonp() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Google Sheet JSONP timed out"));
    }, 12000);

    window.__sheetLoaded = (payload) => {
      cleanup();
      resolve(rowsFromDataTable(payload.table));
    };

    function cleanup() {
      window.clearTimeout(timeout);
      delete window.__sheetLoaded;
      script.remove();
    }

    script.onerror = () => {
      cleanup();
      reject(new Error("Google Sheet JSONP failed"));
    };

    script.src = JSONP_URL;
    document.head.appendChild(script);
  });
}

function rowsFromDataTable(table) {
  const headers = table.cols.map((col) => col.label || col.id);
  return table.rows.map((row) => {
    const next = {};
    headers.forEach((header, index) => {
      const cell = row.c[index];
      next[header] = cell ? cell.f ?? cell.v ?? "" : "";
    });
    return next;
  });
}

function parseCsv(text) {
  const rows = [];
  let current = [];
  let field = "";
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && insideQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      current.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      current.push(field);
      rows.push(current);
      current = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || current.length) {
    current.push(field);
    rows.push(current);
  }

  const headers = rows.shift().map((header) => header.trim());
  return rows
    .filter((row) => row.some(Boolean))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function render(rawRows) {
  allRows = rawRows.map(normalizeRow).filter((row) => row.agent && row.shop);

  populateFilters(allRows);
  attachFilterEvents();

  $("sourceStatus").textContent = "Connected to Google Sheet";
  $("lastUpdated").textContent = `Updated ${new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;

  renderFilteredDashboard();
}

function renderFilteredDashboard() {
  const agentFilter = $("agentFilter").value;
  const shopFilter = $("shopFilter").value;
  const rows = allRows.filter((row) => {
    const agentMatch = !agentFilter || row.agent === agentFilter;
    const shopMatch = !shopFilter || row.shop === shopFilter;
    return agentMatch && shopMatch;
  });

  const totals = summarize(rows);
  const agents = groupRows(rows, "agent");
  const shops = groupRows(rows, "shop");
  const tasks = taskTypeSummary(rows);

  currentAgents = agents;
  currentShops = shops;
  shopRows = shops;

  renderKpis(totals, agents, shops);
  renderInsights(totals, agents, shops, tasks);
  renderAgents(agents);
  renderRisks(totals, agents, shops);
  renderShops(shops, totals.completed);
  renderTasks(tasks);
  renderShopTable(shops);
  renderActionableInsights(totals, agents, shops, rows, tasks);
  applyShopSearch();
}

function populateFilters(rows) {
  fillSelect($("agentFilter"), uniqueSorted(rows.map((row) => row.agent)), "All agents");
  fillSelect($("shopFilter"), uniqueSorted(rows.map((row) => row.shop)), "All shops");
}

function fillSelect(select, options, defaultLabel) {
  const current = select.value;
  select.innerHTML = `<option value="">${defaultLabel}</option>${options
    .map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
    .join("")}`;
  select.value = options.includes(current) ? current : "";
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function attachFilterEvents() {
  if (attachFilterEvents.done) return;

  $("agentFilter").addEventListener("change", renderFilteredDashboard);
  $("shopFilter").addEventListener("change", renderFilteredDashboard);
  $("clearFilters").addEventListener("click", () => {
    $("agentFilter").value = "";
    $("shopFilter").value = "";
    $("shopSearch").value = "";
    renderFilteredDashboard();
  });
  $("shopSearch").addEventListener("input", applyShopSearch);
  $("overviewTab").addEventListener("click", () => showPage("overview"));
  $("insightsTab").addEventListener("click", () => showPage("insights"));
  $("exportInsights").addEventListener("click", exportInsightsCsv);

  attachFilterEvents.done = true;
}

function showPage(page) {
  const isInsights = page === "insights";
  $("overviewPage").classList.toggle("active", !isInsights);
  $("insightsPage").classList.toggle("active", isInsights);
  $("overviewTab").classList.toggle("active", !isInsights);
  $("insightsTab").classList.toggle("active", isInsights);
}

function applyShopSearch() {
  const term = $("shopSearch").value.trim().toLowerCase();
  renderShopTable(shopRows.filter((row) => `${row.name} ${row.primaryAgent}`.toLowerCase().includes(term)));
}

function normalizeRow(row) {
  return {
    agent: clean(row["First & Last Name"]),
    userType: clean(row["User Type"]),
    shop: clean(row["Store Name"]),
    created: toNumber(row.Created),
    rescheduled: toNumber(row.Rescheduled),
    statusChanged: toNumber(row["Status Changed"]),
    archived: toNumber(row.Archived),
    completed: toNumber(row.Completed),
    assigned: toNumber(row.Assigned),
    completedTasks: clean(row["Completed Tasks (ID - Type)"]),
    assignedTasks: clean(row["Assigned Tasks (ID - Type)"]),
  };
}

function clean(value) {
  return String(value ?? "").trim();
}

function toNumber(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarize(rows) {
  return rows.reduce(
    (total, row) => {
      total.created += row.created;
      total.rescheduled += row.rescheduled;
      total.statusChanged += row.statusChanged;
      total.archived += row.archived;
      total.completed += row.completed;
      total.assigned += row.assigned;
      return total;
    },
    { created: 0, rescheduled: 0, statusChanged: 0, archived: 0, completed: 0, assigned: 0 },
  );
}

function groupRows(rows, key) {
  const map = new Map();
  rows.forEach((row) => {
    const name = row[key];
    const item = map.get(name) ?? {
      name,
      completed: 0,
      rescheduled: 0,
      assigned: 0,
      created: 0,
      statusChanged: 0,
      shops: new Set(),
      agents: new Map(),
    };

    item.completed += row.completed;
    item.rescheduled += row.rescheduled;
    item.assigned += row.assigned;
    item.created += row.created;
    item.statusChanged += row.statusChanged;
    item.shops.add(row.shop);
    item.agents.set(row.agent, (item.agents.get(row.agent) ?? 0) + row.completed);
    map.set(name, item);
  });

  return [...map.values()]
    .map((item) => ({
      ...item,
      shopCount: item.shops.size,
      primaryAgent: topEntry(item.agents)[0] ?? "Unassigned",
      rescheduleRate: item.completed ? item.rescheduled / item.completed : 0,
    }))
    .sort((a, b) => b.completed - a.completed);
}

function taskTypeSummary(rows) {
  const types = new Map();
  rows.forEach((row) => {
    extractTaskTypes(row.completedTasks).forEach((type) => {
      types.set(type, (types.get(type) ?? 0) + 1);
    });
  });

  return [...types.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function taskTypeByAgent(rows) {
  const agentMap = new Map();

  rows.forEach((row) => {
    const item = agentMap.get(row.agent) ?? {
      name: row.agent,
      total: 0,
      types: new Map(),
    };

    extractTaskTypes(row.completedTasks).forEach((type) => {
      item.total += 1;
      item.types.set(type, (item.types.get(type) ?? 0) + 1);
    });

    agentMap.set(row.agent, item);
  });

  return [...agentMap.values()]
    .map((agent) => ({
      ...agent,
      topTypes: [...agent.types.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, count]) => ({ name, count })),
    }))
    .sort((a, b) => b.total - a.total);
}

function extractTaskTypes(value) {
  return value
    .split(/,\s*(?=\d+\s+\()/)
    .map((entry) => {
      const start = entry.indexOf("(");
      const end = entry.lastIndexOf(")");
      return start >= 0 && end > start ? entry.slice(start + 1, end).trim() : "";
    })
    .filter(Boolean);
}

function topEntry(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
}

function renderKpis(totals, agents, shops) {
  const handled = totals.completed + totals.rescheduled + totals.created + totals.assigned;
  $("totalCompleted").textContent = compact(totals.completed);
  $("completedSubcopy").textContent = `Across ${agents.length} agents and ${shops.length} shops`;
  $("completionEfficiency").textContent = handled ? percentFormat.format(totals.completed / handled) : "--";
  $("rescheduleRate").textContent = totals.completed ? decimalFormat.format(totals.rescheduled / totals.completed) : "--";
  $("coverage").textContent = `${agents.length}/${shops.length}`;
  $("coverageSubcopy").textContent = "Agents / shops represented";
}

function renderInsights(totals, agents, shops, tasks) {
  if (!agents.length || !shops.length) {
    $("insights").innerHTML = emptyCard("No matching report rows", "Clear one filter or choose a different agent/shop combination.");
    $("topAgentNote").textContent = "No rows in this view";
    return;
  }

  const topShops = shops.slice(0, 3);
  const topShopShare = totals.completed ? topShops.reduce((sum, shop) => sum + shop.completed, 0) / totals.completed : 0;
  const assignmentOwner = agents.slice().sort((a, b) => b.assigned - a.assigned)[0];
  const highestRate = agents.slice().sort((a, b) => b.rescheduleRate - a.rescheduleRate)[0];
  const leadingTask = tasks[0] ?? { name: "No completed task type", count: 0 };

  $("insights").innerHTML = [
    insight("Concentration", `${topShops.map((shop) => shop.name).join(", ")} drive ${percentFormat.format(topShopShare)} of completions.`, "This is the shortest list to watch when volume changes.", topShopShare > 0.4 ? "warning" : ""),
    insight("Assignment load", `${assignmentOwner.name} owns ${percentFormat.format(totals.assigned ? assignmentOwner.assigned / totals.assigned : 0)} of assignments.`, "Balance incoming work before availability becomes a bottleneck.", "danger"),
    insight("Task mix", `${leadingTask.name} is the largest completed task type.`, `${numberFormat.format(leadingTask.count)} completed tasks in the current report.`, ""),
  ].join("");

  $("topAgentNote").textContent = `${highestRate.name} has the highest reschedule pressure`;
}

function insight(label, title, body, tone) {
  return `<article class="insight ${tone}">
    <span>${label}</span>
    <strong>${title}</strong>
    <p>${body}</p>
  </article>`;
}

function renderAgents(agents) {
  if (!agents.length) {
    $("agentLeaderboard").innerHTML = emptyCard("No agents to show", "Try a broader filter.");
    return;
  }

  const max = Math.max(...agents.map((agent) => agent.completed), 1);
  $("agentLeaderboard").innerHTML = agents
    .map((agent) => `
      <div class="leader-row">
        <span class="leader-name" title="${escapeHtml(agent.name)}">${escapeHtml(agent.name)}</span>
        <span class="bar"><span class="fill" style="--w:${percent(agent.completed / max)}"></span></span>
        <span class="value">${numberFormat.format(agent.completed)}</span>
        <span class="pill ${rateClass(agent.rescheduleRate)}">${decimalFormat.format(agent.rescheduleRate)}</span>
      </div>
    `)
    .join("");
}

function renderRisks(totals, agents, shops) {
  if (!agents.length || !shops.length) {
    $("riskList").innerHTML = emptyCard("No risk signals", "There is no data in this filtered view.");
    return;
  }

  const highRateAgent = agents.slice().sort((a, b) => b.rescheduleRate - a.rescheduleRate)[0];
  const lowShop = shops.slice().reverse().find((shop) => shop.completed > 0) ?? shops[shops.length - 1];
  const assignmentOwner = agents.slice().sort((a, b) => b.assigned - a.assigned)[0];
  const avgShopCompletion = totals.completed / Math.max(shops.length, 1);

  $("riskList").innerHTML = [
    risk("!", "Reschedule pressure", `${highRateAgent.name} is at ${decimalFormat.format(highRateAgent.rescheduleRate)} reschedules per completion.`),
    risk("A", "Assignment bottleneck", `${assignmentOwner.name} has ${numberFormat.format(assignmentOwner.assigned)} of ${numberFormat.format(totals.assigned)} assigned tasks.`),
    risk("S", "Quiet account", `${lowShop.name} has ${numberFormat.format(lowShop.completed)} completions versus a shop average near ${numberFormat.format(Math.round(avgShopCompletion))}.`),
  ].join("");
}

function risk(icon, title, body) {
  return `<div class="risk-item">
    <span class="risk-icon">${icon}</span>
    <div>
      <strong>${title}</strong>
      <p>${body}</p>
    </div>
  </div>`;
}

function renderShops(shops, totalCompleted) {
  if (!shops.length) {
    $("shopList").innerHTML = emptyCard("No shops to show", "Try a broader filter.");
    return;
  }

  const max = Math.max(...shops.map((shop) => shop.completed), 1);
  $("shopList").innerHTML = shops
    .slice(0, 8)
    .map((shop) => `
      <div class="shop-row">
        <span class="shop-name" title="${escapeHtml(shop.name)}">${escapeHtml(shop.name)}</span>
        <span class="bar"><span class="fill" style="--w:${percent(shop.completed / max)}"></span></span>
        <span class="value">${percentFormat.format(shop.completed / Math.max(totalCompleted, 1))}</span>
      </div>
    `)
    .join("");
}

function renderTasks(tasks) {
  if (!tasks.length) {
    $("taskTypes").innerHTML = emptyCard("No task mix available", "No completed task types were found in this view.");
    return;
  }

  const max = Math.max(...tasks.map((task) => task.count), 1);
  $("taskTypes").innerHTML = tasks
    .slice(0, 10)
    .map((task) => `
      <div class="task-row">
        <span class="task-name" title="${escapeHtml(task.name)}">${escapeHtml(task.name)}</span>
        <span class="bar"><span class="fill" style="--w:${percent(task.count / max)}"></span></span>
        <span class="value">${numberFormat.format(task.count)}</span>
      </div>
    `)
    .join("");
}

function renderShopTable(rows) {
  if (!rows.length) {
    $("shopTable").innerHTML = `<tr><td colspan="6">${emptyInline("No matching shops or agents")}</td></tr>`;
    return;
  }

  $("shopTable").innerHTML = rows
    .map((shop) => `
      <tr>
        <td>${escapeHtml(shop.name)}</td>
        <td>${escapeHtml(shop.primaryAgent)}</td>
        <td>${numberFormat.format(shop.completed)}</td>
        <td>${numberFormat.format(shop.rescheduled)}</td>
        <td><span class="pill ${rateClass(shop.rescheduleRate)}">${decimalFormat.format(shop.rescheduleRate)}</span></td>
        <td>${numberFormat.format(shop.assigned)}</td>
      </tr>
    `)
    .join("");
}

function renderActionableInsights(totals, agents, shops, rows) {
  const openLoad = totals.assigned - totals.completed;
  const maxAgentOpen = Math.max(...agents.map((agent) => Math.max(agent.assigned - agent.completed, 0)), 1);

  $("openWorkload").textContent = numberFormat.format(openLoad);
  $("openWorkloadSubcopy").textContent = `${numberFormat.format(totals.assigned)} assigned minus ${numberFormat.format(totals.completed)} completed`;
  $("completedAssignedRate").textContent = totals.assigned ? percentFormat.format(totals.completed / totals.assigned) : "--";
  $("rescheduledAssignedRate").textContent = totals.assigned ? percentFormat.format(totals.rescheduled / totals.assigned) : "--";
  $("archivedCreatedRate").textContent = totals.created ? percentFormat.format(totals.archived / totals.created) : "--";

  if (!agents.length) {
    renderReportContext(rows, agents, shops);
    $("agentBacklogList").innerHTML = emptyCard("No workload to show", "Try a broader filter.");
    $("taskByAgentList").innerHTML = emptyCard("No task ownership to show", "Try a broader filter.");
    $("exceptionTable").innerHTML = `<tr><td colspan="7">${emptyInline("No account exceptions found")}</td></tr>`;
    return;
  }

  renderReportContext(rows, agents, shops);

  $("agentBacklogList").innerHTML = agents
    .slice()
    .sort((a, b) => (b.assigned - b.completed) - (a.assigned - a.completed))
    .slice(0, 8)
    .map((agent) => {
      const agentOpen = agent.assigned - agent.completed;
      return actionRow(
        agent.name,
        `${numberFormat.format(agentOpen)} open`,
        `${numberFormat.format(agent.assigned)} assigned, ${numberFormat.format(agent.completed)} completed`,
        percent(Math.max(agentOpen, 0) / maxAgentOpen),
      );
    })
    .join("");

  const taskAgents = taskTypeByAgent(rows);
  $("taskByAgentList").innerHTML = taskAgents.length
    ? taskAgents
        .slice(0, 8)
        .map((agent) => {
          const mix = agent.topTypes.map((type) => `${type.name}: ${numberFormat.format(type.count)}`).join(" | ");
          return actionRow(agent.name, numberFormat.format(agent.total), mix || "No completed task types found", percent(agent.total / Math.max(taskAgents[0].total, 1)));
        })
        .join("")
    : emptyCard("No task ownership to show", "No completed task types were found in this view.");

  renderExceptionTable(shopExceptions(shops));
}

function renderReportContext(rows, agents, shops) {
  const headers = Object.keys(rows[0] ?? {});
  const dateFields = headers.filter((header) => /date|period|week|month|start|end/i.test(header));
  const activeFilters = [
    $("agentFilter").value ? `Agent: ${$("agentFilter").value}` : "",
    $("shopFilter").value ? `Shop: ${$("shopFilter").value}` : "",
  ].filter(Boolean);

  $("reportContextList").innerHTML = [
    actionRow("Included rows", numberFormat.format(rows.length), `${numberFormat.format(agents.length)} agents and ${numberFormat.format(shops.length)} shops in the current filter`, percent(1)),
    actionRow(
      "Reporting window",
      dateFields.length ? dateFields.join(", ") : "Not in sheet",
      dateFields.length ? "Date or period fields were found in the source sheet." : "Add a date or report-period column to the sheet to show a true reporting window here.",
      dateFields.length ? percent(1) : percent(0),
    ),
    actionRow("Active filters", activeFilters.length ? activeFilters.join(" | ") : "All data", "All values shown on this page are derived from the live Google Sheet rows.", percent(1)),
  ].join("");
}

function actionRow(title, value, detail, width) {
  return `<div class="action-row">
    <div>
      <strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong>
      <p title="${escapeHtml(detail)}">${escapeHtml(detail)}</p>
    </div>
    <span class="bar"><span class="fill" style="--w:${width}"></span></span>
    <span class="value">${escapeHtml(value)}</span>
  </div>`;
}

function shopExceptions(shops) {
  return shops
    .map((shop) => {
      const openLoad = shop.assigned - shop.completed;
      const signals = [];

      if (shop.rescheduleRate >= 0.85) signals.push("High reschedule pressure");
      if (openLoad > 0) signals.push("Open workload");
      if (shop.completed > 0 && shop.completed <= 5) signals.push("Low completion volume");
      if (!shop.completed && shop.assigned) signals.push("Assigned with no completions");

      const severity = (shop.rescheduleRate * 100) + Math.max(openLoad, 0) + (shop.completed <= 5 ? 15 : 0);

      return {
        ...shop,
        openLoad,
        signal: signals.join("; "),
        severity,
      };
    })
    .filter((shop) => shop.signal)
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 18);
}

function renderExceptionTable(rows) {
  if (!rows.length) {
    $("exceptionTable").innerHTML = `<tr><td colspan="7">${emptyInline("No account exceptions found")}</td></tr>`;
    return;
  }

  $("exceptionTable").innerHTML = rows
    .map((shop) => `
      <tr>
        <td>${escapeHtml(shop.name)}</td>
        <td>${escapeHtml(shop.signal)}</td>
        <td>${escapeHtml(shop.primaryAgent)}</td>
        <td>${numberFormat.format(shop.completed)}</td>
        <td>${numberFormat.format(shop.assigned)}</td>
        <td>${numberFormat.format(shop.openLoad)}</td>
        <td><span class="pill ${rateClass(shop.rescheduleRate)}">${decimalFormat.format(shop.rescheduleRate)}</span></td>
      </tr>
    `)
    .join("");
}

function exportInsightsCsv() {
  const rows = shopExceptions(currentShops);
  const headers = ["Shop", "Signal", "Primary Agent", "Completed", "Assigned", "Open Load", "Reschedule Rate"];
  const csvRows = [
    headers,
    ...rows.map((shop) => [
      shop.name,
      shop.signal,
      shop.primaryAgent,
      shop.completed,
      shop.assigned,
      shop.openLoad,
      decimalFormat.format(shop.rescheduleRate),
    ]),
  ];

  const blob = new Blob([csvRows.map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "actionable-insights.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function emptyCard(title, body) {
  return `<div class="empty-state"><strong>${title}</strong><span>${body}</span></div>`;
}

function emptyInline(title) {
  return `<span class="empty-inline">${title}</span>`;
}

function showLoadError() {
  $("sourceStatus").textContent = "Sheet connection failed";
  $("lastUpdated").textContent = "Check Google Sheet sharing";
  $("insights").appendChild($("errorTemplate").content.cloneNode(true));
}

function rateClass(rate) {
  if (rate >= 0.85) return "hot";
  if (rate >= 0.7) return "mid";
  return "";
}

function compact(value) {
  if (value >= 1000) return `${decimalFormat.format(value / 1000).replace(/\.00$/, "")}k`;
  return numberFormat.format(value);
}

function percent(value) {
  return `${Math.max(3, Math.round(value * 100))}%`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
