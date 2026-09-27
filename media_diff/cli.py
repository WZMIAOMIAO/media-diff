"""Command line entry point for the ``media-diff`` command."""

import argparse
import contextlib
import json
import os
import shutil
import subprocess
import sys
import threading
import webbrowser

import uvicorn

from media_diff import __version__, registry

# Uvicorn waits indefinitely for in-flight connections during a graceful
# shutdown by default. The browser keeps video-stream / keep-alive sockets open,
# so on Ctrl+C the server would print "Shutting down" and then hang forever.
# Force the shutdown after a short grace period instead.
SHUTDOWN_TIMEOUT_SECONDS = 5


@contextlib.contextmanager
def _suppress_stderr():
    """Temporarily silence child-process stderr.

    Some browser launchers print noisy errors straight to the terminal; we
    handle failures ourselves instead.
    """
    try:
        stderr_fd = sys.stderr.fileno()
    except (AttributeError, OSError, ValueError):
        yield
        return
    saved_fd = os.dup(stderr_fd)
    devnull_fd = os.open(os.devnull, os.O_WRONLY)
    try:
        os.dup2(devnull_fd, stderr_fd)
        yield
    finally:
        os.dup2(saved_fd, stderr_fd)
        os.close(saved_fd)
        os.close(devnull_fd)


def _run_opener(cmd: list[str]) -> bool:
    try:
        result = subprocess.run(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


def _save_tty() -> object | None:
    """Snapshot terminal settings so they can be restored on exit.

    Some terminals are left with echo disabled after an interrupted
    foreground process; restoring the settings we started with keeps the
    shell usable.
    """
    try:
        import termios

        if sys.stdin is not None and sys.stdin.isatty():
            return termios.tcgetattr(sys.stdin.fileno())
    except Exception:
        pass
    return None


def _restore_tty(saved: object | None) -> None:
    if saved is None:
        return
    try:
        import termios

        termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, saved)  # type: ignore[arg-type]
    except Exception:
        pass


def _try_open_linux(url: str) -> bool | None:
    """Try Linux openers, returning None when none of them is installed."""
    for name, cmd in (
        ("xdg-open", ["xdg-open", url]),
        ("gio", ["gio", "open", "--", url]),
    ):
        if shutil.which(name):
            return _run_opener(cmd)
    return None


def _open_browser(url: str) -> None:
    if _try_open(url):
        return
    print(
        f"Could not open a browser automatically; please open {url} manually."
    )


def _try_open(url: str) -> bool:
    try:
        if sys.platform.startswith("win"):  # pragma: no cover - Windows
            os.startfile(url)  # type: ignore[attr-defined]
            return True
        if sys.platform == "darwin":  # pragma: no cover - macOS
            return _run_opener(["open", url])
        result = _try_open_linux(url)
        if result is not None:
            return result
        with _suppress_stderr():
            return bool(webbrowser.open(url))
    except Exception:
        return False


def _print_status(instances: list[dict], as_json: bool) -> None:
    if as_json:
        print(json.dumps(instances, ensure_ascii=False, indent=2))
        return
    if not instances:
        print("No running media-diff server found.")
        return
    print("Running media-diff instances:")
    print(f"  {'PID':>8}  {'STATE':<12} {'VERSION':<9} {'STARTED':<20} URL")
    for item in instances:
        pid = item.get("pid")
        state = "up" if item.get("running") else "unreachable"
        version = item.get("version") or "-"
        started = item.get("started_at") or "-"
        print(
            f"  {str(pid):>8}  {state:<12} {version:<9} {started:<20} {item.get('url')}"
        )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="media-diff",
        description=(
            "Start the Media Diff local server and compare images/videos "
            "in the browser."
        ),
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Address to bind (default 127.0.0.1; use 0.0.0.0 for LAN access)",
    )
    parser.add_argument(
        "--port", type=int, default=8000, help="Port to listen on (default 8000)"
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not open the browser automatically",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Auto-reload on code changes (development)",
    )
    parser.add_argument(
        "--version", action="version", version=f"media-diff {__version__}"
    )

    subparsers = parser.add_subparsers(dest="command")
    status = subparsers.add_parser(
        "status", help="List running media-diff servers"
    )
    status.add_argument(
        "--json", action="store_true", help="Output as JSON for scripting"
    )

    stop = subparsers.add_parser("stop", help="Stop running media-diff servers")
    stop.add_argument(
        "--port", type=int, help="Stop the instance listening on this port"
    )
    stop.add_argument("--pid", type=int, help="Stop the instance with this PID")
    stop.add_argument(
        "--all", action="store_true", help="Stop all running instances"
    )
    stop.add_argument(
        "--force",
        action="store_true",
        help="Kill even if the process does not answer as media-diff",
    )
    return parser


def _select_targets(
    instances: list[dict], args: argparse.Namespace
) -> list[dict] | None:
    """Pick which instances ``stop`` should act on.

    Returns ``None`` when the selection is ambiguous (several instances and no
    ``--port`` / ``--pid`` / ``--all``).
    """
    if args.all:
        return instances
    if args.pid is not None:
        return [item for item in instances if item.get("pid") == args.pid]
    if args.port is not None:
        return [item for item in instances if item.get("port") == args.port]
    if len(instances) == 1:
        return instances
    return None


def _cmd_stop(args: argparse.Namespace) -> int:
    instances = registry.status_instances()
    if not instances:
        print("No running media-diff server found.")
        return 1

    targets = _select_targets(instances, args)
    if targets is None:
        print(
            "Multiple instances are running; "
            "specify --port, --pid, or --all:"
        )
        _print_status(instances, False)
        return 1
    if not targets:
        print("No matching media-diff server found.")
        return 1

    ok = True
    for item in targets:
        url = item.get("url")
        pid = item.get("pid")
        result = registry.stop_instance(item, force=args.force)
        if result == "stopped":
            print(f"Stopped media-diff at {url} (PID {pid}).")
        elif result == "not_running":
            print(f"media-diff at {url} (PID {pid}) is no longer running.")
        elif result == "unverified":
            print(
                f"Skipped PID {pid}: it does not answer as media-diff "
                "(use --force to kill anyway)."
            )
            ok = False
        else:
            print(f"Failed to stop PID {pid} (still running).")
            ok = False
    return 0 if ok else 1


def _start_server(args: argparse.Namespace) -> None:
    existing = registry.find_on_port(args.host, args.port)
    if existing is not None:
        url = existing.get("url") or registry.url_for(args.host, args.port)
        pid = existing.get("pid")
        suffix = f" (PID {pid})" if pid else ""
        print(
            f"media-diff is already running at {url}{suffix}; "
            "opening it instead of starting a new one."
        )
        if not args.no_browser:
            _open_browser(url)
        return

    others = [
        item
        for item in registry.status_instances()
        if item.get("port") != args.port
    ]
    if others:
        print(
            "Note: other running instance(s) detected "
            "(starting a new one on this port):"
        )
        for item in others:
            print(f"  {item.get('url')} (PID {item.get('pid')})")

    url = registry.url_for(args.host, args.port)
    if not args.no_browser:
        timer = threading.Timer(1.0, _open_browser, args=(url,))
        timer.daemon = True
        timer.start()

    saved_tty = _save_tty()
    registry.register(args.host, args.port, __version__)
    print(f"Media Diff is starting at {url}")
    try:
        uvicorn.run(
            "media_diff.app:app",
            host=args.host,
            port=args.port,
            reload=args.reload,
            timeout_graceful_shutdown=SHUTDOWN_TIMEOUT_SECONDS,
        )
    except KeyboardInterrupt:  # pragma: no cover - interactive Ctrl+C
        pass
    finally:
        registry.unregister(os.getpid(), args.port)
        _restore_tty(saved_tty)


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.command == "status":
        _print_status(registry.status_instances(), args.json)
        return 0
    if args.command == "stop":
        return _cmd_stop(args)

    _start_server(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
