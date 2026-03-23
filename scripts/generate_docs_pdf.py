#!/usr/bin/env python3
"""Build a single PDF booklet from the markdown files under docs/."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (
    HRFlowable,
    LongTable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    TableStyle,
)


ROOT_DIR = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT_DIR / "docs"
OUTPUT_PDF = ROOT_DIR / "output" / "pdf" / "docs.pdf"
LATIN_SERIF_FONT = "Times-Roman"
LATIN_SANS_FONT = "Helvetica"
LATIN_SANS_BOLD_FONT = "Helvetica-Bold"

HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.*)$")
BULLET_PATTERN = re.compile(r"^(?P<indent>\s*)-\s+(?P<text>.+)$")
TABLE_SEPARATOR_PATTERN = re.compile(r"^\|?[\s:-]+\|[\s|:-]*$")
LINK_PATTERN = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


@dataclass(frozen=True)
class HeadingBlock:
    level: int
    text: str


@dataclass(frozen=True)
class ParagraphBlock:
    text: str


@dataclass(frozen=True)
class BulletItem:
    level: int
    text: str


@dataclass(frozen=True)
class BulletListBlock:
    items: list[BulletItem]


@dataclass(frozen=True)
class TableBlock:
    rows: list[list[str]]


@dataclass(frozen=True)
class RuleBlock:
    pass


Block = HeadingBlock | ParagraphBlock | BulletListBlock | TableBlock | RuleBlock


def read_meta(directory: Path) -> dict[str, str]:
    """Read `_meta.json` when present so PDF ordering matches the docs nav."""
    meta_path = directory / "_meta.json"
    if not meta_path.exists():
        return {}
    return json.loads(meta_path.read_text(encoding="utf-8"))


def ordered_markdown_paths(directory: Path) -> list[Path]:
    """Collect markdown files recursively using sidebar order first."""
    meta = read_meta(directory)
    markdown_files = {
        path.stem: path
        for path in sorted(directory.iterdir())
        if path.is_file() and path.suffix in {".md", ".mdx"} and path.name != "_meta.json"
    }
    subdirectories = {path.name: path for path in sorted(directory.iterdir()) if path.is_dir()}

    ordered_paths: list[Path] = []
    consumed_files: set[str] = set()
    consumed_directories: set[str] = set()

    for key in meta:
        if key in markdown_files:
            ordered_paths.append(markdown_files[key])
            consumed_files.add(key)
        elif key in subdirectories:
            ordered_paths.extend(ordered_markdown_paths(subdirectories[key]))
            consumed_directories.add(key)

    for key in sorted(markdown_files):
        if key in consumed_files:
            continue
        ordered_paths.append(markdown_files[key])

    for key in sorted(subdirectories):
        if key in consumed_directories:
            continue
        ordered_paths.extend(ordered_markdown_paths(subdirectories[key]))

    return ordered_paths


def strip_markdown_links(text: str) -> str:
    """Keep the human-readable label while removing markdown link syntax."""
    return LINK_PATTERN.sub(lambda match: match.group(1), text)


def normalize_inline_text(text: str) -> str:
    """Collapse inline markdown to plain text that ReportLab can render safely."""
    without_links = strip_markdown_links(text)
    without_backticks = without_links.replace("`", "")
    return re.sub(r"\s+", " ", without_backticks).strip()


def split_table_row(line: str) -> list[str]:
    """Parse a markdown table row into trimmed cell strings."""
    return [normalize_inline_text(cell.strip()) for cell in line.strip().strip("|").split("|")]


def is_table_start(lines: list[str], index: int) -> bool:
    """Detect a markdown table by checking the header and separator rows."""
    if index + 1 >= len(lines):
        return False
    return lines[index].lstrip().startswith("|") and bool(TABLE_SEPARATOR_PATTERN.match(lines[index + 1].strip()))


def parse_markdown(markdown_text: str) -> list[Block]:
    """Convert a small, repo-specific markdown subset into layout blocks."""
    lines = markdown_text.splitlines()
    blocks: list[Block] = []
    index = 0

    while index < len(lines):
        raw_line = lines[index].rstrip()
        stripped_line = raw_line.strip()

        if not stripped_line:
            index += 1
            continue

        if stripped_line == "---":
            blocks.append(RuleBlock())
            index += 1
            continue

        heading_match = HEADING_PATTERN.match(stripped_line)
        if heading_match:
            blocks.append(
                HeadingBlock(
                    level=len(heading_match.group(1)),
                    text=normalize_inline_text(heading_match.group(2)),
                )
            )
            index += 1
            continue

        if is_table_start(lines, index):
            rows = [split_table_row(lines[index])]
            index += 2
            while index < len(lines) and lines[index].lstrip().startswith("|"):
                rows.append(split_table_row(lines[index]))
                index += 1
            blocks.append(TableBlock(rows=rows))
            continue

        bullet_match = BULLET_PATTERN.match(raw_line)
        if bullet_match:
            items: list[BulletItem] = []
            while index < len(lines):
                current_line = lines[index].rstrip()
                current_match = BULLET_PATTERN.match(current_line)
                if not current_match:
                    break
                indent_width = len(current_match.group("indent"))
                items.append(
                    BulletItem(
                        level=max(0, indent_width // 2),
                        text=normalize_inline_text(current_match.group("text")),
                    )
                )
                index += 1
            blocks.append(BulletListBlock(items=items))
            continue

        paragraph_lines = [normalize_inline_text(stripped_line)]
        index += 1
        while index < len(lines):
            next_line = lines[index].rstrip()
            next_stripped = next_line.strip()
            if not next_stripped:
                break
            if (
                next_stripped == "---"
                or HEADING_PATTERN.match(next_stripped)
                or is_table_start(lines, index)
                or BULLET_PATTERN.match(next_line)
            ):
                break
            paragraph_lines.append(normalize_inline_text(next_stripped))
            index += 1

        blocks.append(ParagraphBlock(text=" ".join(part for part in paragraph_lines if part)))

    return blocks


def register_fonts() -> None:
    """Use built-in CID fonts so Japanese text renders without external assets."""
    pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
    pdfmetrics.registerFont(UnicodeCIDFont("HeiseiMin-W3"))


def build_styles():
    """Create a restrained document style set tuned for A4 skillsheet output."""
    sample_styles = getSampleStyleSheet()

    body = ParagraphStyle(
        "BodyJP",
        parent=sample_styles["BodyText"],
        fontName="HeiseiMin-W3",
        fontSize=10.5,
        leading=16,
        textColor=colors.HexColor("#1f2937"),
        wordWrap="CJK",
        spaceAfter=6,
    )
    note = ParagraphStyle(
        "NoteJP",
        parent=body,
        fontSize=9.5,
        leading=14,
        textColor=colors.HexColor("#4b5563"),
        leftIndent=4,
    )
    heading_1 = ParagraphStyle(
        "Heading1JP",
        parent=body,
        fontName="HeiseiKakuGo-W5",
        fontSize=20,
        leading=28,
        textColor=colors.HexColor("#111827"),
        spaceBefore=0,
        spaceAfter=14,
    )
    heading_2 = ParagraphStyle(
        "Heading2JP",
        parent=body,
        fontName="HeiseiKakuGo-W5",
        fontSize=14,
        leading=20,
        textColor=colors.HexColor("#111827"),
        spaceBefore=8,
        spaceAfter=6,
    )
    heading_3 = ParagraphStyle(
        "Heading3JP",
        parent=body,
        fontName="HeiseiKakuGo-W5",
        fontSize=11.5,
        leading=17,
        textColor=colors.HexColor("#111827"),
        spaceBefore=6,
        spaceAfter=4,
    )

    bullet_styles = {
        0: ParagraphStyle(
            "BulletLevel0",
            parent=body,
            leftIndent=14,
            firstLineIndent=0,
            bulletIndent=0,
            spaceAfter=2,
        ),
        1: ParagraphStyle(
            "BulletLevel1",
            parent=body,
            leftIndent=28,
            firstLineIndent=0,
            bulletIndent=14,
            spaceAfter=2,
        ),
    }

    table_cell = ParagraphStyle(
        "TableCellJP",
        parent=body,
        fontSize=9.5,
        leading=13,
        spaceAfter=0,
    )
    table_header = ParagraphStyle(
        "TableHeaderJP",
        parent=table_cell,
        fontName="HeiseiKakuGo-W5",
        textColor=colors.HexColor("#111827"),
    )

    return {
        "body": body,
        "note": note,
        "heading_1": heading_1,
        "heading_2": heading_2,
        "heading_3": heading_3,
        "bullet": bullet_styles,
        "table_cell": table_cell,
        "table_header": table_header,
    }


def is_ascii_character(character: str) -> bool:
    """Detect Basic Latin characters that look better in a dedicated western font."""
    return ord(character) < 128


def paragraph_markup(text: str, latin_font_name: str | None = None) -> str:
    """Escape paragraph content and swap ASCII runs into a stable western font."""
    if not latin_font_name:
        return escape(text)

    markup_parts: list[str] = []
    current_buffer: list[str] = []
    current_font: str | None = None

    def flush_buffer() -> None:
        """Emit the buffered run with the correct font tag once the font context changes."""
        nonlocal current_buffer, current_font
        if not current_buffer:
            return

        escaped_text = escape("".join(current_buffer))
        if current_font:
            markup_parts.append(f'<font name="{current_font}">{escaped_text}</font>')
        else:
            markup_parts.append(escaped_text)

        current_buffer = []

    for character in text:
        next_font = latin_font_name if is_ascii_character(character) else None
        if next_font != current_font:
            flush_buffer()
            current_font = next_font
        current_buffer.append(character)

    flush_buffer()
    return "".join(markup_parts)


def table_column_widths(table_block: TableBlock, available_width: float) -> list[float]:
    """Use stable width presets so the known docs tables stay readable."""
    column_count = len(table_block.rows[0])
    if column_count == 2:
        return [available_width * 0.24, available_width * 0.76]

    if column_count == 3:
        header = table_block.rows[0]
        if header[:3] == ["タイトル", "キーワード", "期間"]:
            return [available_width * 0.42, available_width * 0.34, available_width * 0.24]

    return [available_width / column_count] * column_count


def blocks_to_flowables(blocks: Iterable[Block], styles: dict[str, object], available_width: float):
    """Translate parsed blocks into ReportLab flowables."""
    flowables = []
    latin_fonts = {
        "heading_1": LATIN_SANS_BOLD_FONT,
        "heading_2": LATIN_SANS_BOLD_FONT,
        "heading_3": LATIN_SANS_BOLD_FONT,
        "body": LATIN_SERIF_FONT,
        "note": LATIN_SERIF_FONT,
        "table_cell": LATIN_SERIF_FONT,
        "table_header": LATIN_SANS_BOLD_FONT,
        "bullet": LATIN_SERIF_FONT,
    }

    for block in blocks:
        if isinstance(block, HeadingBlock):
            style_key = {
                1: "heading_1",
                2: "heading_2",
                3: "heading_3",
            }.get(block.level, "body")
            flowables.append(
                Paragraph(
                    paragraph_markup(block.text, latin_fonts[style_key]),
                    styles[style_key],
                )
            )
            continue

        if isinstance(block, ParagraphBlock):
            style = styles["note"] if block.text.startswith("※") else styles["body"]
            style_key = "note" if block.text.startswith("※") else "body"
            flowables.append(
                Paragraph(
                    paragraph_markup(block.text, latin_fonts[style_key]),
                    style,
                )
            )
            continue

        if isinstance(block, BulletListBlock):
            for item in block.items:
                bullet_style = styles["bullet"].get(item.level, styles["bullet"][1])
                flowables.append(
                    Paragraph(
                        paragraph_markup(item.text, latin_fonts["bullet"]),
                        bullet_style,
                        bulletText="•",
                    )
                )
            flowables.append(Spacer(1, 4))
            continue

        if isinstance(block, TableBlock):
            rows = []
            for row_index, row in enumerate(block.rows):
                row_style_key = "table_header" if row_index == 0 else "table_cell"
                row_style = styles[row_style_key]
                rows.append(
                    [
                        Paragraph(paragraph_markup(cell, latin_fonts[row_style_key]), row_style)
                        for cell in row
                    ]
                )

            table = LongTable(
                rows,
                colWidths=table_column_widths(block, available_width),
                repeatRows=1,
                hAlign="LEFT",
            )
            table.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e5e7eb")),
                        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#111827")),
                        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 6),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                        ("TOPPADDING", (0, 0), (-1, -1), 5),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ]
                )
            )
            flowables.append(table)
            flowables.append(Spacer(1, 8))
            continue

        if isinstance(block, RuleBlock):
            flowables.append(
                HRFlowable(
                    width="100%",
                    thickness=0.8,
                    color=colors.HexColor("#d1d5db"),
                    spaceBefore=6,
                    spaceAfter=8,
                )
            )

    return flowables


def draw_page_number(canvas, document) -> None:
    """Add a quiet footer so the merged PDF remains easy to navigate."""
    canvas.saveState()
    canvas.setFont(LATIN_SANS_FONT, 9)
    canvas.setFillColor(colors.HexColor("#6b7280"))
    footer_text = f"{document.page}"
    canvas.drawRightString(document.pagesize[0] - 16 * mm, 10 * mm, footer_text)
    canvas.restoreState()


def build_pdf(markdown_paths: list[Path], output_path: Path) -> None:
    """Render all docs markdown files into a single A4 PDF."""
    register_fonts()
    styles = build_styles()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    document = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title="技術者経歴書",
        author="Codex",
    )

    story = []
    for file_index, markdown_path in enumerate(markdown_paths):
        if file_index > 0:
            story.append(PageBreak())

        markdown_text = markdown_path.read_text(encoding="utf-8")
        blocks = parse_markdown(markdown_text)
        story.extend(blocks_to_flowables(blocks, styles, document.width))

    document.build(story, onFirstPage=draw_page_number, onLaterPages=draw_page_number)


def main() -> None:
    """Entry point used by local manual runs."""
    markdown_paths = ordered_markdown_paths(DOCS_DIR)
    build_pdf(markdown_paths, OUTPUT_PDF)
    print(f"Created PDF: {OUTPUT_PDF}")


if __name__ == "__main__":
    main()
