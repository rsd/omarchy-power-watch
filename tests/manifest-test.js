#!/usr/bin/env node

// Checks the plugin folder as a whole: the manifest, the entry points, the
// relative imports between its files, and that nothing in it is a symlink.
// None of this needs the shell; `omarchy plugin validate` covers the
// schema, this covers what is specific to Power Watch.

const fs = require("fs")
const path = require("path")
const assert = require("assert")

const pluginDir = path.join(__dirname, "..")
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "manifest.json"), "utf8"))
const qmlFiles = fs.readdirSync(pluginDir).filter(f => f.endsWith(".qml"))
const isFile = p => { try { return fs.statSync(p).isFile() } catch (e) { return false } }

const tests = []
const test = (name, fn) => tests.push([name, fn])

test("manifest identity", () => {
  assert.strictEqual(manifest.schemaVersion, 1)
  assert.strictEqual(manifest.id, "io.github.rsd.power-watch")
  assert.strictEqual(manifest.name, "Power Watch")
  assert.strictEqual(manifest.author, "Raul Dias")
  assert.strictEqual(manifest.license, "MIT")
  assert.ok(/^\d+\.\d+\.\d+$/.test(manifest.version), manifest.version)
  assert.ok(manifest.description)
})

// `omarchy plugin add` clones to <plugins>/<id> and the shell loads a plugin by
// its folder name, so a checkout under another name does not load. `omarchy
// plugin validate` does not check this.
test("the manifest id matches the plugin directory name", () => {
  assert.strictEqual(manifest.id, path.basename(path.resolve(pluginDir)))
  assert.ok(!manifest.id.startsWith("omarchy."), "omarchy.* is reserved")
})

test("manifest declares a single bar widget on the right", () => {
  assert.deepStrictEqual(manifest.kinds, ["bar-widget"])
  assert.strictEqual(manifest.barWidget.defaultSection, "right")
  assert.strictEqual(manifest.barWidget.allowMultiple, false)
  assert.strictEqual(manifest.barWidget.displayName, "Power Watch")
})

test("entry points are safe relative paths and exist", () => {
  assert.deepStrictEqual(Object.keys(manifest.entryPoints), ["barWidget"])
  for (const rel of Object.values(manifest.entryPoints)) {
    assert.ok(!rel.startsWith("/") && !rel.includes(".."), rel)
    assert.ok(isFile(path.join(pluginDir, rel)), rel)
  }
})

test("the repository root is the plugin: manifest and licence sit there", () => {
  // `omarchy plugin add` clones to <plugins>/<id>; the repo root is the plugin.
  assert.ok(isFile(path.join(pluginDir, "manifest.json")))
  assert.ok(isFile(path.join(pluginDir, "LICENSE")))
})

test("relative QML imports resolve inside the plugin", () => {
  assert.ok(qmlFiles.length >= 3, qmlFiles.join(","))
  for (const file of qmlFiles) {
    const text = fs.readFileSync(path.join(pluginDir, file), "utf8")
    for (const m of text.matchAll(/^import\s+"([^"]+)"/gm)) {
      const target = path.resolve(pluginDir, m[1])
      assert.ok(target.startsWith(pluginDir + path.sep), file + " imports outside the plugin: " + m[1])
      assert.ok(isFile(target), file + " imports missing " + m[1])
    }
  }
})

test("the components BarWidget.qml uses by type name ship with the plugin", () => {
  const bar = fs.readFileSync(path.join(pluginDir, "BarWidget.qml"), "utf8")
  for (const component of ["Chart", "GatedFile"]) {
    assert.ok(new RegExp("^\\s*" + component + "\\s*\\{", "m").test(bar), component + " is not used")
    assert.ok(isFile(path.join(pluginDir, component + ".qml")), component + ".qml is missing")
  }
})

test("no symlinks inside the plugin", () => {
  // omarchy plugin validate refuses any symlink in a plugin folder.
  const found = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) found.push(full)
      else if (entry.isDirectory()) walk(full)
    }
  }
  walk(pluginDir)
  assert.deepStrictEqual(found, [])
})

let failed = 0
for (const [name, fn] of tests) {
  try {
    fn()
    console.log("ok   " + name)
  } catch (e) {
    failed++
    console.log("FAIL " + name + "\n     " + String(e && e.message || e).split("\n").join("\n     "))
  }
}
console.log((tests.length - failed) + "/" + tests.length + " passed")
process.exit(failed ? 1 : 0)
