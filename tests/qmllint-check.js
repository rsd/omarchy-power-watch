#!/usr/bin/env node

// Reads `qmllint --json -` output on stdin and decides whether it is fatal.
//
// The JSON is used because Qt 6.12's text output drops [import] and
// [unresolved-type] warnings from any file that contains a loop, which is how
// an unknown type ships past a green suite; the JSON still reports them.
//
// Fatal: unparsable output, no files, any syntax / import / unresolved-type
// warning or any "error"-level message in any file, and any other warning in a
// file other than BarWidget.qml, except block-scope-var-declaration (`var`
// inside a block; style, not a fault). BarWidget.qml's remaining warnings are
// inherent to how the bar injects itself (see run.sh).
//
// Prints one line per fatal finding, then a summary on success.

const path = require("path")

const ALWAYS_FATAL = new Set(["syntax", "import", "unresolved-type"])
const EXEMPT_OUTSIDE_BAR = new Set(["block-scope-var-declaration"])

let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", chunk => { input += chunk })
process.stdin.on("end", () => {
  let report
  try {
    report = JSON.parse(input)
  } catch (e) {
    console.log("qmllint produced no JSON: " + input.slice(0, 300).trim())
    process.exit(1)
  }
  const files = report && Array.isArray(report.files) ? report.files : []
  if (!files.length) {
    console.log("qmllint reported no files")
    process.exit(1)
  }

  const fatal = []
  let warnings = 0
  for (const file of files) {
    const name = path.basename(String(file.filename))
    for (const w of file.warnings || []) {
      warnings++
      const first = String(w.message || "").split("\n")[0]
      const where = name + ":" + w.line + ":" + w.column + ": " + first + " [" + w.id + "]"
      if (ALWAYS_FATAL.has(w.id) || w.type === "error") fatal.push(where)
      else if (name !== "BarWidget.qml" && !EXEMPT_OUTSIDE_BAR.has(w.id)) fatal.push(where)
    }
  }

  if (fatal.length) {
    for (const line of fatal.slice(0, 10)) console.log(line)
    if (fatal.length > 10) console.log("... and " + (fatal.length - 10) + " more")
    process.exit(1)
  }
  console.log(files.length + " file(s), " + warnings + " warning(s), none fatal")
})
