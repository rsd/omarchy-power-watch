#!/bin/bash

# Everything that can be checked without the running shell or a running
# service: manifest validation, QML syntax and type checks against the shell's
# own qs.Ui / qs.Commons modules, loading the components in a throwaway
# Quickshell (skipped outside a Wayland session), the model logic, and the
# plugin folder's layout.
#
# The model test also cross-checks the state directory against the power-watch
# service when it can find it (POWER_WATCH_BIN, else `power-watch` on PATH) and
# prints a "skip" line when it cannot.

set -o pipefail

PLUGIN_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SHELL_DIR=${OMARCHY_SHELL_DIR:-/usr/share/omarchy/shell}
QMLLINT=/usr/lib/qt6/bin/qmllint
FAILURES=0

SKIPPED=0
SKIP=77   # a suite function returns this when it cannot run here

run() {
  local name=$1 status
  shift
  echo "== $name"
  "$@"
  status=$?
  if ((status == 0)); then
    echo "-- $name passed"
  elif ((status == SKIP)); then
    echo "-- $name SKIPPED (not checked)"
    SKIPPED=$((SKIPPED + 1))
  else
    echo "-- $name FAILED"
    FAILURES=$((FAILURES + 1))
  fi
  echo
}

have_qt_lint() {
  [[ -x $QMLLINT && -d $SHELL_DIR/Ui && -d $SHELL_DIR/Commons ]]
}

skip_qt_lint() {
  echo "skipped: need $QMLLINT and the shell sources in $SHELL_DIR (OMARCHY_SHELL_DIR overrides)"
}

# /usr/bin/qmllint is Qt5's syntax-only checker, which rejects perfectly good
# Qt6 QML; the shell is Qt6, so use Qt6's linter. It resolves `qs.Ui` only from
# a path laid out as <root>/qs/Ui, which the shell's tree is not, hence the
# throwaway shim of symlinks, built outside the plugin because a symlink
# anywhere inside a plugin folder is grounds for the shell to refuse it.
#
# The linter runs with --json and tests/qmllint-check.js judges the result:
# Qt 6.12's text output drops [import] and [unresolved-type] warnings from any
# file that contains a loop, the JSON does not. Fatal: a non-zero exit, any
# syntax / import / unresolved-type warning anywhere (a file the engine will not
# load is, in the shell, a widget that silently is not there), and any other
# warning in a file other than BarWidget.qml except block-scope-var-declaration.
# BarWidget.qml's remaining warnings are inherent to how the bar injects itself
# (`bar` typed QtObject, Style singletons typed QObject, inline components
# reaching `root`) and come out of the first-party widgets too.
#
# qml_lint [dir] lints the *.qml in dir (default: the plugin).
# Returns 77 (skipped, not passed) when Qt6's linter, the shell sources or node
# are not installed.
qml_lint() {
  local dir=${1:-$PLUGIN_DIR}
  if ! have_qt_lint || ! command -v node >/dev/null; then
    skip_qt_lint
    return $SKIP
  fi

  local shim json status
  shim=$(mktemp -d) || return 1
  mkdir -p "$shim/qs"
  ln -s "$SHELL_DIR/Ui" "$shim/qs/Ui"
  ln -s "$SHELL_DIR/Commons" "$shim/qs/Commons"

  local files=("$dir"/*.qml)
  json=$("$QMLLINT" --json - -I "$shim" -I /usr/lib/qt6/qml "${files[@]}" 2>"$shim/stderr")
  status=$?
  if ((status != 0)); then
    head -10 "$shim/stderr"
    echo "qmllint exit status $status"
    rm -rf "$shim"
    return 1
  fi
  rm -rf "$shim"
  node "$PLUGIN_DIR/tests/qmllint-check.js" <<<"$json"
}

# The lint check must actually be able to fail: copy the plugin, inject an
# unknown type into BarWidget.qml and then into Chart.qml (both contain loops,
# which is what hid it from the text output), and require that each is caught
# while the untouched copy passes.
qml_lint_selftest() {
  if ! have_qt_lint || ! command -v node >/dev/null; then
    skip_qt_lint
    return $SKIP
  fi

  local scratch ok=0 out
  scratch=$(mktemp -d) || return 1

  mkdir "$scratch/clean"
  cp "$PLUGIN_DIR"/*.qml "$PLUGIN_DIR"/Model.js "$scratch/clean/"
  if out=$(qml_lint "$scratch/clean"); then
    echo "ok   untouched copy passes"
  else
    echo "FAIL untouched copy should pass:"
    echo "$out"
    ok=1
  fi

  mkdir "$scratch/bar" "$scratch/chart"
  cp "$PLUGIN_DIR"/*.qml "$PLUGIN_DIR"/Model.js "$scratch/bar/"
  cp "$PLUGIN_DIR"/*.qml "$PLUGIN_DIR"/Model.js "$scratch/chart/"
  sed -i 's/^  TextMetrics {/  TextMetricsX {/' "$scratch/bar/BarWidget.qml"
  sed -i 's/^  property var chart: null$/&\n  TextMetricsX {}/' "$scratch/chart/Chart.qml"
  if cmp -s "$PLUGIN_DIR/BarWidget.qml" "$scratch/bar/BarWidget.qml" ||
    cmp -s "$PLUGIN_DIR/Chart.qml" "$scratch/chart/Chart.qml"; then
    echo "FAIL the self-test could not inject its unknown type (source changed?)"
    ok=1
  fi

  local case
  for case in bar chart; do
    if out=$(qml_lint "$scratch/$case"); then
      echo "FAIL unknown type in the $case copy was not caught"
      ok=1
    elif ! grep -q 'TextMetricsX.*\[\(import\|unresolved-type\)\]' <<<"$out"; then
      echo "FAIL the $case copy failed, but not on its unknown type:"
      echo "$out"
      ok=1
    else
      echo "ok   unknown type in the $case copy fails: $(head -1 <<<"$out")"
    fi
  done

  rm -rf "$scratch"
  return $ok
}

# qmllint passes files the engine refuses: a function named after an inherited
# signal (Canvas's `paint`) lints clean and then fails at load with "Duplicate
# method name: invalid override", which makes BarWidget's `Chart` unavailable
# and drops the widget from every bar. So load each component the way the
# shell does, by absolute file:// URL, in a throwaway Quickshell: a temporary
# config (shell.qml plus symlinks to the shell's Commons and Ui, outside the
# plugin) that creates no windows, calls Qt.createComponent on each file, logs
# READY or ERROR per file and quits. Fatal: any ERROR, any qt.qml warning, any
# file not reported, or no "done" line within LOAD_TIMEOUT_S. The instance is stopped by the PID
# this function started, never by name or pattern, so the live shell (another
# qs process) is never touched.
#
# qml_load [dir] loads BarWidget.qml, Chart.qml and GatedFile.qml from dir
# (default: the plugin). Returns 77 (skipped, not passed) without qs, a
# Wayland session (the Ui module's panels need its backend even unused) or the
# shell sources.
LOAD_FILES=(BarWidget.qml Chart.qml GatedFile.qml)
LOAD_TIMEOUT_S=20

have_qs_load() {
  command -v qs >/dev/null && [[ -n ${WAYLAND_DISPLAY:-} && -d $SHELL_DIR/Ui && -d $SHELL_DIR/Commons ]]
}

skip_qs_load() {
  echo "skipped: need qs on PATH, a Wayland session (WAYLAND_DISPLAY) and the shell sources in $SHELL_DIR"
}

qml_load() {
  local dir=${1:-$PLUGIN_DIR}
  if ! have_qs_load; then
    skip_qs_load
    return $SKIP
  fi

  local cfg pid i list="" f ok=0
  cfg=$(mktemp -d) || return 1
  ln -s "$SHELL_DIR/Commons" "$cfg/Commons"
  ln -s "$SHELL_DIR/Ui" "$cfg/Ui"
  cat >"$cfg/shell.qml" <<'EOF'
import QtQuick
import Quickshell
ShellRoot {
  Component.onCompleted: {
    var files = Quickshell.env("PW_LOAD_FILES").split("\n")
    for (var i = 0; i < files.length; i++) {
      if (files[i] === "") continue
      var url = "file://" + files[i].split("/").map(encodeURIComponent).join("/")
      var c = Qt.createComponent(url, Component.PreferSynchronous)
      var ready = c.status === Component.Ready
      console.log("PWLOAD " + (ready ? "READY " : "ERROR ") + files[i]
        + (ready ? "" : " :: " + c.errorString().replace(/\n/g, " | ")))
    }
    console.log("PWLOAD DONE")
    // Deferred: a quit emitted while the config is still loading is dropped.
    Qt.callLater(Qt.quit)
  }
}
EOF
  for f in "${LOAD_FILES[@]}"; do list+="$dir/$f"$'\n'; done

  PW_LOAD_FILES=$list qs --no-color -p "$cfg" >"$cfg/log" 2>&1 &
  pid=$!
  # Until it exits or reports; then a moment to quit on its own.
  for ((i = 0; i < LOAD_TIMEOUT_S * 10; i++)); do
    kill -0 "$pid" 2>/dev/null || break
    grep -q 'PWLOAD DONE' "$cfg/log" && break
    sleep 0.1
  done
  for ((i = 0; i < 20; i++)); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    sleep 0.5
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
  fi
  wait "$pid" 2>/dev/null

  if ! grep -q 'PWLOAD DONE' "$cfg/log"; then
    echo "FAIL qs did not report within ${LOAD_TIMEOUT_S} s; its log:"
    tail -15 "$cfg/log"
    ok=1
  fi
  # The engine reports some refusals only as a qt.qml.* warning beside the
  # component error (the invalid override itself); any is fatal here, since
  # nothing is instantiated that could warn at run time.
  if grep -q 'WARN.*qt\.qml' "$cfg/log"; then
    grep 'WARN.*qt\.qml' "$cfg/log" | sed 's/^ *WARN */FAIL engine warning: /' | cut -c1-300
    ok=1
  fi
  for f in "${LOAD_FILES[@]}"; do
    if grep -qF "PWLOAD READY $dir/$f" "$cfg/log"; then
      echo "ok   $f loads"
    elif grep -qF "PWLOAD ERROR $dir/$f" "$cfg/log"; then
      echo "FAIL $f: $(grep -F "PWLOAD ERROR $dir/$f" "$cfg/log" | sed 's/.* :: //')"
      ok=1
    else
      echo "FAIL $f was not reported"
      ok=1
    fi
  done
  rm -rf "$cfg"
  return $ok
}

# The load check must actually be able to fail: a copy whose Chart.qml helper
# is named `paint` again (the shipped bug) must fail Chart.qml on the invalid
# override and, through it, BarWidget.qml on the unavailable Chart type.
qml_load_selftest() {
  if ! have_qs_load; then
    skip_qs_load
    return $SKIP
  fi

  local scratch out status ok=0
  scratch=$(mktemp -d) || return 1
  cp "$PLUGIN_DIR"/*.qml "$PLUGIN_DIR"/Model.js "$scratch/"
  sed -i 's/\bpaintOf(/paint(/g' "$scratch/Chart.qml"
  if ! grep -q 'function paint(' "$scratch/Chart.qml"; then
    echo "FAIL the self-test could not restore the old 'function paint' name (source changed?)"
    rm -rf "$scratch"
    return 1
  fi

  out=$(qml_load "$scratch")
  status=$?
  if ((status == 0)); then
    echo "FAIL a Chart.qml declaring function paint() was not caught"
    ok=1
  elif ! grep -q 'FAIL engine warning:.*Chart\.qml.*invalid override' <<<"$out" ||
    ! grep -q 'FAIL Chart.qml:.*onPaint' <<<"$out"; then
    echo "FAIL Chart.qml did not fail on the invalid override:"
    echo "$out"
    ok=1
  elif ! grep -q 'FAIL BarWidget.qml:.*Type Chart unavailable' <<<"$out"; then
    echo "FAIL BarWidget.qml did not fail on the unavailable Chart:"
    echo "$out"
    ok=1
  else
    echo "ok   function paint() in Chart.qml fails: $(grep 'FAIL engine warning:.*invalid override' <<<"$out" | head -1 | cut -c1-200)"
    echo "ok   Chart.qml: $(grep 'FAIL Chart.qml' <<<"$out" | cut -c1-200)"
    echo "ok   and BarWidget.qml with it: $(grep 'FAIL BarWidget.qml' <<<"$out" | cut -c1-200)"
  fi
  rm -rf "$scratch"
  return $ok
}

run "manifest validation" omarchy plugin validate "$PLUGIN_DIR"
run "qmllint (qt6)" qml_lint
run "qmllint self-test (injected unknown type)" qml_lint_selftest
run "QML load (scratch qs)" qml_load
run "QML load self-test (function paint)" qml_load_selftest
run "model" node "$PLUGIN_DIR/tests/model-test.js"
run "manifest and layout" node "$PLUGIN_DIR/tests/manifest-test.js"

if ((FAILURES)); then
  echo "$FAILURES suite(s) failed"
  exit 1
fi
if ((SKIPPED)); then
  echo "all suites that could run passed; $SKIPPED skipped (not checked)"
else
  echo "all suites passed"
fi
