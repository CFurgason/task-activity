const SHEET_ID = "1RrTxVhzt7iDnVCB0c_sUnUbqix7RKfaDe9NA0IdkBus";
const SHEET_GID = "0";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
const JSONP_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json;responseHandler:__sheetLoaded&gid=${SHEET_GID}`;

const $ = (id) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat("en-US");
const percentFormat = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

let shopRows = [];

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
  const rows = rawRows.map(normalizeRow).filter((row) => row.agent && row.shop);
  const totals = summarize(rows);
  const agents = groupRows(rows, "agent");
  const shops = groupRows(rows, "shop");
  const tasks = taskTypeSummary(rows);

  shopRows = shops;

  $("sourceStatus").textContent = "Connected to Google Sheet";
  $("lastUpdated").textContent = `Updated ${new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;

  renderKpis(totals, agents, shops);
  renderInsights(totals, agents, shops, tasks);
  renderAgents(agents);
  renderRisks(totals, agents, shops);
  renderShops(shops, totals.completed);
  renderTasks(tasks);
  renderShopTable(shops);

  $("shopSearch").addEventListener("input", (event) => {
    const term = event.target.value.trim().toLowerCase();
    renderShopTable(shopRows.filter((row) => `${row.name} ${row.primaryAgent}`.toLowerCase().includes(term)));
  });
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
  const topShops = shops.slice(0, 3);
  const topShopShare = totals.completed ? topShops.reduce((sum, shop) => sum + shop.completed, 0) / totals.completed : 0;
  const assignmentOwner = agents.slice().sort((a, b) => b.assigned - a.assigned)[0];
  const highestRate = agents.slice().sort((a, b) => b.rescheduleRate - a.rescheduleRate)[0];
  const leadingTask = tasks[0];

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
