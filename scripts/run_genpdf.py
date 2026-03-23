#!/usr/bin/env python3
"""Bootstrap the local PDF toolchain and generate the merged docs PDF."""

from __future__ import annotations

import os
import subprocess
import sys
import venv
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
VENV_DIR = ROOT_DIR / "tmp" / "pdfs" / ".venv"
VENV_PYTHON = VENV_DIR / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
GENERATOR_SCRIPT = ROOT_DIR / "scripts" / "generate_docs_pdf.py"
REQUIRED_PACKAGES = ["reportlab"]


def run_command(arguments: list[str]) -> None:
    """Run a subprocess in the repo root so failures surface clearly to `pnpm genpdf`."""
    subprocess.run(arguments, check=True, cwd=ROOT_DIR)


def ensure_virtualenv() -> None:
    """Keep PDF dependencies isolated so the command works from a clean checkout."""
    if VENV_PYTHON.exists():
        return

    VENV_DIR.parent.mkdir(parents=True, exist_ok=True)
    venv.EnvBuilder(with_pip=True).create(VENV_DIR)


def has_required_packages() -> bool:
    """Avoid reinstalling dependencies on every run when the local toolchain is ready."""
    if not VENV_PYTHON.exists():
        return False

    import_check = (
        "import importlib.util, sys; "
        "missing=[name for name in sys.argv[1:] if importlib.util.find_spec(name) is None]; "
        "raise SystemExit(0 if not missing else 1)"
    )
    result = subprocess.run(
        [str(VENV_PYTHON), "-c", import_check, *REQUIRED_PACKAGES],
        cwd=ROOT_DIR,
        check=False,
    )
    return result.returncode == 0


def install_required_packages() -> None:
    """Install the minimal Python dependency set needed by the PDF generator."""
    run_command([str(VENV_PYTHON), "-m", "pip", "install", *REQUIRED_PACKAGES])


def build_pdf() -> None:
    """Delegate to the dedicated generator so PDF layout logic stays in one place."""
    run_command([str(VENV_PYTHON), str(GENERATOR_SCRIPT)])


def main() -> int:
    """Provide a single stable entry point for `pnpm genpdf`."""
    ensure_virtualenv()

    if not has_required_packages():
        print("Installing PDF dependencies into tmp/pdfs/.venv ...", flush=True)
        install_required_packages()

    print("Generating PDF ...", flush=True)
    build_pdf()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
