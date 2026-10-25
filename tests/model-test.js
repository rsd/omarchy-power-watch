#!/usr/bin/env node

// Exercises ../Model.js, which is written as a QML JS module (bare
// function declarations, no exports) and so is loaded here by evaluating it and
// lifting the names out — the same approach as omavnc's tests/model-test.js.
//
// Times are local; the suite pins TZ before the first Date is built so the
// axis labels are deterministic.

process.env.TZ = "UTC"

const fs = require("fs")
const path = require("path")
const assert = require("assert")

const pluginDir = path.join(__dirname, "..")
const source = fs.readFileSync(path.join(pluginDir, "Model.js"), "utf8")
const NAMES = [
  "APPROACH_FRACTION", "STALE_INTERVALS", "DEFAULT_INTERVAL_S", "DEFAULT_THRESHOLD_W",
  "STALE_CHECK_MS", "HISTORY_MIN_REFRESH_MS", "GAP_STEPS",
  "CURRENT_MAX_BYTES", "HISTORY_MAX_BYTES",
  "CURRENT_MAX_CHARS", "HISTORY_PARSE_CHARS", "HISTORY_MAX_LINES", "HISTORY_MAX_LINE_CHARS",
  "MAX_RENDER_POINTS", "MAX_DASH_SEGMENTS", "RANGES", "SERVICE_HINT", "CHART_STYLE",
  "BREAKDOWN_ROWS_PER_COLUMN", "TOTAL_SOURCES", "GPU_STATUSES", "MAX_GPU_DEVICES", "LOWER_BOUND_MARK",
  "MAX_GPU_DEVICE_SCAN", "BAR_WIDEST_TEXT", "BAR_VERTICAL_SLOTS", "PSYS_LABEL", "PSYS_BAND_LABEL",
  "CURRENT_READ_MIN_MS", "CPU_CAP_STATES", "SERIES_COLOR", "BAND_MODES",
  "seriesColors", "chartColors", "bandColor",
  "oneOf", "pciAddress", "parseGpuDevices", "isLowerBound", "boundText", "currentStatText",
  "totalLabel", "totalRowValue", "gpuRowValue", "gpuCountText", "gpuListCut", "showsMeasuredAc",
  "finiteIn", "safeLabel", "canvasFont", "rangeFor", "stepFor", "stateDir", "fileUrl", "historyPath",
  "stateDirProblem", "resolveStateDir", "isCanonicalDir", "recheckMissing", "historyCacheHit",
  "headChars", "tailChars", "STATE_DIR_SHOWN_CHARS", "STATE_DIR_CHART_TEXT", "baseName", "historyReadRange",
  "parseCurrent", "isStale", "shouldRelist", "gateDecision", "loadFailure", "level", "levelText",
  "statusLine", "restSourceLabel", "sampleTitle", "sampleNotes",
  "formatNumber", "formatWatts", "formatAmps", "formatPercent", "barText", "barLines",
  "powerSourceLabel", "kindLabel", "staleMessage", "tooltipText", "breakdown", "capStatus",
  "normalizePoint", "parseHistory", "filterRange", "endOf", "splitGaps", "pointMode", "modeSpans",
  "stats", "mergePoints", "consolidate", "niceAxis", "timeTicks", "chartModel", "chartLayout",
  "clampLabelX", "dashSegments"
]
const model = new Function(source + "\nreturn {" + NAMES.join(",") + "}")()

// A test that cannot run here returns SKIP (after saying why on its own);
// skipped tests are reported on their own line and left out of the final
// "N/N passed" count, so that line still means every test that ran passed.
const SKIP = Symbol("skip")
const tests = []
const test = (name, fn) => tests.push([name, fn])

// What the service writes: the --once --json report (with the generic-config
// keys) plus the four extra keys.
const sample = (over) => Object.assign({
  time: "2026-10-24T10:46:08-03:00", ac_online: true, battery_status: "Not charging",
  battery_capacity: 63, battery_w: 0.0, cpu_w: 7.78, gpu_w: 15.01, gpu_limit_w: 190.0,
  gpu_pstate: "P5", rest_w: 29.77, rest_source: "calibrate", charge_w: 0.0, total_w: 52.56,
  total_kind: "estimated", incomplete: false, adapter_v: 19.5, adapter_current_a: 2.7,
  adapter_rating_w: 330.0, threshold_w: 150.0, errors: [],
  total_source: "model", total_lower_bound: false, psys_w: null, gpu_status: "active",
  gpu_devices: [{ pci: "0000:01:00.0", vendor: "nvidia", status: "active", power_w: 15.01 }],
  interval_s: 2.0, cpu_limit_w: 91.0, gpu_max_limit_w: null, epoch: 1761300000.0
}, over || {})
const parsed = (over) => model.parseCurrent(JSON.stringify(sample(over))).data
// No string the UI shows may carry a JS artefact or a non-finite number.
const assertClean = (text, what) =>
  assert.ok(!/NaN|null|undefined|Infinity|\[object/.test(text), (what || "text") + ": " + JSON.stringify(text))

const point = (t, over) => Object.assign(
  { t, n: 1, avg: 80, max: 90, cpu: 8, gpu: 38, rest: 25, chg: 0, ac: 1, k: "e" }, over || {})
const jsonl = (points) => points.map(p => JSON.stringify(p)).join("\n") + "\n"

// ---------------------------------------------------------------- current

test("parses a full current.json", () => {
  const r = model.parseCurrent(JSON.stringify(sample()))
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.data.totalW, 52.56)
  assert.strictEqual(r.data.intervalS, 2)
  assert.strictEqual(r.data.cpuLimitW, 91)
  assert.strictEqual(r.data.gpuMaxLimitW, null)
  assert.strictEqual(r.data.totalKind, "estimated")
  assert.strictEqual(r.data.restSource, "calibrate")
  assert.strictEqual(r.data.epoch, 1761300000)
})

test("missing and unreadable current.json are distinguishable", () => {
  assert.deepStrictEqual(model.parseCurrent(""), { ok: false, error: "missing" })
  assert.deepStrictEqual(model.parseCurrent(undefined), { ok: false, error: "missing" })
  assert.deepStrictEqual(model.parseCurrent('{"total_w": 5'), { ok: false, error: "unreadable" })
  assert.deepStrictEqual(model.parseCurrent("[1,2]"), { ok: false, error: "unreadable" })
  assert.deepStrictEqual(model.parseCurrent("null"), { ok: false, error: "unreadable" })
})

test("an oversized current.json is not parsed", () => {
  const big = JSON.stringify(sample({ pad: "x".repeat(model.CURRENT_MAX_CHARS) }))
  assert.deepStrictEqual(model.parseCurrent(big), { ok: false, error: "too large" })
})

test("numbers are bound: wrong types, NaN-ish and absurd values become null", () => {
  const r = model.parseCurrent(JSON.stringify(sample({
    total_w: "82", cpu_w: 1e9, gpu_w: null, adapter_current_a: true, interval_s: -1,
    threshold_w: 0, epoch: "now", battery_capacity: 250
  })))
  assert.strictEqual(r.data.totalW, null)
  assert.strictEqual(r.data.cpuW, null)
  assert.strictEqual(r.data.gpuW, null)
  assert.strictEqual(r.data.adapterA, null)
  assert.strictEqual(r.data.intervalS, model.DEFAULT_INTERVAL_S)
  assert.strictEqual(r.data.thresholdW, model.DEFAULT_THRESHOLD_W)
  assert.strictEqual(r.data.epoch, null)
  assert.strictEqual(r.data.batteryCapacity, null)
})

test("file-sourced strings are stripped of markup and capped", () => {
  const r = model.parseCurrent(JSON.stringify(sample({
    rest_source: "<img src='http://x/y'>&calibrate\n", battery_status: "A".repeat(500), total_kind: "<b>"
  })))
  assert.ok(!/[<>&\n]/.test(r.data.restSource), r.data.restSource)
  assert.ok(r.data.restSource.length <= 24)
  assert.strictEqual(r.data.batteryStatus.length, 24)
  assert.strictEqual(r.data.totalKind, "")
  assert.strictEqual(model.safeLabel(42), "")
})

test("safeLabel strips bidi overrides, isolates, zero-width and C1 characters", () => {
  const hostile = "Not\u202e gnigrahc\u2066x\u2069\u200b\u200f\ufeff\u0085\u2028end"
  const out = model.safeLabel(hostile, 40)
  assert.ok(!/[\u0080-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/.test(out), JSON.stringify(out))
  assert.strictEqual(out, "Not gnigrahcxend")
  assert.strictEqual(model.parseCurrent(JSON.stringify(sample({ battery_status: "\u202eChar" }))).data.batteryStatus, "Char")
})

test("canvas font string survives a family name with quotes or backslashes", () => {
  assert.strictEqual(model.canvasFont(11, "JetBrainsMono Nerd Font"), '11px "JetBrainsMono Nerd Font"')
  assert.strictEqual(model.canvasFont(11, 'Evil" Font\\'), '11px "Evil Font"')
  assert.strictEqual(model.canvasFont(11, '"'), "11px sans-serif")
  assert.strictEqual(model.canvasFont(NaN, null), "10px sans-serif")
  // exactly one pair of quotes, always balanced
  assert.strictEqual((model.canvasFont(12, 'a"b"c').match(/"/g) || []).length, 2)
})

test("current.json reads are throttled to one a second; staleness allows for it", () => {
  assert.ok(model.CURRENT_READ_MIN_MS >= 1000, "at most one current.json read per second per bar")
  // A sub-second interval counts as one second: a sample read once a second
  // must not flash stale between reads.
  const fast = parsed({ interval_s: 0.05 })
  assert.strictEqual(model.isStale(fast, 1761300000 + 2.9), false)
  assert.strictEqual(model.isStale(fast, 1761300000 + 3.1), true)
  // At or above a second the rule is unchanged: 3 intervals.
  assert.strictEqual(model.isStale(parsed({ interval_s: 1 }), 1761300000 + 3.1), true)
  const bar = fs.readFileSync(path.join(pluginDir, "BarWidget.qml"), "utf8").replace(/\/\/.*$/gm, "")
  assert.ok(/id:\s*currentGate[\s\S]*?minIntervalMs:\s*Model\.CURRENT_READ_MIN_MS/.test(bar),
    "the current.json reader is throttled")
})

test("staleness: missing, no epoch, older than 3 intervals, far future", () => {
  const cur = model.parseCurrent(JSON.stringify(sample())).data
  assert.strictEqual(model.isStale(null, 1761300000), true)
  assert.strictEqual(model.isStale(Object.assign({}, cur, { epoch: null }), 1761300000), true)
  assert.strictEqual(model.isStale(cur, 1761300000 + 6), false)
  assert.strictEqual(model.isStale(cur, 1761300000 + 6.5), true)
  assert.strictEqual(model.isStale(cur, 1761300000 - 60), true)
  const slow = Object.assign({}, cur, { intervalS: 10 })
  assert.strictEqual(model.isStale(slow, 1761300000 + 29), false)
  assert.strictEqual(model.STALE_INTERVALS, 3)
})

test("the staleness tick re-lists only while current.json is absent, never a present file", () => {
  assert.strictEqual(model.shouldRelist("missing"), true)
  // An oversized or unreadable file is watched already; re-reading it on a
  // timer is what cost 0.8-1.7 GB per read in the audit.
  for (const outcome of ["too large", "unreadable", "ok", "pending", ""])
    assert.strictEqual(model.shouldRelist(outcome), false, outcome)
  assert.ok(model.STALE_CHECK_MS >= 10000, "staleness check must be >= 10 s")
  assert.ok(model.HISTORY_MIN_REFRESH_MS >= 5000, "history repaint throttle must be >= 5 s")
  for (const r of model.RANGES)
    assert.ok(r.refreshMs >= model.HISTORY_MIN_REFRESH_MS, r.key + " reloads faster than the floor")
})

test("levels: normal, approaching at 85% of threshold, over at threshold", () => {
  assert.strictEqual(model.APPROACH_FRACTION, 0.85)
  assert.strictEqual(model.level(100, 150), "normal")
  assert.strictEqual(model.level(127.4, 150), "normal")
  assert.strictEqual(model.level(127.5, 150), "approaching")
  assert.strictEqual(model.level(149.9, 150), "approaching")
  assert.strictEqual(model.level(150, 150), "over")
  assert.strictEqual(model.level(300, 150), "over")
  assert.strictEqual(model.level(null, 150), "unknown")
  assert.strictEqual(model.level(130, 0), "approaching")
})

test("read gate: size checked against the cap before any read, at the boundary", () => {
  const cap = model.CURRENT_MAX_BYTES
  assert.deepStrictEqual(model.gateDecision(null, cap, ""), { action: "missing" })
  assert.deepStrictEqual(model.gateDecision({ size: cap + 1, modified: 1 }, cap, ""), { action: "too large" })
  assert.deepStrictEqual(model.gateDecision({ size: 209715200, modified: 1 }, cap, ""), { action: "too large" })
  const at = "/s/current.json"
  assert.deepStrictEqual(model.gateDecision({ size: cap, modified: 5, path: at }, cap, ""), { action: "read", version: cap + ":5", path: at })
  // A 0-byte entry is never read: /proc files list as 0 and read as megabytes.
  assert.deepStrictEqual(model.gateDecision({ size: 0, modified: 5 }, cap, ""), { action: "missing" })
  assert.deepStrictEqual(model.gateDecision({ size: 0, modified: 5 }, model.HISTORY_MAX_BYTES, "0:5"), { action: "missing" },
    "not even a version remembered from before")
  assert.deepStrictEqual(model.gateDecision({ size: 1, modified: 5, path: at }, cap, ""), { action: "read", version: "1:5", path: at })
  assert.deepStrictEqual(model.gateDecision({ size: 600, modified: 5, path: at }, cap, "600:5"), { action: "none" })
  assert.strictEqual(model.gateDecision({ size: 600, modified: 6, path: at }, cap, "600:5").action, "read")
  assert.strictEqual(model.gateDecision({ size: 601, modified: 5, path: at }, cap, "600:5").action, "read")
  assert.deepStrictEqual(model.gateDecision({ size: 10, isDir: true }, cap, ""), { action: "unreadable" })
  assert.deepStrictEqual(model.gateDecision({ size: NaN }, cap, ""), { action: "unreadable" })
  assert.deepStrictEqual(model.gateDecision({ size: -1 }, cap, ""), { action: "unreadable" })
  assert.deepStrictEqual(model.gateDecision({ size: 1 }, 0, ""), { action: "too large" }, "no cap = no read")
  assert.ok(model.HISTORY_MAX_BYTES >= 12 * 1048576, "the hard ceiling holds a raw tier at the 0.05 s floor")
  assert.ok(model.CURRENT_MAX_BYTES <= model.CURRENT_MAX_CHARS, "UTF-8 bytes >= chars: the gate implies the parse cap")
})

test("read gate: the path read is the listed entry's own, never rebuilt", () => {
  const cap = model.CURRENT_MAX_BYTES
  // The listing of a relative dir reported //tmp/x/current.json; whatever it
  // says, that is the file whose size was checked, and the one read.
  for (const listed of ["/s/current.json", "//tmp/x/current.json", "/a/b/current.json"])
    assert.strictEqual(model.gateDecision({ size: 40, modified: 1, path: listed }, cap, "").path, listed)
  // No absolute listed path: nothing to read that the listing vouched for.
  for (const bad of [undefined, null, "", "tmp/x/current.json", " /s/current.json", 7])
    assert.deepStrictEqual(model.gateDecision({ size: 40, modified: 1, path: bad }, cap, ""), { action: "unreadable" }, String(bad))
})

test("a listing that drops a file read just before is re-listed once before it counts as missing", () => {
  assert.strictEqual(model.recheckMissing("missing", "ok", false), true)
  assert.strictEqual(model.recheckMissing("missing", "ok", true), false, "only once in a row")
  for (const outcome of ["missing", "pending", "too large", "unreadable", ""])
    assert.strictEqual(model.recheckMissing("missing", outcome, false), false, outcome)
  for (const action of ["read", "none", "too large", "unreadable"])
    assert.strictEqual(model.recheckMissing(action, "ok", false), false, action)
  const gate = qmlCode("GatedFile.qml")
  const settle = gate.slice(gate.indexOf("function settle()"), gate.indexOf("function restart()"))
  // Checked first, re-lists through callLater (no Timer), and the flag is
  // cleared by any other decision and by restart().
  assert.ok(/var decision = Model\.gateDecision\([^\n]*\)\s*if \(Model\.recheckMissing\(decision\.action, gate\.outcome, gate\.rechecked\)\) \{\s*gate\.rechecked = true\s*Qt\.callLater\(gate\.relist\)\s*return\s*\}\s*if \(decision\.action !== "missing"\) gate\.rechecked = false/.test(settle), settle)
  assert.ok(/function restart\(\) \{[^}]*gate\.rechecked = false/.test(gate))
})

test("load failures: not found is missing, anything else is unreadable", () => {
  assert.strictEqual(model.loadFailure(true), "missing")
  assert.strictEqual(model.loadFailure(false), "unreadable")
  const cur = model.parseCurrent(JSON.stringify(sample())).data
  assert.notStrictEqual(model.staleMessage(null, "unreadable"), model.staleMessage(null, "missing"))
  assert.notStrictEqual(model.staleMessage(cur, "too large"), model.staleMessage(cur, ""))
  assert.ok(model.staleMessage(null, "too large").includes("16 KiB"))
})

// ------------------------------------------------------------- formatting

test("watts, amps and percent formatting", () => {
  assert.strictEqual(model.formatWatts(82.4), "82 W")
  assert.strictEqual(model.formatWatts(82.5), "83 W")
  assert.strictEqual(model.formatWatts(null), "-- W")
  assert.strictEqual(model.formatWatts(-0.2), "0 W")
  assert.strictEqual(model.formatWatts(7.78, 1), "7.8 W")
  assert.strictEqual(model.formatAmps(4.21), "4.2 A")
  assert.strictEqual(model.formatAmps(undefined), "-- A")
  assert.strictEqual(model.formatPercent(82.5, 330), "25%")
  assert.strictEqual(model.formatPercent(82.5, null), "--")
  assert.strictEqual(model.formatPercent(82.5, 0), "--")
})

test("bar text, vertical lines and stale bar", () => {
  const cur = model.parseCurrent(JSON.stringify(sample({ total_w: 81.6 }))).data
  assert.strictEqual(model.barText(cur, false), "82 W")
  assert.strictEqual(model.barText(cur, true), "-- W")
  assert.strictEqual(model.barText(null, false), "-- W")
  assert.deepStrictEqual(model.barLines(cur, false), ["82", "W"])
  assert.deepStrictEqual(model.barLines(null, true), ["--", "W"])
})

test("the level is stated in words, not only in colour", () => {
  assert.strictEqual(model.levelText("over", 150), "Over the 150 W threshold")
  assert.strictEqual(model.levelText("approaching", 150), "Approaching the 150 W threshold (85%+)")
  assert.strictEqual(model.levelText("normal", 150), "Below the 150 W threshold")
  assert.strictEqual(model.levelText("unknown", 150), "")
  const over = model.parseCurrent(JSON.stringify(sample({ total_w: 160 }))).data
  assert.ok(model.tooltipText(over, false).includes("Over the 150 W threshold"))
  assert.strictEqual(model.statusLine(over), "Estimated · AC · Over the 150 W threshold")
  const near = model.parseCurrent(JSON.stringify(sample({ total_w: 130 }))).data
  assert.ok(model.tooltipText(near, false).includes("Approaching"))
})

test("the breakdown title says when the sample is not current", () => {
  const cur = model.parseCurrent(JSON.stringify(sample())).data
  assert.strictEqual(model.sampleTitle(cur, false), "NOW")
  assert.strictEqual(model.sampleTitle(cur, true), "LAST SAMPLE")
  assert.strictEqual(model.sampleTitle(null, true), "NO SAMPLE")
})

test("tooltip: amps, kind, source; stale tooltip names the service", () => {
  const cur = model.parseCurrent(JSON.stringify(sample({ total_w: 82, adapter_current_a: 4.2 }))).data
  const tip = model.tooltipText(cur, false)
  assert.ok(tip.includes("82 W") && tip.includes("4.2 A"), tip)
  assert.ok(tip.includes("Estimated") && tip.includes("AC"), tip)
  const bat = model.parseCurrent(JSON.stringify(sample({ ac_online: false, total_kind: "measured" }))).data
  assert.ok(model.tooltipText(bat, false).includes("Measured · Battery"))
  const stale = model.tooltipText(cur, true)
  assert.ok(stale.includes("not running"), stale)
  assert.ok(stale.includes("systemctl --user enable --now power-watch.service"), stale)
  assert.ok(model.tooltipText(null, true).includes("no current.json"))
  assert.ok(model.tooltipText(null, true, "unreadable").includes("current.json is unreadable"))
  assert.ok(model.tooltipText(null, true, "too large").includes("current.json is too large"))
  assert.ok(model.staleMessage(cur, "").includes("last sample is old"))
})

test("breakdown rows cover CPU, GPU, rest+source, charging, amps, rating, kind, source", () => {
  const cur = model.parseCurrent(JSON.stringify(sample({ charge_w: 12.3, total_w: 165 }))).data
  const rows = model.breakdown(cur)
  const get = label => rows.find(r => r.label === label).value
  assert.strictEqual(get("CPU"), "8 W")
  assert.strictEqual(get("GPU"), "15 W (P5)")
  assert.strictEqual(get("Rest"), "30 W (calibrated)")
  assert.strictEqual(get("Charging"), "12 W")
  assert.strictEqual(get("Battery"), "Not charging, 63%")
  assert.strictEqual(get("Adapter current"), "2.7 A")
  assert.strictEqual(get("Of adapter rating"), "50% of 330 W")
  assert.strictEqual(get("Total is"), "Estimated")
  assert.strictEqual(get("Power source"), "AC")
  assert.strictEqual(model.breakdown(null).length, rows.length)
  // Two columns top to bottom: the load terms, then the supply side.
  const col = model.BREAKDOWN_ROWS_PER_COLUMN
  assert.deepStrictEqual(rows.slice(0, col).map(r => r.label), ["CPU", "GPU", "Rest", "Charging", "Total is"])
  assert.deepStrictEqual(rows.slice(col).map(r => r.label), ["Power source", "Battery", "Adapter current", "Of adapter rating"])
})

test("wording: rest source in words, sentence-case unknowns", () => {
  // rest_source values are the service's contract; only their wording is ours.
  assert.strictEqual(model.restSourceLabel("calibrate"), "calibrated")
  assert.strictEqual(model.restSourceLabel("passive"), "passively calibrated")
  assert.strictEqual(model.restSourceLabel("default"), "DEFAULT — run power-watch calibrate")
  assert.strictEqual(model.restSourceLabel(""), "")
  // Anything else is the (already sanitised) value itself, never "x calibration".
  assert.strictEqual(model.restSourceLabel("measured"), "measured")
  assert.strictEqual(model.restSourceLabel("toString"), "toString")
  assert.strictEqual(model.breakdown(parsed({ rest_source: "passive" })).find(r => r.label === "Rest").value,
    "30 W (passively calibrated)")
  assert.strictEqual(model.breakdown(parsed({ rest_source: "a<b>" })).find(r => r.label === "Rest").value, "30 W (ab)")
  const none = model.breakdown(null)
  const get = label => none.find(r => r.label === label).value
  assert.strictEqual(get("Charging"), "No")
  assert.strictEqual(get("Battery"), "Unknown")
  assert.strictEqual(get("Power source"), "Unknown")
  for (const row of none) assert.ok(/^[A-Z0-9-]/.test(row.value), row.label + ": " + row.value)
  const def = model.parseCurrent(JSON.stringify(sample({ rest_source: "default", incomplete: true }))).data
  const notes = model.sampleNotes(def)
  assert.ok(notes.includes("DEFAULT — run power-watch calibrate"), notes)
  assert.ok(notes.includes("unknown terms counted as 0 W"), notes)
  assert.strictEqual(model.sampleNotes(model.parseCurrent(JSON.stringify(sample())).data), "")
})

test("cap status: PL1, GPU against max, no invented max, unknowns", () => {
  const base = model.parseCurrent(JSON.stringify(sample({ gpu_max_limit_w: 190 }))).data
  assert.deepStrictEqual(model.capStatus(base), { cpu: "PL1 91 W", gpu: "190 W (max, uncapped)", gpuCapped: false,
    cpuCapped: false, cpuReverted: false })
  const capped = model.parseCurrent(JSON.stringify(sample({ gpu_limit_w: 80, cpu_limit_w: 45, gpu_max_limit_w: 190 }))).data
  assert.deepStrictEqual(model.capStatus(capped), { cpu: "PL1 45 W", gpu: "80 W of 190 W (capped)", gpuCapped: true,
    cpuCapped: false, cpuReverted: false })
  // No maximum reported: the limit as is, never measured against a made-up one.
  const noMax = model.parseCurrent(JSON.stringify(sample({ gpu_limit_w: 80 }))).data
  assert.deepStrictEqual(model.capStatus(noMax), { cpu: "PL1 91 W", gpu: "80 W (max unknown)", gpuCapped: false,
    cpuCapped: false, cpuReverted: false })
  const withMax = model.parseCurrent(JSON.stringify(sample({ gpu_limit_w: 150, gpu_max_limit_w: 200 }))).data
  assert.strictEqual(model.capStatus(withMax).gpu, "150 W of 200 W (capped)")
  const none = model.parseCurrent(JSON.stringify(sample({ gpu_limit_w: null, cpu_limit_w: null }))).data
  assert.deepStrictEqual(model.capStatus(none), { cpu: "Unknown", gpu: "Unknown", gpuCapped: false,
    cpuCapped: false, cpuReverted: false })
})

test("CPU cap state: capped, uncapped, reverted, and an older service without the keys", () => {
  const cpu = over => model.capStatus(parsed(over))
  const capped = cpu({ cpu_cap: "capped", cpu_cap_w: 45, cpu_limit_w: 45 })
  assert.strictEqual(capped.cpu, "PL1 45 W (capped)")
  assert.strictEqual(capped.cpuCapped, true)
  assert.strictEqual(capped.cpuReverted, false)
  const uncapped = cpu({ cpu_cap: "uncapped", cpu_cap_w: null })
  assert.strictEqual(uncapped.cpu, "PL1 91 W (uncapped)")
  assert.strictEqual(uncapped.cpuCapped, false)
  assert.strictEqual(uncapped.cpuReverted, false)
  const reverted = cpu({ cpu_cap: "reverted", cpu_cap_w: 45 })
  assert.strictEqual(reverted.cpu, "PL1 91 W (45 W cap reverted)")
  assert.strictEqual(reverted.cpuReverted, true)
  assert.strictEqual(reverted.cpuCapped, false)
  assert.strictEqual(cpu({ cpu_cap: "reverted", cpu_cap_w: null }).cpu, "PL1 91 W (cap reverted)")
  assert.strictEqual(cpu({ cpu_cap: "reverted" }).cpu, "PL1 91 W (cap reverted)")
  // A 0 W cap is not a usable figure: no "0 W cap reverted".
  assert.strictEqual(cpu({ cpu_cap: "reverted", cpu_cap_w: 0 }).cpu, "PL1 91 W (cap reverted)")
  assert.strictEqual(cpu({ cpu_cap: "reverted", cpu_cap_w: 0.4 }).cpu, "PL1 91 W (" + model.formatWatts(0.4) + " cap reverted)")
  // Reverted is something other than power-watch undoing the cap; the notes
  // say so, once, and only for reverted.
  const note = "CPU cap reverted by something else; see power-cap status."
  assert.strictEqual(model.sampleNotes(parsed({ cpu_cap: "reverted", cpu_cap_w: 45 })), note)
  assert.strictEqual(model.sampleNotes(parsed({ cpu_cap: "reverted" })), note)
  for (const state of ["capped", "uncapped", null, "bogus"])
    assert.ok(!/reverted/.test(model.sampleNotes(parsed({ cpu_cap: state, cpu_cap_w: 45 }))), String(state))
  assert.ok(model.sampleNotes(parsed({ cpu_cap: "reverted", errors: ["x"] })).endsWith(" " + note), "after the other notes")
  // cpu_cap null, and an older service that writes neither key: today's text.
  assert.deepStrictEqual(cpu({ cpu_cap: null, cpu_cap_w: null }), cpu({}))
  const old = sample()
  assert.ok(!("cpu_cap" in old) && !("cpu_cap_w" in old), "the base sample is an older service's")
  const plain = model.capStatus(model.parseCurrent(JSON.stringify(old)).data)
  assert.strictEqual(plain.cpu, "PL1 91 W")
  assert.strictEqual(plain.cpuCapped, false)
  assert.strictEqual(plain.cpuReverted, false)
  const c = parsed({ cpu_cap: "capped", cpu_cap_w: 45 })
  assert.strictEqual(c.cpuCap, "capped")
  assert.strictEqual(c.cpuCapW, 45)
  assert.strictEqual(parsed().cpuCap, null)
  assert.strictEqual(parsed().cpuCapW, null)
  // No PL1 reported: the state still shows.
  assert.strictEqual(cpu({ cpu_limit_w: null, cpu_cap: "capped" }).cpu, "Unknown (capped)")
})

test("CPU cap state: anything outside the enum, and a bad cap_w, read as not reported", () => {
  for (const v of ["CAPPED", "capped ", "on", "", 1, true, {}, [], ["capped"], NaN]) {
    const c = parsed({ cpu_cap: v, cpu_cap_w: 45 })
    assert.strictEqual(c.cpuCap, null, JSON.stringify(v))
    const caps = model.capStatus(c)
    assert.strictEqual(caps.cpu, "PL1 91 W", JSON.stringify(v))
    assert.strictEqual(caps.cpuCapped || caps.cpuReverted, false, JSON.stringify(v))
  }
  for (const w of ["45", -1, 1e300, NaN, true, {}, []]) {
    const c = parsed({ cpu_cap: "reverted", cpu_cap_w: w })
    assert.strictEqual(c.cpuCapW, null, JSON.stringify(w))
    assert.strictEqual(model.capStatus(c).cpu, "PL1 91 W (cap reverted)", JSON.stringify(w))
  }
  assert.deepStrictEqual(model.CPU_CAP_STATES, ["capped", "uncapped", "reverted"])
})

// ------------------------------------------------ generic-config report keys

test("parses the new report keys", () => {
  const c = parsed()
  assert.strictEqual(c.totalSource, "model")
  assert.strictEqual(c.totalLowerBound, false)
  assert.strictEqual(c.psysW, null)
  assert.strictEqual(c.gpuStatus, "active")
  assert.deepStrictEqual(c.gpuDevices, [{ pci: "0000:01:00.0", vendor: "nvidia", status: "active", powerW: 15.01 }])
  const p = parsed({ total_source: "psys", psys_w: 61.4, total_kind: "measured" })
  assert.strictEqual(p.totalSource, "psys")
  assert.strictEqual(p.psysW, 61.4)
})

test("malformed new keys fall back to not-reported, never to a value", () => {
  const c = parsed({
    total_source: "PSYS", total_lower_bound: "true", psys_w: "61", gpu_status: "<b>active</b>",
    gpu_devices: "0000:01:00.0"
  })
  assert.strictEqual(c.totalSource, "")
  assert.strictEqual(c.totalLowerBound, false)
  assert.strictEqual(c.psysW, null)
  assert.strictEqual(c.gpuStatus, "")
  assert.deepStrictEqual(c.gpuDevices, [])
  assert.strictEqual(parsed({ psys_w: 1e9 }).psysW, null)
  assert.strictEqual(parsed({ total_lower_bound: 1 }).totalLowerBound, false)
  // A lower bound needs a number to bound.
  assert.strictEqual(parsed({ total_lower_bound: true, total_w: null }).totalLowerBound, false)
  // Keys missing altogether (an older service) read the same way.
  const old = sample()
  for (const k of ["total_source", "total_lower_bound", "psys_w", "gpu_status", "gpu_devices"]) delete old[k]
  const o = model.parseCurrent(JSON.stringify(old)).data
  assert.deepStrictEqual([o.totalSource, o.totalLowerBound, o.psysW, o.gpuStatus, o.gpuDevices], ["", false, null, "", []])
  assert.strictEqual(model.gpuRowValue(o), "15 W (P5)", "no gpu_status: watts, as before")
})

test("gpu_devices: capped, non-objects dropped, each field sanitised", () => {
  const many = Array.from({ length: 100 }, () => ({ pci: "0000:01:00.0", vendor: "nvidia", status: "active", power_w: 1 }))
  const m = parsed({ gpu_devices: many })
  assert.strictEqual(m.gpuDevices.length, model.MAX_GPU_DEVICES)
  assert.strictEqual(m.gpuDeviceTotal, 100, "the rest are counted")
  assert.strictEqual(m.gpuDevicesPartial, false)
  const d = parsed({ gpu_devices: [
    null, 7, "x", [1], { pci: "01:00.0<script>", vendor: "intel", status: "on", power_w: "5" },
    { pci: "0000:03:00.0", vendor: "amd", status: "suspended", power_w: null, extra: "y" }
  ] }).gpuDevices
  assert.deepStrictEqual(d, [
    { pci: "", vendor: "", status: "", powerW: null },
    { pci: "0000:03:00.0", vendor: "amd", status: "suspended", powerW: null }
  ])
  assert.strictEqual(model.pciAddress("0000:01:00.0‮"), "")
  assert.strictEqual(model.pciAddress("0000:0G:00.0"), "")
})

test("gpu_devices: the scan has its own cap, whatever the caller bounded", () => {
  const cap = model.MAX_GPU_DEVICE_SCAN
  assert.ok(cap >= model.MAX_GPU_DEVICES && cap <= 1024, String(cap))
  const huge = new Array(1e6).fill(0)
  const t0 = Date.now()
  const r = model.parseGpuDevices(huge)
  assert.ok(Date.now() - t0 < 100, "took " + (Date.now() - t0) + " ms")
  assert.deepStrictEqual(r, { devices: [], total: 0, partial: true })
  // An entry past the cap is never looked at.
  const late = new Array(cap).fill(null).concat([{ status: "active" }])
  assert.deepStrictEqual(model.parseGpuDevices(late), { devices: [], total: 0, partial: true })
  const exact = new Array(cap - 1).fill(null).concat([{ status: "active" }])
  assert.strictEqual(model.parseGpuDevices(exact).devices.length, 1)
  assert.strictEqual(model.parseGpuDevices(exact).partial, false)
})

test("more than MAX_GPU_DEVICES GPUs: the row says the list was cut", () => {
  const dev = (status) => ({ pci: "0000:01:00.0", vendor: "nvidia", status: status, power_w: 1 })
  const row = over => model.gpuRowValue(parsed(over))
  const twenty = Array.from({ length: 20 }, () => dev("active"))
  assert.strictEqual(row({ gpu_devices: twenty, gpu_w: 20 }), "20 W (16 of 20 GPUs listed)")
  assert.strictEqual(row({ gpu_devices: twenty.map(() => dev("suspended")), gpu_status: "suspended" }),
    "Suspended (16 of 20 GPUs listed)")
  // Exactly the cap: nothing was cut.
  const sixteen = twenty.slice(0, 16)
  assert.strictEqual(row({ gpu_devices: sixteen, gpu_w: 16 }), "16 W (16 GPUs)")
  assert.strictEqual(model.gpuListCut(parsed({ gpu_devices: sixteen })), false)
  // Past the scan the count is a floor.
  // Past the scan the count is a floor (built from the parse directly: that
  // many entries do not fit through the current.json caps).
  const flood = model.parseGpuDevices(Array.from({ length: model.MAX_GPU_DEVICE_SCAN + 5 }, () => dev("active")))
  const c = Object.assign(parsed({ gpu_w: 5 }), { gpuDevices: flood.devices, gpuDeviceTotal: flood.total,
    gpuDevicesPartial: flood.partial })
  assert.strictEqual(model.gpuRowValue(c), "5 W (16 of " + model.MAX_GPU_DEVICE_SCAN + "+ GPUs listed)")
  assert.strictEqual(model.gpuCountText(parsed()), "", "one GPU: no count")
})

test("a lower-bound total is marked in the bar, the hero, the tooltip and the stats", () => {
  const lb = parsed({ total_w: 81.6, incomplete: true, total_lower_bound: true, gpu_w: null, gpu_status: "unknown",
    adapter_current_a: 4.18 })
  const mark = model.LOWER_BOUND_MARK
  assert.strictEqual(mark, "≥")
  assert.strictEqual(model.barText(lb, false), "≥82 W")
  assert.strictEqual(model.barText(lb, true), "-- W", "a stale lower bound is no number at all")
  assert.deepStrictEqual(model.barLines(lb, false), ["≥", "82", "W"], "the mark has its own line")
  // The bar always reserves room for the mark, so it never resizes when the
  // mark toggles: the widest text has it, the vertical slots fit its line.
  assert.strictEqual(model.BAR_WIDEST_TEXT, "≥000 W")
  assert.strictEqual(model.barLines(lb, false).length, model.BAR_VERTICAL_SLOTS)
  for (const c of [lb, parsed(), parsed({ total_w: 999.4 }), null])
    for (const stale of [false, true]) {
      assert.ok(model.barLines(c, stale).length <= model.BAR_VERTICAL_SLOTS)
      assert.ok(model.barText(c, stale).length <= model.BAR_WIDEST_TEXT.length, model.barText(c, stale))
    }
  const tip = model.tooltipText(lb, false)
  assert.ok(tip.startsWith("Adapter ≥82 W · ≥4.2 A"), tip)
  assert.ok(tip.includes("Estimated (lower bound) · AC"), tip)
  assert.ok(!tip.includes("incomplete"), tip)
  assert.strictEqual(model.statusLine(lb), "Estimated (lower bound) · AC · Below the 150 W threshold")
  const stats = model.stats([], lb, false)
  assert.strictEqual(model.currentStatText(stats, lb, false), "≥82 W")
  assert.strictEqual(model.currentStatText(model.stats([], lb, true), lb, true), "-- W")
  assert.strictEqual(model.currentStatText(model.stats([], parsed(), false), parsed(), false), "53 W")
  const get = label => model.breakdown(lb).find(r => r.label === label).value
  assert.strictEqual(get("Total is"), "Estimated (lower bound)")
  assert.strictEqual(get("Adapter current"), "≥4.2 A")
  assert.strictEqual(get("Of adapter rating"), "≥25% of 330 W")
  assert.strictEqual(get("GPU"), "Unknown")
  assert.strictEqual(model.sampleNotes(lb), "Lower bound: unknown terms counted as 0 W.")
})

test("incomplete without a lower bound keeps the incomplete wording", () => {
  // Battery side: the measured total itself is unknown.
  const bat = parsed({ ac_online: false, total_kind: "measured", total_source: "battery", total_w: null,
    incomplete: true, adapter_current_a: null })
  assert.strictEqual(model.barText(bat, false), "-- W")
  assert.strictEqual(model.breakdown(bat).find(r => r.label === "Total is").value, "Measured (incomplete)")
  assert.ok(model.tooltipText(bat, false).includes("Measured · Battery · incomplete"))
  assert.strictEqual(model.sampleNotes(bat), "Estimate incomplete: unknown terms counted as 0 W.")
  // An older service: incomplete, no total_lower_bound key.
  const old = parsed({ incomplete: true, total_lower_bound: undefined })
  assert.strictEqual(model.barText(old, false), "53 W")
  assert.strictEqual(model.breakdown(old).find(r => r.label === "Total is").value, "Estimated (incomplete)")
})

test("a psys total is measured platform power on AC, never battery or estimated", () => {
  const ps = parsed({ total_source: "psys", total_kind: "measured", psys_w: 64.2, total_w: 64.2 })
  assert.strictEqual(model.totalLabel(ps), "Measured (platform power)")
  assert.strictEqual(model.statusLine(ps), "Measured (platform power) · AC · Below the 150 W threshold")
  const tip = model.tooltipText(ps, false)
  assert.ok(tip.startsWith("Adapter 64 W"), tip)
  assert.ok(tip.includes("Measured (platform power) · AC"), tip)
  assert.ok(!/battery|estimated/i.test(tip.split("\n")[1]), tip)
  // One wording on every surface: status line, tooltip, "Total is", legend.
  const total = model.breakdown(ps).find(r => r.label === "Total is").value
  assert.strictEqual(total, model.PSYS_LABEL)
  assert.strictEqual(model.PSYS_LABEL, "Measured (platform power)")
  assert.ok(/platform power/.test(model.PSYS_BAND_LABEL) && /^AC, measured/.test(model.PSYS_BAND_LABEL))
  assert.strictEqual(model.breakdown(parsed({ total_source: "psys", total_kind: "measured", incomplete: true }))
    .find(r => r.label === "Total is").value, "Measured (platform power) (incomplete)")
  for (const file of ["Model.js", "BarWidget.qml"]) {
    const code = fs.readFileSync(path.join(pluginDir, file), "utf8").replace(/\/\/.*$/gm, "")
    assert.ok(!/"[^"\n]*RAPL psys[^"\n]*"/.test(code), file + " shows a second psys wording")
    assert.ok(!/"AC, measured"/.test(code), file + " has the bare legend label")
  }
  assert.strictEqual(model.sampleNotes(ps), "")
  // The model total and a battery total keep their words.
  assert.strictEqual(model.totalLabel(parsed()), "Estimated")
  assert.strictEqual(model.totalLabel(parsed({ ac_online: false, total_kind: "measured", total_source: "battery" })), "Measured")
})

test("gpu_status: suspended, none and disabled are words, not 0 W", () => {
  const row = over => model.gpuRowValue(parsed(over))
  assert.strictEqual(row({}), "15 W (P5)")
  assert.strictEqual(row({ gpu_status: "suspended", gpu_w: 0, gpu_pstate: null }), "Suspended")
  assert.strictEqual(row({ gpu_status: "none", gpu_w: 0, gpu_devices: [] }), "No discrete GPU")
  assert.strictEqual(row({ gpu_status: "disabled", gpu_w: 0, gpu_devices: [] }), "Not monitored")
  assert.strictEqual(row({ gpu_status: "unknown", gpu_w: null }), "Unknown")
  assert.strictEqual(row({ gpu_status: "unknown", gpu_w: 12 }), "12 W + unknown")
  const two = [{ pci: "0000:01:00.0", vendor: "nvidia", status: "active", power_w: 15 },
    { pci: "0000:03:00.0", vendor: "amd", status: "suspended", power_w: null }]
  assert.strictEqual(row({ gpu_devices: two }), "15 W (P5, 1 of 2 active)")
  assert.strictEqual(row({ gpu_devices: [two[0], two[0]], gpu_pstate: null }), "15 W (2 GPUs)")
  // The P-state is one GPU's: never next to the watts of several active ones.
  assert.strictEqual(row({ gpu_devices: [two[0], two[0]], gpu_pstate: "P5", gpu_w: 30 }), "30 W (2 GPUs)")
  assert.strictEqual(row({ gpu_status: "suspended", gpu_devices: [two[1], two[1]] }), "Suspended (2 GPUs)")
  // The caps section follows the same words when there is no limit to show.
  const cap = over => model.capStatus(parsed(Object.assign({ gpu_limit_w: null }, over))).gpu
  assert.strictEqual(cap({ gpu_status: "suspended" }), "Suspended")
  assert.strictEqual(cap({ gpu_status: "none" }), "No discrete GPU")
  assert.strictEqual(cap({ gpu_status: "disabled" }), "Not monitored")
  assert.strictEqual(cap({ gpu_status: "unknown" }), "Unknown")
  assert.strictEqual(cap({}), "Unknown")
})

test("unknown adapter voltage and rating: said in words, no amps, no share of rating", () => {
  const c = parsed({ adapter_v: null, adapter_current_a: null, adapter_rating_w: null })
  const get = label => model.breakdown(c).find(r => r.label === label).value
  assert.strictEqual(get("Adapter current"), "Not configured")
  assert.strictEqual(get("Of adapter rating"), "Not configured")
  // Keys absent altogether (an older service) are not configured either.
  const old = sample()
  delete old.adapter_v
  delete old.adapter_rating_w
  const o = model.breakdown(model.parseCurrent(JSON.stringify(old)).data)
  assert.strictEqual(o.find(r => r.label === "Adapter current").value, "Not configured")
  assert.strictEqual(o.find(r => r.label === "Of adapter rating").value, "Not configured")
  const tip = model.tooltipText(c, false)
  assert.strictEqual(tip.split("\n")[0], "Adapter 53 W", "no amps in the tooltip head")
  // Threshold behaviour is untouched: threshold_w is always present.
  assert.strictEqual(model.level(c.totalW, c.thresholdW), "normal")
  assert.strictEqual(model.level(parsed({ total_w: 140, threshold_w: 100, adapter_rating_w: null }).totalW, 100), "over")
  // Nonsense voltages are unknown, not a divisor.
  assert.strictEqual(parsed({ adapter_v: 0 }).adapterV, null)
  assert.strictEqual(parsed({ adapter_v: "19.5" }).adapterV, null)
  // Known voltage, amps unknown on battery: the placeholder, as before.
  const bat = parsed({ ac_online: false, adapter_current_a: null })
  assert.strictEqual(model.breakdown(bat).find(r => r.label === "Adapter current").value, "-- A")
  // No sample at all keeps the placeholders, not "not configured".
  const none = model.breakdown(null)
  assert.strictEqual(none.find(r => r.label === "Adapter current").value, "-- A")
  assert.strictEqual(none.find(r => r.label === "Of adapter rating").value, "--")
})

test("out-of-range adapter voltage or rating reads Invalid, not Not configured", () => {
  const get = (over, label) => model.breakdown(parsed(over)).find(r => r.label === label).value
  for (const v of [5000, 0, -1, "19.5", true, {}])
    assert.strictEqual(get({ adapter_v: v, adapter_current_a: 3 }, "Adapter current"), "Invalid", JSON.stringify(v))
  for (const v of [1e6, 0, -1, "330", true, {}])
    assert.strictEqual(get({ adapter_rating_w: v }, "Of adapter rating"), "Invalid", JSON.stringify(v))
  assert.strictEqual(get({ adapter_v: null }, "Adapter current"), "Not configured")
  assert.strictEqual(get({ adapter_rating_w: null }, "Of adapter rating"), "Not configured")
  assert.strictEqual(get({}, "Adapter current"), "2.7 A")
})

test("a measured total is never a lower bound, whatever the flag says", () => {
  const lb = over => model.isLowerBound(parsed(Object.assign({ total_lower_bound: true, incomplete: true }, over)))
  assert.strictEqual(lb({ total_source: "psys", total_kind: "measured" }), false)
  assert.strictEqual(lb({ total_source: "battery", total_kind: "measured", ac_online: false }), false)
  assert.strictEqual(lb({ total_source: "model", total_kind: "measured" }), false)
  assert.strictEqual(lb({ total_source: "psys", total_kind: "estimated" }), false)
  assert.strictEqual(lb({ total_source: "model", total_kind: "estimated" }), true)
  assert.strictEqual(lb({ total_source: undefined, total_kind: "estimated" }), true, "older service: no source key")
  const ps = parsed({ total_source: "psys", total_kind: "measured", total_lower_bound: true, total_w: 100 })
  assert.strictEqual(model.barText(ps, false), "100 W")
  assert.ok(!model.tooltipText(ps, false).includes(model.LOWER_BOUND_MARK))
  assert.strictEqual(model.statusLine(ps), "Measured (platform power) · AC · Below the 150 W threshold")
})

test("no shown string carries NaN, null or undefined, whatever the new keys hold", () => {
  const junk = [null, undefined, "x", NaN, {}, [], true, -1, 1e300]
  for (const v of junk) {
    const c = parsed({ total_source: v, total_lower_bound: v, psys_w: v, gpu_status: v, gpu_devices: v,
      adapter_v: v, adapter_current_a: v, adapter_rating_w: v, total_w: v, gpu_w: v, cpu_cap: v, cpu_cap_w: v })
    const texts = [model.barText(c, false), model.barLines(c, false).join(" "),
      model.tooltipText(c, false), model.statusLine(c), model.sampleNotes(c),
      model.currentStatText(model.stats([], c, false), c, false),
      model.capStatus(c).gpu, model.capStatus(c).cpu]
    for (const row of model.breakdown(c)) texts.push(row.label + ": " + row.value)
    for (const t of texts) assertClean(t, String(v))
  }
  for (const status of model.GPU_STATUSES) {
    const c = parsed({ gpu_status: status, gpu_w: null, gpu_limit_w: null, gpu_pstate: null })
    assertClean(model.gpuRowValue(c), status)
    assert.notStrictEqual(model.gpuRowValue(c), "0 W", status)
  }
})

// ---------------------------------------------------------------- history

test("parses JSONL, skipping torn, garbage, blank and non-advancing lines", () => {
  const text = [
    JSON.stringify(point(100)),
    "",
    "not json at all",
    JSON.stringify(point(102)),
    JSON.stringify(point(102, { avg: 1 })),          // t does not advance
    JSON.stringify(point(101)),                       // t goes backwards
    "[1,2,3]",
    JSON.stringify({ n: 1, avg: 3 }),                 // no t
    JSON.stringify(point(104)),
    '{"t": 106, "n": 1, "avg": 8'                     // torn tail
  ].join("\n")
  const r = model.parseHistory(text)
  assert.deepStrictEqual(r.points.map(p => p.t), [100, 102, 104])
  assert.strictEqual(r.skipped, 6)
  assert.strictEqual(r.truncated, false)
})

test("points stamped after now are ignored and do not hold back later ones", () => {
  const text = jsonl([point(100), point(1e10), point(102), point(5000), point(104)])
  const r = model.parseHistory(text, 1000)
  assert.deepStrictEqual(r.points.map(p => p.t), [100, 102, 104])
  assert.strictEqual(r.skipped, 0)
  assert.deepStrictEqual(model.parseHistory(text).points.map(p => p.t), [100, 1e10], "without now: the 1e10 line blocks the rest")
})

test("history points are normalized and bound", () => {
  const r = model.parseHistory(JSON.stringify({ t: 5, n: "3", avg: "1", max: 1e12, ac: 2, k: "z", extra: 1 }) + "\n")
  assert.deepStrictEqual(r.points[0], { t: 5, n: 1, avg: null, max: null, cpu: null, gpu: null,
    rest: null, chg: null, ac: null, k: "" })
})

test("history caps keep the NEWEST: character budget, overlong lines, line count", () => {
  const long = JSON.stringify(point(1, { pad: "y".repeat(model.HISTORY_MAX_LINE_CHARS) }))
  assert.strictEqual(model.parseHistory(long + "\n" + JSON.stringify(point(2))).skipped, 1)
  const total = model.HISTORY_MAX_LINES + 10
  const many = Array.from({ length: total }, (_, i) => JSON.stringify({ t: i + 1 })).join("\n") + "\n"
  const r = model.parseHistory(many)
  assert.strictEqual(r.points.length, model.HISTORY_MAX_LINES)
  assert.strictEqual(r.points[r.points.length - 1].t, total, "the newest line is kept")
  assert.strictEqual(r.points[0].t, 11, "the oldest ten are dropped")
  assert.strictEqual(r.truncated, true)
  // A budget cut lands on a line start: no torn first line is counted.
  const big = "x".repeat(model.HISTORY_PARSE_CHARS) + "\n" + JSON.stringify(point(7)) + "\n"
  const b = model.parseHistory(big)
  assert.deepStrictEqual(b.points.map(p => p.t), [7])
  assert.strictEqual(b.skipped, 0)
  assert.strictEqual(b.truncated, true)
})

test("a sub-0.12 s interval at the compaction ceiling still charts its newest part", () => {
  // Raw tier at 0.1 s: 1.25 x 3600 / 0.1 = 45 000 lines of ~109 B, past the
  // parse budget. Before the fix this blanked the 1h chart ("too large").
  const now = 1761300000
  const lines = []
  for (let i = 0; i < 45000; i++) lines.push(JSON.stringify({ t: Math.round((now - 4500 + i * 0.1) * 100) / 100,
    n: 1, avg: 80.12, max: 90.45, cpu: 8.21, gpu: 38.05, rest: 25.01, chg: 0.0, ac: 1.0, k: "e" }))
  const text = lines.join("\n") + "\n"
  assert.ok(text.length > model.HISTORY_PARSE_CHARS && text.length < model.HISTORY_MAX_BYTES, String(text.length))
  const t0 = Date.now()
  const r = model.parseHistory(text, now)
  const m = model.chartModel(r.points, "1h", now, 0.1, 150)
  const ms = Date.now() - t0
  assert.strictEqual(r.truncated, true)
  assert.ok(r.points.length > 30000, String(r.points.length))
  assert.strictEqual(r.points[r.points.length - 1].t, JSON.parse(lines[lines.length - 1]).t)
  assert.ok(m.count > 0 && m.runs.length >= 1)
  assert.ok(ms < 1000, "took " + ms + " ms")
})

test("history lines: only '{' lines up to HISTORY_MAX_LINE_CHARS reach JSON.parse", () => {
  // A live service's longest line is 134 characters (all three tiers); the
  // cap leaves headroom over that, and no more.
  assert.strictEqual(model.HISTORY_MAX_LINE_CHARS, 256)
  const svc = JSON.stringify({ t: 1761300000.25, n: 1, avg: 123.45, max: 234.56, cpu: 45.67, gpu: 123.45,
    rest: 25.01, chg: 12.34, ac: 1.0, k: "m" })
  assert.ok(svc.length < model.HISTORY_MAX_LINE_CHARS)
  const fill = (n) => JSON.stringify(point(n, { pad: "" })).replace('"pad":""', '"pad":"' + "y".repeat(model.HISTORY_MAX_LINE_CHARS) + '"')
  const atCap = (n) => { const l = JSON.stringify(point(n, { pad: "" })); return l.replace('"pad":""', '"pad":"' + "y".repeat(model.HISTORY_MAX_LINE_CHARS - l.length) + '"') }
  assert.strictEqual(atCap(1).length, model.HISTORY_MAX_LINE_CHARS)
  const r = model.parseHistory([atCap(1), fill(2), " " + JSON.stringify(point(3)), "[" + JSON.stringify(point(4)) + "]",
    '"x"', "5", JSON.stringify(point(6))].join("\n") + "\n")
  assert.deepStrictEqual(r.points.map(p => p.t), [1, 6])
  assert.strictEqual(r.skipped, 5)
})

test("a tier of nested-bracket junk is skipped faster than a service tier parses", () => {
  // The audit's input: 4 MiB of [x511 ]x511 lines parsed at 1.6x a valid
  // tier in the shell's engine (430-560 ms vs 290-350 ms). Now none reaches
  // JSON.parse; the same junk short enough to pass the length cap neither.
  const MiB4 = 4 * 1048576
  const tier = (line) => {
    const n = Math.floor(MiB4 / (line.length + 1))
    return { text: (line + "\n").repeat(n), n }
  }
  const svcLine = JSON.stringify({ t: 1761300000.25, n: 1, avg: 80.12, max: 90.45, cpu: 8.21, gpu: 38.05,
    rest: 25.01, chg: 0.0, ac: 1.0, k: "e" })
  const svcLines = []
  for (let i = 0, n = Math.floor(MiB4 / (svcLine.length + 1)); i < n; i++)
    svcLines.push(svcLine.replace("1761300000.25", String(1761300000 + i)))
  const svcText = svcLines.join("\n") + "\n"
  const time = (text) => { const t0 = process.hrtime.bigint(); const r = model.parseHistory(text, 1792900000); return [r, Number(process.hrtime.bigint() - t0) / 1e6] }
  time(svcText)
  const [svc, svcMs] = time(svcText)
  assert.strictEqual(svc.skipped, 0)
  for (const depth of [511, 127]) {
    const junk = tier("[".repeat(depth) + "]".repeat(depth))
    assert.ok(junk.text.length <= model.HISTORY_PARSE_CHARS && junk.text.length > model.HISTORY_PARSE_CHARS - 2048)
    const [r, ms] = time(junk.text)
    assert.strictEqual(r.points.length, 0)
    assert.strictEqual(r.skipped, Math.min(junk.n, model.HISTORY_MAX_LINES), "every junk line counts as skipped")
    // Measured in node: 2-4 ms for either depth against 50-65 ms for the
    // service tier; before the fix the junk took 160-220 ms. 50 ms is a
    // generous bound that parsing the junk cannot meet.
    assert.ok(ms < 50, "depth " + depth + ": " + ms.toFixed(1) + " ms (service tier " + svcMs.toFixed(1) + " ms)")
    assert.ok(ms < svcMs, "depth " + depth + ": junk " + ms.toFixed(1) + " ms, service tier " + svcMs.toFixed(1) + " ms")
  }
})

test("parsing a tier at its compaction ceiling is fast", () => {
  const lines = []
  for (let i = 0; i < 3600; i++) lines.push(JSON.stringify(point(1761300000 + i * 60)))
  const t0 = Date.now()
  const r = model.parseHistory(lines.join("\n"))
  const ms = Date.now() - t0
  assert.strictEqual(r.points.length, 3600)
  assert.ok(ms < 200, "took " + ms + " ms")
})

test("range filter keeps [from, to]", () => {
  const pts = [point(10), point(20), point(30), point(40)]
  assert.deepStrictEqual(model.filterRange(pts, 20, 30).map(p => p.t), [20, 30])
  assert.deepStrictEqual(model.filterRange(null, 0, 1), [])
})

test("gaps: more than 2.5 steps apart breaks a run", () => {
  const pts = [point(0), point(2), point(4), point(9), point(11), point(16.1)]
  assert.deepStrictEqual(model.splitGaps(pts, 2).map(r => r.map(p => p.t)), [[0, 2, 4, 9, 11], [16.1]])
  assert.deepStrictEqual(model.splitGaps([point(0), point(5.1)], 2).length, 2)
  assert.deepStrictEqual(model.splitGaps([point(0), point(5)], 2).length, 1)
  assert.deepStrictEqual(model.splitGaps([], 2), [])
})

test("power mode: ac=0 is battery, k=e is AC, k=x is mixed", () => {
  assert.strictEqual(model.pointMode(point(0, { k: "m", ac: 0 })), "battery")
  assert.strictEqual(model.pointMode(point(0, { k: "", ac: 0 })), "battery")
  assert.strictEqual(model.pointMode(point(0, { k: "e" })), "ac")
  assert.strictEqual(model.pointMode(point(0, { k: "x", ac: 0.5 })), "mixed")
  assert.strictEqual(model.pointMode(point(0, { k: "", ac: 1 })), "ac")
  assert.strictEqual(model.pointMode(point(0, { k: "", ac: null })), "unknown")
})

test("power mode: k=m on AC is measured AC (psys), never battery", () => {
  assert.strictEqual(model.pointMode(point(0, { k: "m", ac: 1 })), "acMeasured")
  // The battery is measured only when AC is known to be off: no AC state is psys.
  assert.strictEqual(model.pointMode(point(0, { k: "m", ac: null })), "acMeasured")
  assert.strictEqual(model.pointMode(point(0, { k: "m", ac: 0.5 })), "mixed")
  assert.strictEqual(model.pointMode(point(0, { k: "e", ac: 1 })), "ac")
  const pts = [point(0, { k: "m", ac: 1 }), point(2, { k: "m", ac: 1 }), point(4, { k: "m", ac: 0 })]
  assert.deepStrictEqual(model.modeSpans(pts, 2).map(s => s.mode), ["acMeasured", "battery"])
  // The legend shows the measured-AC band only when there is one to explain.
  const now = 1761300000
  const psysChart = model.chartModel([point(now - 10, { k: "m", ac: 1 })], "1h", now, 2, 150)
  const modelChart = model.chartModel([point(now - 10)], "1h", now, 2, 150)
  assert.strictEqual(model.showsMeasuredAc(psysChart, parsed()), true)
  assert.strictEqual(model.showsMeasuredAc(modelChart, parsed()), false)
  assert.strictEqual(model.showsMeasuredAc(null, parsed({ total_source: "psys" })), true)
  assert.strictEqual(model.showsMeasuredAc(null, null), false)
  assert.ok(model.CHART_STYLE.acMeasuredAlpha > model.CHART_STYLE.mixedAlpha
    && model.CHART_STYLE.acMeasuredAlpha < model.CHART_STYLE.batteryAlpha)
})

test("merged slots keep psys with unknown AC apart from battery", () => {
  // The mean of ac skips nulls: k=m ac=null (psys, AC state unknown) with
  // k=m ac=0 (battery) averaged to ac 0 and drew as battery.
  const mixed = model.consolidate([point(0, { k: "m", ac: null }), point(2, { k: "m", ac: null }),
    point(3, { k: "m", ac: 0 })], 0, 10)
  assert.strictEqual(mixed.length, 1)
  assert.strictEqual(model.pointMode(mixed[0]), "mixed")
  const psys = model.consolidate([point(0, { k: "m", ac: null }), point(2, { k: "m", ac: 1 })], 0, 10)
  assert.strictEqual(model.pointMode(psys[0]), "acMeasured")
  const bat = model.consolidate([point(0, { k: "m", ac: 0 }), point(2, { k: "", ac: 0 })], 0, 10)
  assert.strictEqual(model.pointMode(bat[0]), "battery")
  // A history line cannot set the mode itself.
  assert.strictEqual(model.parseHistory(JSON.stringify(point(5, { mode: "battery", ac: 1 })) + "\n").points[0].mode, undefined)
  // Through the whole chart: past the render cap, a psys hour with one
  // battery minute never turns into a battery band where it is psys.
  const now = 1761300000
  const pts = []
  for (let i = 0; i < 3000; i++) pts.push(point(now - 3600 + i * 1.2, { k: "m", ac: i >= 1500 && i < 1550 ? 0 : null }))
  const spans = model.chartModel(pts, "1h", now, 1.2, 150).spans
  const battery = spans.filter(sp => sp.mode === "battery").reduce((a, sp) => a + sp.t1 - sp.t0, 0)
  assert.ok(battery <= 50 * 1.2 + 5, "battery band " + battery + " s for 60 s of battery")
})

test("mode spans follow runs and break at gaps", () => {
  const pts = [
    point(0, { k: "e" }), point(2, { k: "e" }),
    point(4, { k: "m", ac: 0 }), point(6, { k: "m", ac: 0 }),
    point(20, { k: "m", ac: 0 })
  ]
  assert.deepStrictEqual(model.modeSpans(pts, 2), [
    { mode: "ac", t0: 0, t1: 4 },
    { mode: "battery", t0: 4, t1: 8 },
    { mode: "battery", t0: 20, t1: 22 }
  ])
})

test("stats: max of max, n-weighted mean of avg, current only while fresh", () => {
  const pts = [
    point(0, { n: 30, avg: 100, max: 120 }),
    point(60, { n: 10, avg: 60, max: 200 }),
    point(120, { n: 5, avg: null, max: null })
  ]
  const cur = { totalW: 77 }
  assert.deepStrictEqual(model.stats(pts, cur, false), { max: 200, avg: 90, current: 77 })
  assert.deepStrictEqual(model.stats(pts, cur, true), { max: 200, avg: 90, current: null })
  assert.deepStrictEqual(model.stats([], null, false), { max: null, avg: null, current: null })
  // a point with avg but no max still counts toward Max
  assert.strictEqual(model.stats([point(0, { avg: 50, max: null })], null, true).max, 50)
})

test("consolidation merges time slots: mean of avg (n-weighted), max of max, mixed k", () => {
  const run = [point(0, { n: 1, avg: 10, max: 10 }), point(2, { n: 3, avg: 30, max: 90, k: "m", ac: 0 }), point(4, { avg: 5, max: 5 })]
  const out = model.consolidate(run, 0, 4)
  assert.strictEqual(out.length, 2)
  assert.strictEqual(out[0].t, 0)
  assert.strictEqual(out[0].tEnd, 2)
  assert.strictEqual(out[0].n, 4)
  assert.strictEqual(out[0].avg, 25)
  assert.strictEqual(out[0].max, 90)
  assert.strictEqual(out[0].k, "x")
  assert.strictEqual(out[0].ac, 0.25)
  assert.strictEqual(out[1], run[2], "a slot of one keeps the point as is")
  assert.strictEqual(model.consolidate(run, 0, 0), run)
})

test("a gap wider than a slot survives consolidation; one inside a slot merges away", () => {
  const pts = [point(0), point(1), point(2), point(3), point(40), point(41)]
  const merged = model.consolidate(pts, 0, 10)
  assert.strictEqual(merged.length, 2)
  assert.strictEqual(model.splitGaps(merged, 2).length, 2, "the 37 s hole is still a gap")
  // 3 -> 8 is a gap at step 1, but within one 10 s slot it is below the chart's resolution
  const inSlot = model.consolidate([point(0), point(3), point(8), point(9)], 0, 10)
  assert.strictEqual(model.splitGaps(inSlot, 1).length, 1)
})

test("nice axis always clears the top value", () => {
  assert.deepStrictEqual(model.niceAxis(157.5), { max: 200, step: 50, ticks: [0, 50, 100, 150, 200] })
  assert.strictEqual(model.niceAxis(100).max > 100, true)
  assert.strictEqual(model.niceAxis(0).max > 0, true)
  assert.strictEqual(model.niceAxis(NaN).max > 0, true)
})

test("time ticks: 10 min for 1h, 3 h for 24h, midnights for 7d", () => {
  const now = Date.UTC(2026, 9, 24, 13, 47, 0) / 1000
  const h = model.timeTicks(now - 3600, now, "1h")
  assert.deepStrictEqual(h.map(t => t.label), ["12:50", "13:00", "13:10", "13:20", "13:30", "13:40"])
  const d = model.timeTicks(now - 86400, now, "24h")
  assert.strictEqual(d[0].label, "15:00")
  assert.strictEqual(d.length, 8)
  const w = model.timeTicks(now - 604800, now, "7d")
  assert.deepStrictEqual(w.map(t => t.label), ["Sun 18", "Mon 19", "Tue 20", "Wed 21", "Thu 22", "Fri 23", "Sat 24"])
  assert.deepStrictEqual(model.timeTicks(5, 5, "1h"), [])
})

test("chart model: filters to the range, keeps gaps, scales above threshold", () => {
  const now = 1761300000
  const pts = []
  for (let i = 0; i < 100; i++) pts.push(point(now - 4000 + i * 2))     // older than the 1h range
  for (let i = 0; i < 50; i++) pts.push(point(now - 600 + i * 2, { avg: 170, max: 180 }))
  for (let i = 0; i < 50; i++) pts.push(point(now - 200 + i * 2, { k: "m", ac: 0 }))
  const m = model.chartModel(pts, "1h", now, 2, 150)
  assert.strictEqual(m.count, 100)
  assert.strictEqual(m.runs.length, 2, "the 400 s hole is a gap")
  assert.strictEqual(m.step, 2)
  assert.strictEqual(m.offset, 0)
  assert.ok(m.axis.max >= 180)
  assert.deepStrictEqual(m.spans.map(s => s.mode), ["ac", "battery"])
  const day = model.chartModel([point(now - 120), point(now - 60)], "24h", now, 2, 150)
  assert.strictEqual(day.step, 60)
  assert.strictEqual(day.offset, 30)
  assert.ok(day.axis.max > 150, "threshold always visible")
})

test("render cap is global: gap-heavy history draws at most the cap, in linear time", () => {
  // Every point isolated by a gap (the audit's quadratic case: 27 685 runs took
  // 86 s per paint in V4). Points 0.13 s apart at interval 0.05 s.
  const now = 1761300000
  const pts = []
  for (let t = now - 3599; t < now && pts.length < 30000; t += 0.13) pts.push(point(Math.round(t * 100) / 100))
  assert.ok(pts.length >= 27000, String(pts.length))
  const t0 = Date.now()
  const m = model.chartModel(pts, "1h", now, 0.05, 150)
  const lay = model.chartLayout(m, 540, 200, {})
  const ms = Date.now() - t0
  const drawn = m.runs.reduce((a, r) => a + r.length, 0)
  assert.ok(drawn <= model.MAX_RENDER_POINTS, "drew " + drawn)
  assert.ok(m.runs.length <= model.MAX_RENDER_POINTS, "runs " + m.runs.length)
  assert.ok(m.spans.length <= model.MAX_RENDER_POINTS, "spans " + m.spans.length)
  assert.ok(lay.area.length <= model.MAX_RENDER_POINTS, "polys " + lay.area.length)
  assert.strictEqual(m.count, pts.length)
  assert.ok(ms < 100, "chartModel + chartLayout took " + ms + " ms")
  // Alternating battery/AC every point: spans are capped too.
  const alt = pts.map((p, i) => Object.assign({}, p, i % 2 ? { k: "m", ac: 0 } : { k: "e", ac: 1 }))
  assert.ok(model.chartModel(alt, "1h", now, 0.13, 150).spans.length <= model.MAX_RENDER_POINTS)
})

test("chartLayout appends, never concats (linear in the number of runs)", () => {
  const src = model.chartLayout.toString()
  assert.ok(!/\.concat\(/.test(src), "chartLayout must not concat inside its run loop")
})

test("chart model consolidates dense data down to the render cap", () => {
  const now = 1761300000
  const pts = []
  for (let i = 0; i < 7200; i++) pts.push(point(now - 3600 + i * 0.5))
  const m = model.chartModel(pts, "1h", now, 0.5, 150)
  const drawn = m.runs.reduce((a, r) => a + r.length, 0)
  assert.ok(drawn <= model.MAX_RENDER_POINTS, "drew " + drawn)
  assert.strictEqual(m.runs.length, 1)
})

test("layout: gaps and null values break lines, lone points get a width", () => {
  const now = 1000
  const pts = [point(100), point(102), point(104, { cpu: null }), point(106), point(500)]
  const m = model.chartModel(pts, "1h", now + 2600, 2, 150)
  // re-anchor so the range covers the points
  const lay = model.chartLayout(m, 600, 200, { left: 40, right: 8, top: 8, band: 6, bottom: 20 })
  assert.strictEqual(lay.area.length, 2)
  assert.strictEqual(lay.cpu.length, 3, "null cpu splits the first run")
  assert.strictEqual(lay.area[1].length, 2, "lone point drawn one step wide")
  assert.ok(lay.area[1][1][0] > lay.area[1][0][0])
  assert.ok(lay.thresholdY > lay.plot.y && lay.thresholdY < lay.baseY)
  assert.strictEqual(lay.empty, false)
  for (const poly of lay.max) for (const [x, y] of poly) {
    assert.ok(x >= lay.plot.x - 0.01 && x <= lay.plot.x + lay.plot.w + 2, "x in plot: " + x)
    assert.ok(y >= lay.plot.y - 0.01 && y <= lay.baseY + 0.01, "y in plot: " + y)
  }
  assert.ok(lay.yTicks.length >= 3 && lay.xTicks.length >= 1)
  assert.ok(/ W$/.test(lay.yTicks[lay.yTicks.length - 1].label), "the top watt tick carries the unit")
  assert.ok(!/W/.test(lay.yTicks[0].label))
})

test("axis labels are clamped by their own width, so 'Sat 24' fits at the edge", () => {
  // a 7d label ~40 px wide whose tick sits 5 px inside the plot's right edge
  assert.strictEqual(model.clampLabelX(495, 40, 40, 460), 480)
  assert.strictEqual(model.clampLabelX(42, 40, 40, 460), 60)
  assert.strictEqual(model.clampLabelX(200, 40, 40, 460), 200)
  assert.strictEqual(model.clampLabelX(200, 1000, 40, 460), 270, "a label wider than the plot is centred")
})

test("Max, CPU and GPU differ by pattern or weight, not only colour", () => {
  const st = model.CHART_STYLE
  const sig = (dash, width) => JSON.stringify([dash || null, width])
  const looks = [sig(st.maxDash, st.maxWidth), sig(null, st.cpuWidth), sig(st.gpuDash, st.gpuWidth)]
  assert.strictEqual(new Set(looks).size, 3, looks.join(" "))
  assert.notDeepStrictEqual(st.maxDash, st.gpuDash)
  assert.ok(st.gpuDash[0] >= 8, "GPU dashes are long")
  assert.ok(st.cpuWidth > st.maxWidth && st.gpuWidth > st.maxWidth)
})

// ------------------------------------------------------------- series colours

// An independent reference for the checks, written from the dataviz palette
// validator's formulas (OKLab delta E x100, Machado 2009 protan/deutan at
// severity 1, WCAG contrast): the assertions do not trust Model's own maths.
const ref = (() => {
  const lin = c => [c.r, c.g, c.b].map(v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  const lab = ([r, g, b]) => {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]
  }
  const sims = {
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]]
  }
  const clamp = v => Math.max(0, Math.min(1, v))
  const sim = (c, M) => { const v = lin(c); return M.map(row => clamp(row[0] * v[0] + row[1] * v[1] + row[2] * v[2])) }
  const dist = (p, q) => 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
  const lum = c => { const v = lin(c); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] }
  return {
    hex: h => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 }),
    toHex: c => "#" + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join(""),
    normal: (a, b) => dist(lab(lin(a)), lab(lin(b))),
    cvd: (a, b) => Math.min(dist(lab(sim(a, sims.protan)), lab(sim(b, sims.protan))),
      dist(lab(sim(a, sims.deutan)), lab(sim(b, sims.deutan)))),
    contrast: (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) },
    lch: c => { const [L, a, b] = lab(lin(c)); return { L, C: Math.hypot(a, b), h: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 } },
    hueGap: (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d },
    lum
  }
})()

// Theme colours as the shell reads them (Commons/Color.qml loadColors:
// accent, else color4; urgent = color1), copied from the stock themes and the
// theme current at the time of writing; the panel background is the theme's.
const THEMES = {
  "current (custom)": { accent: "#9b826b", foreground: "#f0e9ec", background: "#1e2125", urgent: "#976870" },
  "solitude (grey)": { accent: "#798186", foreground: "#cacccc", background: "#101315", urgent: "#565d60" },
  "vantablack (grey)": { accent: "#8d8d8d", foreground: "#ffffff", background: "#000000", urgent: "#a4a4a4" },
  "white (grey, light)": { accent: "#6e6e6e", foreground: "#000000", background: "#ffffff", urgent: "#2a2a2a" },
  "lupine (magenta urgent, light)": { accent: "#3264eb", foreground: "#212121", background: "#fafafa", urgent: "#c900c4" },
  "shell defaults (accent = foreground)": { accent: "#cacccc", foreground: "#cacccc", background: "#101315", urgent: "#a55555" },
  "kanagawa (accent = foreground)": { accent: "#dcd7ba", foreground: "#dcd7ba", background: "#1f1f28", urgent: "#c34043" },
  "catppuccin": { accent: "#89b4fa", foreground: "#cdd6f4", background: "#1e1e2e", urgent: "#f38ba8" },
  "nord": { accent: "#81a1c1", foreground: "#d8dee9", background: "#2e3440", urgent: "#bf616a" },
  "hackerman (accent hue = urgent hue)": { accent: "#82FB9C", foreground: "#ddf7ff", background: "#0B0C16", urgent: "#50f872" },
  "lumon (blue urgent)": { accent: "#8bc9eb", foreground: "#d6e2ee", background: "#16242d", urgent: "#4d86b0" },
  "catppuccin-latte (light)": { accent: "#1e66f5", foreground: "#4c4f69", background: "#eff1f5", urgent: "#d20f39" },
  "flexoki-light (light)": { accent: "#205EA6", foreground: "#100F0F", background: "#FFFCF0", urgent: "#D14D41" },
  "rose-pine (light)": { accent: "#56949f", foreground: "#575279", background: "#faf4ed", urgent: "#b4637a" }
}
const themeColors = t => {
  const h = {}
  for (const k of Object.keys(t)) h[k] = ref.hex(t[k])
  return model.seriesColors(h.accent, h.foreground, h.background, h.urgent)
}

test("series colours: three distinct hues in every fixture theme, for normal and CVD vision", () => {
  for (const [name, t] of Object.entries(THEMES)) {
    const s = themeColors(t)
    const triple = [["CPU", s.cpu], ["GPU", s.gpu], ["Battery", s.battery]]
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const what = name + ": " + triple[i][0] + " " + ref.toHex(triple[i][1]) + " vs " + triple[j][0] + " " + ref.toHex(triple[j][1])
        assert.ok(ref.normal(triple[i][1], triple[j][1]) >= 15, what + " normal ΔE " + ref.normal(triple[i][1], triple[j][1]).toFixed(1))
        assert.ok(ref.cvd(triple[i][1], triple[j][1]) >= 8, what + " CVD ΔE " + ref.cvd(triple[i][1], triple[j][1]).toFixed(1))
      }
    }
  }
})

test("series colours: contrast, lightness band and chroma floor, dark and light themes", () => {
  let light = 0
  for (const [name, t] of Object.entries(THEMES)) {
    const s = themeColors(t)
    const bg = ref.hex(t.background)
    // Dark when white contrasts more with the panel than black does.
    const dark = ref.contrast(bg, ref.hex("#ffffff")) >= ref.contrast(bg, ref.hex("#000000"))
    assert.strictEqual(s.dark, dark, name)
    if (!dark) light++
    const band = dark ? [0.48, 0.67] : [0.43, 0.77]
    for (const key of ["cpu", "gpu", "battery"]) {
      const c = s[key]
      const what = name + " " + key + " " + ref.toHex(c)
      for (const v of [c.r, c.g, c.b]) assert.ok(Number.isInteger(Math.round(v * 255)) && Math.abs(v * 255 - Math.round(v * 255)) < 1e-9, what + " is 8-bit")
      assert.ok(ref.contrast(c, bg) >= 3, what + " contrast " + ref.contrast(c, bg).toFixed(2))
      const lch = ref.lch(c)
      assert.ok(lch.L >= band[0] && lch.L <= band[1], what + " L " + lch.L.toFixed(3))
      assert.ok(lch.C >= 0.10, what + " C " + lch.C.toFixed(3))
    }
  }
  assert.ok(light >= 3, "the fixtures cover light themes")
})

test("series colours: kept off urgent's hue, CPU on the accent's", () => {
  // Pinned here, not read back: the threshold line's hue keeps 35° clear.
  const gap = 35
  assert.strictEqual(model.SERIES_COLOR.urgentGap, gap)
  for (const [name, t] of Object.entries(THEMES)) {
    const s = themeColors(t)
    const u = ref.lch(ref.hex(t.urgent))
    const a = ref.lch(ref.hex(t.accent))
    // 8-bit rounding moves a hue by a degree or two; the gap is on the
    // unrounded colour.
    if (u.C >= model.SERIES_COLOR.greyChroma) {
      for (const key of ["cpu", "gpu", "battery"])
        assert.ok(ref.hueGap(ref.lch(s[key]).h, u.h) >= gap - 2, name + " " + key + " hue " + ref.lch(s[key]).h.toFixed(0) + " vs urgent " + u.h.toFixed(0))
    }
    const anchored = a.C >= model.SERIES_COLOR.greyChroma && (u.C < model.SERIES_COLOR.greyChroma || ref.hueGap(a.h, u.h) >= gap)
    if (anchored) assert.ok(ref.hueGap(ref.lch(s.cpu).h, a.h) <= 3, name + " CPU hue " + ref.lch(s.cpu).h.toFixed(0) + " vs accent " + a.h.toFixed(0))
  }
  // An accent on urgent's hue is moved just past the gap, not dropped.
  const hk = THEMES["hackerman (accent hue = urgent hue)"]
  const cpuHue = ref.lch(themeColors(hk).cpu).h
  const off = ref.hueGap(cpuHue, ref.lch(ref.hex(hk.urgent)).h)
  assert.ok(off >= gap - 2 && off <= gap + 5, "hackerman CPU hue " + cpuHue.toFixed(0) + " is " + off.toFixed(0) + "° off urgent")
})

// The red band, pinned here and not read back: OKLCH hue 345-45 inclusive.
const inRedBand = h => h >= 345 || h <= 45

test("series colours: no series hue in the red band, whatever urgent is", () => {
  assert.deepStrictEqual(model.SERIES_COLOR.redBand, [345, 45])
  // Grey urgent (no gap to keep red out) and lupine's magenta urgent: before,
  // GPU came out #942318, #ae3b43, #9c356e and brick #932506.
  for (const name of ["white (grey, light)", "solitude (grey)", "vantablack (grey)", "lupine (magenta urgent, light)"])
    assert.ok(THEMES[name], name)
  for (const [name, t] of Object.entries(THEMES)) {
    const s = themeColors(t)
    for (const key of ["cpu", "gpu", "battery"]) {
      const h = ref.lch(s[key]).h
      assert.ok(!inRedBand(h), name + " " + key + " " + ref.toHex(s[key]) + " hue " + h.toFixed(1) + " is in the red band")
    }
  }
  // An accent inside the band: CPU leaves it, the other two stay out too.
  for (const accent of ["#ff0000", "#c7768e", "#b59790", "#9c356e", "#a83e06"]) {
    for (const [bg, fg] of [["#101315", "#cacccc"], ["#ffffff", "#000000"]]) {
      const s = model.seriesColors(ref.hex(accent), ref.hex(fg), ref.hex(bg), ref.hex("#808080"))
      for (const key of ["cpu", "gpu", "battery"]) {
        const h = ref.lch(s[key]).h
        assert.ok(!inRedBand(h), accent + " on " + bg + " " + key + " hue " + h.toFixed(1))
        assert.ok(ref.contrast(s[key], ref.hex(bg)) >= 3, accent + " on " + bg + " " + key)
      }
    }
  }
})

test("series colours: light or dark from the panel background alone, 3:1 even when fg equals bg", () => {
  const grey = v => ({ r: v, g: v, b: v })
  const cases = [
    // [what, accent, foreground, background, urgent, expected dark]
    ["fg == bg, white", ref.hex("#6e6e6e"), grey(1), grey(1), ref.hex("#2a2a2a"), false],
    ["fg == bg, black", ref.hex("#8d8d8d"), grey(0), grey(0), ref.hex("#a4a4a4"), true],
    ["fg == bg == accent == urgent, mid grey", grey(0.5), grey(0.5), grey(0.5), grey(0.5), false],
    ["white text on a 0.95 grey panel", ref.hex("#89b4fa"), grey(1), grey(0.95), ref.hex("#f38ba8"), false],
    ["black text on a 0.1 grey panel", ref.hex("#1e66f5"), grey(0), grey(0.1), ref.hex("#d20f39"), true],
    // Either side of the crossover (luminance ~0.18, sRGB grey ~0.46)
    ["panel just darker than the crossover", grey(0.46), grey(1), grey(0.46), ref.hex("#ff0000"), true],
    ["panel just lighter than the crossover", grey(0.47), grey(0), grey(0.47), ref.hex("#ff0000"), false]
  ]
  for (const [what, accent, fg, bg, urgent, dark] of cases) {
    const s = model.seriesColors(accent, fg, bg, urgent)
    assert.strictEqual(s.dark, dark, what)
    for (const key of ["cpu", "gpu", "battery"])
      assert.ok(ref.contrast(s[key], bg) >= 3, what + ": " + key + " " + ref.toHex(s[key]) + " " + ref.contrast(s[key], bg).toFixed(2) + ":1")
    // The foreground plays no part in the decision.
    assert.deepStrictEqual(model.seriesColors(accent, grey(1), bg, urgent).dark, dark, what)
    assert.deepStrictEqual(model.seriesColors(accent, grey(0), bg, urgent).dark, dark, what)
  }
})

test("series colours: a fully transparent input counts as missing, other alpha is ignored", () => {
  const t = THEMES["catppuccin"]
  const h = {}
  for (const k of Object.keys(t)) h[k] = ref.hex(t[k])
  const clear = c => Object.assign({}, c, { a: 0 })
  const half = c => Object.assign({}, c, { a: 0.5 })
  const base = model.seriesColors(h.accent, h.foreground, h.background, h.urgent)
  // Translucent: taken as opaque.
  assert.deepStrictEqual(model.seriesColors(half(h.accent), half(h.foreground), half(h.background), half(h.urgent)), base)
  // Transparent: as if not given (accent falls back to the foreground, the
  // background to black, urgent to its stand-in).
  assert.deepStrictEqual(model.seriesColors(clear(h.accent), h.foreground, h.background, h.urgent),
    model.seriesColors(undefined, h.foreground, h.background, h.urgent))
  assert.deepStrictEqual(model.seriesColors(h.accent, h.foreground, clear(h.background), h.urgent),
    model.seriesColors(h.accent, h.foreground, undefined, h.urgent))
  assert.deepStrictEqual(model.seriesColors(h.accent, h.foreground, h.background, clear(h.urgent)),
    model.seriesColors(h.accent, h.foreground, h.background, undefined))
  const c = model.chartColors(h.accent, clear(h.foreground), h.background, clear(h.urgent))
  assert.deepStrictEqual([c.average.r, c.average.g, c.average.b], [1, 1, 1], "a dark panel's stand-in ink is white")
  assert.ok(c.threshold.r > 0 && c.threshold.a === 1, "urgent's stand-in is opaque")
  const light = model.chartColors(h.accent, clear(h.foreground), ref.hex("#fafafa"), h.urgent)
  assert.deepStrictEqual([light.average.r, light.average.g, light.average.b], [0, 0, 0], "a light panel's is black")
})

test("series colours: deterministic, and junk input still yields three valid colours", () => {
  const t = THEMES["current (custom)"]
  assert.deepStrictEqual(themeColors(t), themeColors(t))
  const black = { r: 0, g: 0, b: 0 }
  const cases = [[undefined, undefined, undefined, undefined], [null, {}, "x", 3],
    [{ r: NaN, g: 0, b: 0 }, { r: 2, g: -1, b: Infinity }, black, black],
    [black, black, black, black], [ref.hex("#808080"), ref.hex("#ffffff"), ref.hex("#808080"), ref.hex("#ff0000")]]
  for (const args of cases) {
    const s = model.seriesColors.apply(null, args)
    for (const key of ["cpu", "gpu", "battery"]) {
      for (const v of [s[key].r, s[key].g, s[key].b])
        assert.ok(typeof v === "number" && v >= 0 && v <= 1, JSON.stringify(args) + " " + key)
    }
    assert.notDeepStrictEqual(s.cpu, s.gpu)
    assert.notDeepStrictEqual(s.gpu, s.battery)
  }
})

test("chart colours: series from seriesColors, Mixed from Battery, the rest foreground and urgent", () => {
  const t = THEMES["current (custom)"]
  const fg = ref.hex(t.foreground)
  const urg = ref.hex(t.urgent)
  const args = [ref.hex(t.accent), fg, ref.hex(t.background), urg]
  const s = model.seriesColors.apply(null, args)
  const c = model.chartColors.apply(null, args)
  const st = model.CHART_STYLE
  const rgb = x => [x.r, x.g, x.b]
  assert.deepStrictEqual(rgb(c.cpu), rgb(s.cpu))
  assert.deepStrictEqual(rgb(c.gpu), rgb(s.gpu))
  assert.deepStrictEqual(rgb(c.battery), rgb(s.battery))
  assert.deepStrictEqual(rgb(c.mixed), rgb(s.battery), "Mixed derives from Battery")
  assert.deepStrictEqual(rgb(c.batteryShade), rgb(s.battery))
  for (const key of ["average", "averageLine", "max", "ac", "acMeasured", "unknown"])
    assert.deepStrictEqual(rgb(c[key]), rgb(fg), key + " is foreground-based")
  assert.deepStrictEqual(rgb(c.threshold), rgb(urg))
  assert.strictEqual(c.cpu.a, 1)
  assert.strictEqual(c.gpu.a, 1, "GPU is opaque: its contrast is the guaranteed one")
  assert.strictEqual(c.mixed.a, st.mixedAlpha)
  assert.strictEqual(c.battery.a, st.batteryAlpha)
  assert.ok(c.mixed.a < c.battery.a, "Mixed is the Battery colour at a lower alpha")
  assert.strictEqual(c.ac.a, st.acAlpha)
  assert.strictEqual(c.acMeasured.a, st.acMeasuredAlpha)
})

test("layout of an empty range says so", () => {
  const m = model.chartModel([], "7d", 1761300000, 2, 150)
  const lay = model.chartLayout(m, 600, 200)
  assert.strictEqual(lay.empty, true)
  assert.deepStrictEqual(lay.area, [])
  assert.strictEqual(model.chartLayout(null, 600, 200).empty, true)
})

test("dashes alternate along a polyline and carry across vertices", () => {
  const segs = model.dashSegments([[0, 0], [10, 0], [10, 10]], 4, 3)
  // 0-4 on, 4-7 off, 7-10 + 0-1 down on (carried), 1-4 off, 4-8 on, 8-10 off
  assert.deepStrictEqual(segs.map(s => s.map(v => Math.round(v * 100) / 100)), [
    [0, 0, 4, 0], [7, 0, 10, 0], [10, 0, 10, 1], [10, 4, 10, 8]])
  assert.deepStrictEqual(model.dashSegments([[0, 0]], 4, 3), [])
  assert.deepStrictEqual(model.dashSegments(null, 4, 3), [])
  assert.strictEqual(model.dashSegments([[0, 0], [10000, 0]], 2, 2, 7).length, 7, "budget honoured")
  assert.strictEqual(model.dashSegments([[0, 0], [1e7, 0]], 1, 1).length, model.MAX_DASH_SEGMENTS)
})

test("ranges map to tiers and files; state dir honours the env override", () => {
  assert.deepStrictEqual(model.RANGES.map(r => [r.key, r.tier, r.file]), [
    ["1h", "raw", "history-raw.jsonl"], ["24h", "1m", "history-1m.jsonl"], ["7d", "15m", "history-15m.jsonl"]])
  assert.strictEqual(model.rangeFor("bogus").key, "1h")
  // History reload interval per range: the raw tier is followed every 5 s,
  // the minute and 15-minute tiers once a minute.
  assert.deepStrictEqual(model.RANGES.map(r => [r.key, r.refreshMs]), [["1h", 5000], ["24h", 60000], ["7d", 60000]])
  assert.strictEqual(model.rangeFor("24h").refreshMs, 60000)
  assert.strictEqual(model.rangeFor("bogus").refreshMs, 5000)
  assert.strictEqual(model.stepFor("1h", 2.5), 2.5)
  assert.strictEqual(model.stepFor("1h", null), 2)
  assert.strictEqual(model.stepFor("7d", 2), 900)
  assert.strictEqual(model.historyPath("/s", "24h"), "/s/history-1m.jsonl")
})

test("state dir: same precedence as bin/power-watch state_dir()", () => {
  // POWER_WATCH_STATE_DIR > XDG_STATE_HOME/power-watch > ~/.local/state/power-watch
  assert.strictEqual(model.stateDir("", "", "/home/u"), "/home/u/.local/state/power-watch")
  assert.strictEqual(model.stateDir(undefined, undefined, "/home/u"), "/home/u/.local/state/power-watch")
  assert.strictEqual(model.stateDir(null, "/x", "/home/u"), "/x/power-watch")
  assert.strictEqual(model.stateDir("", "/x/", "/home/u"), "/x/power-watch")
  assert.strictEqual(model.stateDir("", "/", "/home/u"), "/power-watch")
  assert.strictEqual(model.stateDir("/tmp/pw/", "/x", "/home/u"), "/tmp/pw")
  assert.strictEqual(model.stateDir("/", "/x", "/home/u"), "/")
  assert.strictEqual(model.stateDir("/a/b.c/..d/.e", "/x", "/home/u"), "/a/b.c/..d/.e", "dots inside a name are fine")
  assert.strictEqual(model.stateDirProblem("/tmp/pw/", "/x", "/home/u"), "")
  assert.strictEqual(model.stateDirProblem("", "", "/home/u"), "")
})

test("state dir: a relative path or a . / .. segment is refused, from every source, with a reason", () => {
  // No trimming, as in Python: a leading space makes the path relative, and
  // a relative dir is listed (file://tmp/x = /tmp/x) apart from where it is
  // opened ($CWD/tmp/x); ".." after a symlink is cleaned by the listing and
  // resolved by the kernel. Refused, never replaced by another directory.
  const cases = [
    [["rel", "/x", "/home/u"], "POWER_WATCH_STATE_DIR", "rel"],
    [[" /tmp/pw", "/x", "/home/u"], "POWER_WATCH_STATE_DIR", " /tmp/pw"],
    [["tmp/power-watch", "", "/home/u"], "POWER_WATCH_STATE_DIR", "tmp/power-watch"],
    [["/a/../b", "/x", "/home/u"], "POWER_WATCH_STATE_DIR", "/a/../b"],
    [["/a/./b", "/x", "/home/u"], "POWER_WATCH_STATE_DIR", "/a/./b"],
    [["/a/b/..", "/x", "/home/u"], "POWER_WATCH_STATE_DIR", "/a/b/.."],
    [["/a/b/./", "/x", "/home/u"], "POWER_WATCH_STATE_DIR", "/a/b/./"],
    [["", "state", "/home/u"], "XDG_STATE_HOME", "state"],
    [["", "./state", "/home/u"], "XDG_STATE_HOME", "./state"],
    [["", "/x/../y", "/home/u"], "XDG_STATE_HOME", "/x/../y"],
    [["", "", "home/u"], "HOME", "home/u"],
    [["", "", "/home/u/.."], "HOME", "/home/u/.."]
  ]
  for (const [args, name, value] of cases) {
    assert.strictEqual(model.stateDir(...args), "", JSON.stringify(args))
    const problem = model.stateDirProblem(...args)
    assert.strictEqual(problem, name + ' is\n"' + value + '",\nnot an absolute path without "." or ".." parts; not read.',
      "the value is shown as given, spaces kept")
  }
  // HOME unset (and no override): no guess at "/.local/state".
  assert.strictEqual(model.stateDir("", "", ""), "")
  assert.strictEqual(model.stateDir(undefined, undefined, undefined), "")
  assert.strictEqual(model.stateDirProblem("", "", ""), "HOME is not set, so the state directory is unknown; not read.")
  // The shown value is stripped of markup and control characters and capped,
  // keeping its start and its end (where a ".." usually is).
  const hostile = model.stateDirProblem("<b>x</b>\u202e\n" + "y".repeat(5000) + "/../z", "", "")
  const shownOf = problem => problem.split("\n")[1]
  assert.ok(!/[<>\u202e]/.test(hostile) && hostile.split("\n").length === 3, hostile)
  assert.ok(shownOf(hostile).startsWith('"bx/by') && hostile.includes("y\u2026y") && shownOf(hostile).endsWith('/../z",'), hostile)
  const most = model.STATE_DIR_SHOWN_CHARS * 2 + 1
  const exact = "/" + "a".repeat(most - 4) + "/.."
  assert.strictEqual(shownOf(model.stateDirProblem(exact, "", "")), '"' + exact + '",', most + " characters are shown whole")
  const longer = "/" + "a".repeat(most - 3) + "/.."
  const over = shownOf(model.stateDirProblem(longer, "", ""))
  assert.strictEqual(over.length, most + 3, "one more is cut to the same length: " + over)
  assert.ok(over.includes("\u2026"), over)
  // The cut never splits a surrogate pair, at either end or at the 4096 pre-cut.
  const pair = "\ud83d\ude00"
  const lone = s => /[\ud800-\udbff](?![\udc00-\udfff])|(^|[^\ud800-\udbff])[\udc00-\udfff]/.test(s)
  for (const offset of [0, 1]) {
    const head = "/" + "a".repeat(model.STATE_DIR_SHOWN_CHARS - 2 + offset) + pair + "b".repeat(80)
    const tail = "a/" + "b".repeat(80) + pair + "c".repeat(model.STATE_DIR_SHOWN_CHARS - 1 - offset)
    const both = "/" + "a".repeat(2046 + offset) + pair + "b".repeat(5000) + pair + "c".repeat(2047 - offset) + "/.."
    for (const value of [head, tail, both]) {
      const shown = shownOf(model.stateDirProblem(value, "", ""))
      assert.ok(!lone(shown), "a lone surrogate in: " + JSON.stringify(shown))
    }
  }
  assert.strictEqual(model.headChars("ab" + pair, 3), "ab")
  assert.strictEqual(model.headChars("ab" + pair, 4), "ab" + pair)
  assert.strictEqual(model.tailChars(pair + "ab", 3), "ab")
  assert.strictEqual(model.tailChars(pair + "ab", 4), pair + "ab")
  assert.strictEqual(model.headChars("abc", 5), "abc")
  // The bar tooltip never wraps: every line of every refusal, from the
  // longest value, fits a sane width; the status line gets one paragraph.
  const refusals = [model.stateDirProblem("", "", ""), hostile, model.stateDirProblem(longer, "", ""),
    model.stateDirProblem("", "x".repeat(400), "/home/u"), model.stateDirProblem("", "", "h".repeat(400))]
  for (const problem of refusals) {
    for (const line of model.tooltipText(null, true, "missing", problem).split("\n"))
      assert.ok(line.length <= 80, "a tooltip line over 80 characters: " + line)
    assert.ok(!model.staleMessage(null, "missing", problem).includes("\n"), "one paragraph in the status line")
    // Ends like the other refusals to read ("...; not read.").
    assert.ok(/; not read\.$/.test(problem), problem)
  }
  // The chart draws its empty text as one unwrapped canvas line: a short
  // label, no longer than its other empty texts, not the reason itself.
  assert.ok(model.STATE_DIR_CHART_TEXT.length <= 32 && model.STATE_DIR_CHART_TEXT.length > 0, model.STATE_DIR_CHART_TEXT)
  // Said in place of "service not running", and apart from it.
  const problem = model.stateDirProblem("rel", "", "")
  assert.strictEqual(model.staleMessage(null, "missing", problem), problem.replace(/\n/g, " "))
  assert.notStrictEqual(model.staleMessage(null, "missing", problem), model.staleMessage(null, "missing"))
  assert.strictEqual(model.tooltipText(null, true, "missing", problem), problem, "no 'start the service' hint")
  assert.strictEqual(model.staleMessage(null, "missing", ""), model.staleMessage(null, "missing"))
  assert.strictEqual(model.tooltipText(null, true, "missing", ""), model.tooltipText(null, true, "missing"))
  // The widget shows it in the hero, the tooltip and the chart, and hides
  // the service hint: never an eternal "Loading history".
  const bar = qmlCode("BarWidget.qml")
  assert.ok(/readonly property string stateDirProblem:\s*Model\.stateDirProblem\(Quickshell\.env\("POWER_WATCH_STATE_DIR"\),\s*Quickshell\.env\("XDG_STATE_HOME"\), Quickshell\.env\("HOME"\)\)/.test(bar))
  assert.ok(/readonly property string stateDir:\s*Model\.stateDir\(Quickshell\.env\("POWER_WATCH_STATE_DIR"\),\s*Quickshell\.env\("XDG_STATE_HOME"\), Quickshell\.env\("HOME"\)\)/.test(bar))
  assert.ok(/Model\.staleMessage\(root\.current, root\.currentError, root\.stateDirProblem\)/.test(bar))
  assert.ok(/Model\.tooltipText\(root\.current, root\.stale, root\.currentError, root\.stateDirProblem\)/.test(bar))
  assert.ok(/emptyText:\s*root\.stateDirProblem !== "" \? Model\.STATE_DIR_CHART_TEXT\s*:/.test(bar))
  assert.ok(/visible:\s*root\.stale && root\.stateDirProblem === ""\s*width:[^\n]*\s*wrapMode:[^\n]*\s*text:\s*Model\.SERVICE_HINT/.test(bar))
  // An empty dir is never listed: the gate does nothing at all with it.
  assert.ok(/function relist\(\) \{\s*if \(gate\.dir === "" \|\| gate\.name === ""\) return/.test(qmlCode("GatedFile.qml")))
})

const skipped = (name, why) => {
  console.log("skip " + name + " (" + why + ")")
  return SKIP
}

function powerWatchBin() {
  const isFile = p => { try { return fs.statSync(p).isFile() } catch (e) { return false } }
  const given = process.env.POWER_WATCH_BIN
  if (given) return given
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (dir && isFile(path.join(dir, "power-watch"))) return path.join(dir, "power-watch")
  }
  return null
}

test("state dir matches bin/power-watch for the same environment", () => {
  // The service's own state_dir() is the reference: POWER_WATCH_BIN, else
  // `power-watch` on PATH. Without either there is nothing to compare with.
  const { execFileSync } = require("child_process")
  const bin = powerWatchBin()
  // An explicit POWER_WATCH_BIN that is not a file is a mistake to report, not
  // a reason to skip: skipping would pass the suite on a typo.
  const isFile = p => { try { return fs.statSync(p).isFile() } catch (e) { return false } }
  if (process.env.POWER_WATCH_BIN && !isFile(process.env.POWER_WATCH_BIN)) {
    assert.fail("POWER_WATCH_BIN is set to " + JSON.stringify(process.env.POWER_WATCH_BIN) +
      ", which is not an existing file; unset it to use power-watch from PATH, or fix the path")
  }
  if (!bin) return skipped("state dir matches bin/power-watch for the same environment", "power-watch not found on PATH and POWER_WATCH_BIN is not set")
  let python = null
  for (const name of ["python3", "python"]) {
    try { execFileSync(name, ["-c", "pass"]); python = name; break } catch (e) { /* next */ }
  }
  if (!python) return skipped("state dir matches bin/power-watch for the same environment", "python not found")
  // Load the script as a module (it has no .py suffix) and print state_dir().
  const probe = [
    "import importlib.machinery, importlib.util, sys",
    "loader = importlib.machinery.SourceFileLoader('pw', sys.argv[1])",
    "spec = importlib.util.spec_from_loader('pw', loader)",
    "mod = importlib.util.module_from_spec(spec)",
    "loader.exec_module(mod)",
    "print(mod.state_dir())"
  ].join("\n")
  const cases = [
    { POWER_WATCH_STATE_DIR: "/tmp/pw/", XDG_STATE_HOME: "/x" },
    { POWER_WATCH_STATE_DIR: "", XDG_STATE_HOME: "/x/y/" },
    { POWER_WATCH_STATE_DIR: "", XDG_STATE_HOME: "" }
  ]
  for (const env of cases) {
    const full = Object.assign({}, process.env, env, { HOME: "/home/u" })
    const py = execFileSync(python, ["-c", probe, bin], { env: full, encoding: "utf8" }).trim()
    assert.strictEqual(model.stateDir(env.POWER_WATCH_STATE_DIR, env.XDG_STATE_HOME, "/home/u"), py, JSON.stringify(env))
  }
})

test("file URLs percent-encode each path segment", () => {
  assert.strictEqual(model.fileUrl("/home/u/.local/state/power-watch"), "file:///home/u/.local/state/power-watch")
  assert.strictEqual(model.fileUrl("/tmp/a b#c%d?e"), "file:///tmp/a%20b%23c%25d%3Fe")
})

// ---------------------------------------------------------------- QML source

// qmllint cannot see these; a renamed helper only fails on the click that calls it.
const qmlFiles = fs.readdirSync(pluginDir).filter(f => f.endsWith(".qml"))
// Source with // comments removed: the header comments name things on purpose.
const qmlCode = file => fs.readFileSync(path.join(pluginDir, file), "utf8").replace(/\/\/.*$/gm, "")

test("every Model.<name> the QML calls exists in Model.js", () => {
  for (const file of qmlFiles) {
    const qml = qmlCode(file).replace(/^import\s+.*$/gm, "")
    for (const m of qml.matchAll(/\bModel\.([A-Za-z_]\w*)/g)) {
      assert.ok(NAMES.includes(m[1]), file + " uses Model." + m[1] + ", not in Model.js (or not lifted by this test)")
    }
  }
})

test("every Text declares textFormat: Text.PlainText", () => {
  for (const file of qmlFiles) {
    const qml = qmlCode(file)
    const texts = (qml.match(/(^|[\s:])Text\s*\{/gm) || []).length
    const plain = (qml.match(/textFormat:\s*Text\.PlainText/g) || []).length
    assert.strictEqual(plain, texts, file + ": " + texts + " Text items, " + plain + " PlainText declarations")
  }
})

test("theme colours are read as Commons.Color, never a bare Color", () => {
  // Under the shell's engine a bare `Color` resolves to another object whose
  // .foreground is undefined (measured in a scratch qs); qs.Commons' singleton
  // has to be reached through the qualified import.
  for (const file of qmlFiles) {
    const qml = qmlCode(file)
    assert.ok(!/(^|[^.\w])Color\.\w/m.test(qml), file + " reads a bare Color.<role>")
    if (/Commons\.Color/.test(qml)) assert.ok(/^import qs\.Commons as Commons$/m.test(qml), file + " lacks the Commons import")
  }
})

test("no Process anywhere, and the only repeating timer is the staleness check", () => {
  for (const file of qmlFiles) {
    const qml = qmlCode(file)
    assert.ok(!/\bProcess\s*\{/.test(qml), file + " declares a Process")
    assert.ok(!/execDetached|bar\.run\(/.test(qml), file + " spawns a command")
    const repeats = (qml.match(/repeat:\s*true/g) || []).length
    if (file === "BarWidget.qml") {
      assert.strictEqual(repeats, 1, "BarWidget.qml should have exactly one repeating Timer")
      assert.ok(/interval:\s*Model\.STALE_CHECK_MS/.test(qml), "the repeating Timer runs at STALE_CHECK_MS")
    } else {
      assert.strictEqual(repeats, 0, file + " has a repeating Timer")
    }
  }
})

// Every .qml and .js under the plugin folder (the shell loads the root ones;
// tests/ is shipped too), except this file, whose patterns and fixtures name
// what is banned.
function codeFiles(dir) {
  const out = []
  for (const name of fs.readdirSync(dir)) {
    if (name === ".git" || name === "node_modules") continue
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) out.push(...codeFiles(full))
    else if (/\.(qml|js)$/.test(name) && full !== __filename) out.push(full)
  }
  return out
}

// The text with its comments blanked, newlines kept (so lines still line up
// with the source). A "//" or "/*" inside a string, template or regex literal
// is not a comment; a string or regex still open at a newline ends there
// (neither spans lines in JS or QML), so an odd quote cannot hide the rest of
// a file. A "/" is a regex only after an operator or opening bracket.
function withoutComments(text) {
  let out = ""
  let prev = ""
  for (let i = 0; i < text.length;) {
    const c = text[i]
    const d = text[i + 1]
    if (c === "/" && d === "/") {
      while (i < text.length && text[i] !== "\n") i++
      continue
    }
    if (c === "/" && d === "*") {
      const close = text.indexOf("*/", i + 2)
      const stop = close < 0 ? text.length : close + 2
      out += text.slice(i, stop).replace(/[^\n]/g, "")
      i = stop
      continue
    }
    if (c === '"' || c === "'" || c === "`" || (c === "/" && (prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(prev)))) {
      let j = i + 1
      let inClass = false
      while (j < text.length) {
        const e = text[j]
        if (e === "\\") { j += 2; continue }
        if (e === "\n" && c !== "`") break
        j++
        if (c !== "/") { if (e === c) break; continue }
        if (e === "[") inClass = true
        else if (e === "]") inClass = false
        else if (e === "/" && !inClass) break
      }
      out += text.slice(i, j)
      prev = "a"
      i = j
      continue
    }
    out += c
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out
}

const NETWORK_BANS = [
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\b(WebSocket|WebSocketServer|Socket|SocketServer|TcpSocket|UdpSocket|LocalSocket)\b/, "a socket"],
  [/\bopenUrlExternally\b/, "Qt.openUrlExternally"],
  [/\bfetch\s*\(/, "fetch()"],
  [/\bNetworkInformation\b|\bNetworkAccessManager\b/, "a network type"],
  [/^\s*import\s+(QtWebSockets|QtNetwork|QtWebEngine|QtWebView|QtWebChannel|Quickshell\.Networking)\b/m, "a network module"],
  [/\b(https?|wss?|ftps?):\/\//i, "a remote URL"],
  [/\brequire\s*\(\s*["'](https?|net|dgram|tls|http2)["']\s*\)/, "a node network module"]
]

// Every banned use in a source text, as "line N: what (match)". Two checks,
// so a mistake in the comment stripper alone lets nothing through: the code
// without comments must have no hit, and a hit in the raw text is allowed
// only on a line that is a comment and nothing else — it starts with "//",
// "/*" or "*" and the stripper left it blank. A banned word in a trailing
// comment after code counts as a hit.
function networkHits(text) {
  const hits = []
  const code = withoutComments(text)
  for (const [re, what] of NETWORK_BANS) {
    const hit = code.match(re)
    if (hit) hits.push("code: " + what + " (" + hit[0] + ")")
  }
  const raw = text.split("\n")
  const stripped = code.split("\n")
  raw.forEach((line, n) => {
    const comment = /^\s*(\/\/|\/\*|\*)/.test(line) && (stripped[n] || "").trim() === ""
    if (comment) return
    for (const [re, what] of NETWORK_BANS) {
      const hit = line.match(re)
      if (hit) hits.push("line " + (n + 1) + ": " + what + " (" + hit[0] + ")")
    }
  })
  return hits
}

test("no network: no network API, module or remote URL in any .qml or .js", () => {
  const files = codeFiles(pluginDir)
  const rel = files.map(f => path.relative(pluginDir, f)).sort()
  for (const f of qmlFiles.concat(["Model.js", "tests/manifest-test.js", "tests/qmllint-check.js"]))
    assert.ok(rel.includes(f), "scanned: " + f + " (got " + rel.join(", ") + ")")
  for (const file of files) {
    const hits = networkHits(fs.readFileSync(file, "utf8"))
    assert.deepStrictEqual(hits, [], path.relative(pluginDir, file) + " uses the network: " + hits.join("; "))
  }
  // The stripper keeps what a comment-only strip would lose.
  assert.ok(/https:\/\/x/.test(withoutComments('var u = "https://x" // c')))
  assert.ok(!/secret/.test(withoutComments("a() // https://secret\n/* http://secret */ b()")))
  assert.ok(/x\(\)/.test(withoutComments('var s = "//"; x()')), "a // inside a string is not a comment")
  assert.ok(/x\(\)/.test(withoutComments("var r = /\\/\\//; x()")), "nor one inside a regex")
  assert.ok(/x\(\)/.test(withoutComments('var a = "/*"\nx()\nvar b = "*/"')), "a /* inside a string opens nothing")
  assert.ok(/x\(\)/.test(withoutComments('var q = "unclosed\nx()')), "a string ends at its line")
  assert.strictEqual(withoutComments("a\n/* b\nc */\nd").split("\n").length, 4, "lines are kept")
  // Comment lines may name banned things (the headers do); nothing else may.
  for (const ok of ["// see https://example.org", "/* a WebSocket */", "/*\n * https://example.org\n */",
    "  // XMLHttpRequest is not used", 'var u = "file:///tmp/x"'])
    assert.deepStrictEqual(networkHits(ok), [], ok)
  // Each pattern bites, and neither the old stripper's two bypasses (a "//"
  // inside a string before the call; lines between a "/*" and a "*/" that
  // are both inside strings) nor a trailing comment hides a use.
  for (const bad of ['var r = new XMLHttpRequest()', 'Socket { path: "/run/x" }', 'Qt.openUrlExternally(u)',
    'import QtWebSockets', 'import Quickshell.Networking', 'Image { source: "https://example.org/p.png" }',
    'WebSocket { url: "ws://h" }', 'fetch\n(u)', 'var n = require("net")',
    'var s = "//"; new XMLHttpRequest()',
    'var a = "/*"\nvar r = new XMLHttpRequest()\nvar b = "*/"',
    'var a = "/*"\n * new XMLHttpRequest()\nvar b = "*/"',
    "var r = /\\/\\//; new XMLHttpRequest()",
    "x() // https://example.org", "/* x */ new XMLHttpRequest()"])
    assert.ok(networkHits(bad).length > 0, "not caught: " + JSON.stringify(bad))
})

test("history is only watched and read while the panel is open", () => {
  const qml = qmlCode("BarWidget.qml")
  assert.ok(/id:\s*historyLoader[\s\S]{0,200}active:\s*root\.opened/.test(qml),
    "the history reader lives in a Loader gated on root.opened")
  assert.ok(/minIntervalMs:\s*Model\.rangeFor\(root\.range\)\.refreshMs/.test(qml), "history reads are throttled per range")
  // A range switch changes the file name, and a new name restarts the gate,
  // which stops the throttle first: the new range is read at once, never
  // after the old range's (longer) window. Opening the panel creates the gate.
  const gate = qmlCode("GatedFile.qml")
  assert.ok(/onNameChanged:\s*if \(gate\.ready\) Qt\.callLater\(gate\.restart\)/.test(gate))
  assert.ok(/function restart\(\) \{\s*throttle\.stop\(\)/.test(gate), "restart() stops the read window first")
  assert.ok(/interval:\s*Math\.max\(1, gate\.minIntervalMs\)/.test(gate), "the window follows minIntervalMs")
  assert.strictEqual(new Set(model.RANGES.map(r => r.file)).size, model.RANGES.length, "each range has its own file")
  const loader = qml.slice(qml.indexOf("id: historyLoader"))
  assert.ok(/GatedFile\s*\{[\s\S]*?maxBytes:\s*Model\.HISTORY_MAX_BYTES/.test(loader), "history goes through the read gate")
})

test("a range switched back to reuses its parse only for the same file version, within refreshMs", () => {
  const history = { points: [], skipped: 0, truncated: false, error: "", at: 1000 }
  const entry = { version: "600:5", history }
  assert.strictEqual(model.historyCacheHit(entry, "600:5", 1000, 5000), true)
  assert.strictEqual(model.historyCacheHit(entry, "600:5", 1004.999, 5000), true)
  assert.strictEqual(model.historyCacheHit(entry, "600:5", 1005, 5000), false, "as old as the throttle window: read anew")
  assert.strictEqual(model.historyCacheHit(entry, "600:5", 999, 5000), false, "a clock that went back")
  assert.strictEqual(model.historyCacheHit(entry, "601:5", 1001, 5000), false, "another size")
  assert.strictEqual(model.historyCacheHit(entry, "600:6", 1001, 5000), false, "another mtime")
  assert.strictEqual(model.historyCacheHit(entry, "", 1001, 5000), false)
  assert.strictEqual(model.historyCacheHit({ version: "", history }, "", 1001, 5000), false)
  assert.strictEqual(model.historyCacheHit(undefined, "600:5", 1001, 5000), false)
  assert.strictEqual(model.historyCacheHit({ version: "600:5" }, "600:5", 1001, 5000), false)
  assert.strictEqual(model.historyCacheHit(entry, "600:5", NaN, 5000), false)
  for (const r of model.RANGES) assert.strictEqual(model.historyCacheHit(entry, "600:5", 1000 + r.refreshMs / 1000, r.refreshMs), false, r.key)
  // The widget: keyed by range, checked before parsing with that range's
  // refreshMs and the version the gate hands over with the text; one entry
  // per range (assigned, never pushed); a failure drops it; closing drops all.
  const bar = qmlCode("BarWidget.qml")
  const apply = bar.slice(bar.indexOf("function applyHistory("), bar.indexOf("function applyHistoryFailure("))
  assert.ok(/^function applyHistory\(text, version, fileName\) \{\s*var key = Model\.historyReadRange\(fileName, root\.range\)\s*if \(key === ""\) return\s*var at = Date\.now\(\) \/ 1000\s*var cached = root\.historyCache\[key\]\s*if \(Model\.historyCacheHit\(cached, version, at, Model\.rangeFor\(key\)\.refreshMs\)\) \{\s*root\.history = cached\.history\s*return\s*\}\s*var parsed = Model\.parseHistory\(text, at\)/.test(apply), apply)
  assert.ok(/root\.historyCache\[key\] = \{ version: version, history: history \}/.test(apply))
  assert.ok(/delete root\.historyCache\[root\.range\]/.test(bar.slice(bar.indexOf("function applyHistoryFailure("), bar.indexOf("function selectRange("))))
  assert.ok(/onOpenedChanged:\s*\{\s*if \(root\.opened\) return[\s\S]*?root\.historyCache = \(\{\}\)/.test(bar))
  assert.strictEqual((bar.match(/root\.historyCache\s*=/g) || []).length, 1, "only the close resets the cache object")
  assert.ok(/onTextRead:\s*function\(content, version, fileName\) \{ root\.applyHistory\(content, version, fileName\) \}/.test(bar))
  const gate = qmlCode("GatedFile.qml")
  assert.ok(/signal textRead\(string content, string version, string fileName\)/.test(gate))
  assert.ok(/gate\.textRead\(file\.text\(\), gate\.version, Model\.baseName\(file\.path\)\)/.test(gate))
})

test("a history read is shown and cached only as the range whose tier it came from", () => {
  // A range switch renames the gate's file and restarts it a turn later, so
  // a load of the old tier can land after root.range moved: it is dropped.
  for (const r of model.RANGES) {
    assert.strictEqual(model.historyReadRange(r.file, r.key), r.key, r.key)
    for (const other of model.RANGES) if (other !== r)
      assert.strictEqual(model.historyReadRange(other.file, r.key), "", other.file + " read while on " + r.key)
  }
  assert.strictEqual(model.historyReadRange("", "1h"), "")
  assert.strictEqual(model.historyReadRange(undefined, "1h"), "")
  assert.strictEqual(model.historyReadRange("current.json", "1h"), "")
  // An unknown key is not the first range's, whose file rangeFor falls back to.
  assert.strictEqual(model.historyReadRange(model.RANGES[0].file, "2h"), "")
  assert.strictEqual(model.baseName("/s/p w/history-raw.jsonl"), "history-raw.jsonl")
  assert.strictEqual(model.baseName("file:///s/history-1m.jsonl"), "history-1m.jsonl")
  assert.strictEqual(model.baseName("history-15m.jsonl"), "history-15m.jsonl")
  assert.strictEqual(model.baseName(""), "")
  assert.strictEqual(model.baseName(null), "")
})

test("every file read goes through the size gate: FileView only in GatedFile.qml", () => {
  for (const file of qmlFiles) {
    const qml = qmlCode(file)
    const views = (qml.match(/\bFileView\s*\{/g) || []).length
    assert.strictEqual(views, file === "GatedFile.qml" ? 1 : 0, file + " declares " + views + " FileView(s)")
  }
  const gate = qmlCode("GatedFile.qml")
  // The FileView starts with no path; the only non-empty path assignment is
  // the one settle() makes after gateDecision said "read".
  assert.ok(/FileView\s*\{\s*id:\s*file\s*path:\s*""/.test(gate), "the FileView starts with an empty path")
  const sets = gate.match(/file\.path\s*=\s*[^=\n]+/g) || []
  assert.deepStrictEqual(sets.map(x => x.trim()).filter(x => !/=\s*""$/.test(x)), ["file.path = decision.path"])
  const settle = gate.slice(gate.indexOf("function settle()"), gate.indexOf("onDirChanged"))
  assert.ok(/Model\.gateDecision\([\s\S]*decision\.action === "read"[\s\S]*file\.path = decision\.path/.test(settle),
    "the path is set only after the gate said read")
  // The path read is the one the listing stat'ed: the decision's path comes
  // from entry(), which takes it from the listed entry itself; nothing builds
  // a path from dir and name.
  assert.ok(/var decision = Model\.gateDecision\(gate\.entry\(\), gate\.maxBytes, gate\.version\)/.test(settle))
  assert.ok(/if \(file\.path === decision\.path\) file\.reload\(\)\s*else file\.path = decision\.path/.test(settle))
  const entry = gate.slice(gate.indexOf("function entry()"), gate.indexOf("function fail("))
  assert.ok(/if \(listing\.get\(i, "fileName"\) !== gate\.name\) continue[\s\S]*path:\s*listing\.get\(i, "filePath"\)/.test(entry), entry)
  assert.ok(!/gate\.dir\s*\+|\+\s*gate\.name|filePath:\s*gate\./.test(gate), "no path rebuilt from dir and name")
  assert.ok(!/file\.reload\(\)[\s\S]*Model\.gateDecision/.test(settle), "no reload before the decision")
  // text() only once the gated read has completed
  assert.strictEqual((gate.match(/\.text\(\)/g) || []).length, 1)
  assert.ok(/onLoaded:\s*\{[^}]*file\.text\(\)/.test(gate))
  assert.ok(/import Qt\.labs\.folderlistmodel/.test(gate))
  // a read inside the throttle window waits (and re-lists at its end)
  assert.ok(/decision\.action === "read"\) \{\s*if \(throttle\.running\) \{\s*gate\.waiting = true\s*return/.test(settle),
    "a read due inside the window is deferred before anything is read")
  // the staleness tick re-lists, through shouldRelist, and reads nothing itself
  const bar = qmlCode("BarWidget.qml")
  const tick = bar.slice(bar.indexOf("interval: Model.STALE_CHECK_MS"), bar.indexOf("id: historyLoader"))
  assert.ok(/Model\.shouldRelist\(currentGate\.outcome\)\)\s*currentGate\.relist\(\)/.test(tick))
  assert.ok(!/reload\(|text\(\)/.test(tick))
  assert.ok(/GatedFile\s*\{\s*id:\s*currentGate[\s\S]*?maxBytes:\s*Model\.CURRENT_MAX_BYTES/.test(bar))
})

test("chart and legend share one style, and the chart's sizes are scaled", () => {
  const chart = qmlCode("Chart.qml")
  assert.ok(/Model\.CHART_STYLE/.test(chart) && /Model\.CHART_STYLE/.test(qmlCode("BarWidget.qml")))
  // Colours: derived once (BarWidget's chartColors), handed to the chart, and
  // read by every legend swatch; neither draws the accent or rebuilds a colour.
  const bar = qmlCode("BarWidget.qml")
  const calls = qmlFiles.reduce((n, f) => n + (qmlCode(f).match(/Model\.chartColors\(/g) || []).length, 0)
  assert.strictEqual(calls, 1, "chartColors is computed in one place")
  // Only while the panel is open, and from Commons.Color's values, which do
  // not animate (the bar's urgent does, for 420 ms on a theme switch).
  const binding = (bar.match(/readonly property var chartColors:[\s\S]*?: null/) || [""])[0]
  assert.ok(/^readonly property var chartColors:\s*root\.opened\s*\?\s*Model\.chartColors\(/.test(binding), binding)
  assert.ok(/Model\.chartColors\(Commons\.Color\.accent, Commons\.Color\.bar\.text, Commons\.Color\.popups\.background,\s*Commons\.Color\.bar\.active\)/.test(binding), binding)
  assert.ok(!/root\.(urgent|foreground|accent|bar)\b/.test(binding), "no bar-animated input: " + binding)
  assert.ok(/function chartColor\(key\) \{\s*var c = root\.chartColors \? root\.chartColors\[key\] : null/.test(bar),
    "the legend copes with chartColors being null while the panel is closed")
  assert.ok(/colors:\s*root\.chartColors/.test(bar), "the chart gets the shared colours")
  assert.ok(!/root\.accent|Qt\.rgba/.test(chart), "Chart.qml paints only the colours it is handed")
  const legends = bar.match(/LegendItem \{[^\n]*swatchColor:[^;\n]*/g) || []
  assert.ok(legends.length >= 9, legends.length + " legend swatches")
  for (const item of legends) assert.ok(/swatchColor:\s*root\.chartColor\("\w+"\)/.test(item), item)
  assert.ok(/ctx\.font\s*=\s*Model\.canvasFont\(/.test(chart), "the Canvas font string is built by canvasFont")
  assert.ok(/Model\.clampLabelX\(/.test(chart), "time labels are clamped by their measured width")
  // no bare numeric dash patterns or label clamps left in the paint code
  assert.ok(!/strokeDashed\([^)]*,\s*\d+\s*,\s*\d+\s*\)/.test(chart), "dash lengths come from CHART_STYLE")
  assert.ok(!/plot\.x \+ 14/.test(chart))
})

test("stale data is dimmed with opacity and the panel scrolls", () => {
  const bar = qmlCode("BarWidget.qml")
  assert.ok(!/Qt\.darker/.test(bar), "dimming is opacity, which recedes on light themes too")
  assert.ok(/text:\s*Model\.sampleTitle\(root\.current, root\.stale\)/.test(bar))
  assert.ok(/id:\s*breakdownGrid[\s\S]{0,300}opacity:\s*root\.stale \? 0\.45 : 1/.test(bar))
  assert.ok(/Flickable\s*\{\s*id:\s*panelFlick/.test(bar), "the panel content is in a Flickable")
  assert.ok(/elide:\s*Text\.ElideRight/.test(bar) && !/ElideLeft/.test(bar))
  assert.ok(/flow:\s*Grid\.TopToBottom/.test(bar))
  assert.ok(/label:\s*"Mixed"/.test(bar), "the legend has a Mixed band entry")
})

test("every band mode the model produces has a colour in the chart", () => {
  const chart = qmlCode("Chart.qml")
  assert.ok(/Model\.bandColor\(col, mode\)/.test(chart), "Chart.qml colours bands through Model.bandColor")
  const colors = model.chartColors({ r: 0.6, g: 0.5, b: 0.4 }, { r: 0.94, g: 0.91, b: 0.93 }, { r: 0.12, g: 0.13, b: 0.15 },
    { r: 0.6, g: 0.4, b: 0.44 })
  for (const mode of ["battery", "mixed", "acMeasured", "ac"]) {
    assert.ok(model.BAND_MODES.includes(mode), mode)
    assert.strictEqual(model.bandColor(colors, mode), colors[mode], mode)
    assert.notStrictEqual(colors[mode], colors.unknown, mode)
  }
  assert.strictEqual(model.bandColor(colors, "unknown"), colors.unknown)
  assert.strictEqual(model.bandColor(colors, "toString"), colors.unknown)
  const bar = qmlCode("BarWidget.qml")
  assert.ok(/visible:\s*Model\.showsMeasuredAc\(root\.chart, root\.current\);\s*label:\s*Model\.PSYS_BAND_LABEL/.test(bar))
  assert.ok(/id:\s*widest[\s\S]{0,200}text:\s*Model\.BAR_WIDEST_TEXT\s*$/m.test(bar),
    "the bar always reserves room for the lower-bound mark")
  assert.ok(/fixedHeight:\s*root\.vertical \? Model\.BAR_VERTICAL_SLOTS \* Style\.bar\.iconSlot : -1/.test(bar),
    "the vertical bar is always BAR_VERTICAL_SLOTS tall")
  assert.ok(/topPadding:\s*Math\.max\(0, Model\.BAR_VERTICAL_SLOTS - root\.barLines\.length\)/.test(bar),
    "without the mark its slot stays empty above the number")
  assert.ok(/label:\s*"CURRENT";\s*value:\s*Model\.currentStatText\(/.test(bar))
})

test("no machine-specific wording or figures in the plugin", () => {
  for (const file of fs.readdirSync(pluginDir).filter(f => /\.(qml|js|json)$/.test(f))) {
    const text = fs.readFileSync(path.join(pluginDir, file), "utf8")
    assert.ok(!/\b(190|330|19\.5)\b|GTX|1080|Raul's/.test(text.replace(/"author":[^\n]*/, "")), file)
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "manifest.json"), "utf8"))
  assert.ok(/^\d+\.\d+\.\d+$/.test(manifest.version), "semver: " + manifest.version)
  assert.ok(/Estimated or measured/.test(manifest.description), manifest.description)
})

let failed = 0
let skippedCount = 0
for (const [name, fn] of tests) {
  try {
    if (fn() === SKIP) { skippedCount++; continue }
    console.log("ok   " + name)
  } catch (e) {
    failed++
    console.log("FAIL " + name + "\n     " + String(e && e.message || e).split("\n").join("\n     "))
  }
}
const ran = tests.length - skippedCount
if (skippedCount) console.log(skippedCount + " skipped")
console.log((ran - failed) + "/" + ran + " passed")
process.exit(failed ? 1 : 0)
