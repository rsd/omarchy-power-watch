#!/bin/bash

# Everything that can be checked without a running shell or a running service:
# manifest validation, QML syntax and type checks against the shell's own
# qs.Ui / qs.Commons modules, the model logic, and the plugin folder's layout.
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

run "manifest validation" omarchy plugin validate "$PLUGIN_DIR"
run "qmllint (qt6)" qml_lint
run "qmllint self-test (injected unknown type)" qml_lint_selftest
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
