"""nnwdump: capture a NetNewsWire article as a fixture, from inside lldb.

Stopped at the final `return d` of ArticleRenderer.articleSubstitutions(), this
reads the substitution dictionary NetNewsWire built for the selected article and
writes it as a TOML fixture. `npx nnw-theme@2 capture` prints the setup steps.

NetNewsWire with enclosure support renders an article's enclosures into that
dictionary: as `enclosures`, or appended to a wrapped `body` when the template has no
[[enclosures]] macro. nnwdump keeps neither. It records the article's attachments
and image instead, as [[attachments]] tables and image_url/thumbnail_url, so nnw-theme
renders them for whichever template previews the fixture.

Values cross the debugger boundary base64-encoded, so nothing is truncated or
mis-escaped. HTML values are written as '''literal''' strings, so fixtures stay
readable and diff cleanly.

This file runs in Xcode's lldb Python, not the project's: keep it standard-library
only and compatible with Python 3.9. It imports lldb lazily so the formatting
helpers can be tested without a debugger.
"""

from __future__ import annotations

import base64
import json
import optparse
import shlex
from pathlib import Path

USAGE = "nnwdump [--var NAME] [--article NAME] [--no-icon] [OUTPUT.toml]"
DEFAULT_OUTPUT = "fixtures/nnw-capture.toml"
# Sorted last so the short metadata stays at the top of the file.
_HTML_KEYS = {"body"}
_ENCLOSURES_KEY = "enclosures"
# ArticleRenderer's body for a template without [[enclosures]]: <div>BODY</div>ENCLOSURES.
_WRAPPED_BODY_TAIL = '</div><div class="nnw-enclosures">'
# Attachment's Codable keys, in fixture order, with their fixture names.
_ATTACHMENT_KEYS = (
    ("url", "url"),
    ("mimeType", "mime_type"),
    ("title", "title"),
    ("sizeInBytes", "size_in_bytes"),
    ("durationInSeconds", "duration_in_seconds"),
    ("width", "width"),
    ("height", "height"),
    ("medium", "medium"),
)


def resolve_output(argument: str) -> Path:
    """Relative paths resolve against the working directory.

    This file ships in the nnw-theme package, not the theme repository, and lldb's
    working directory under Xcode is /, so `npx nnw-theme@2 capture` prints an absolute
    output path to pass instead.
    """
    path = Path(argument).expanduser()
    return path if path.is_absolute() else Path.cwd() / path


def _toml_basic(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    escaped = escaped.replace("\n", "\\n").replace("\t", "\\t").replace("\r", "\\r")
    return "".join(c if ord(c) >= 0x20 and c != "\x7f" else f"\\u{ord(c):04x}" for c in escaped)


def toml_line(key: str, value: str) -> str:
    """One `key = value` line in the most readable string form that is exact."""
    # Literal strings cannot hold control characters (multiline ones allow newlines).
    literal = not any((ord(c) < 0x20 and c not in "\t\n") or c == "\x7f" for c in value)
    if literal and ("\n" in value or "<" in value) and "'''" not in value:
        # TOML drops the newline right after the opening delimiter, so this one is
        # layout, and a value's own leading newline survives.
        return f"{key} = '''\n{value}'''"
    if literal and "\n" not in value and "'" not in value:
        return f"{key} = '{value}'"
    return f'{key} = "{_toml_basic(value)}"'


def without_enclosures(pairs: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """The substitutions as they were before NetNewsWire rendered the enclosures."""
    values = dict(pairs)
    if _ENCLOSURES_KEY not in values:
        body = values.get("body", "")
        at = body.rfind(_WRAPPED_BODY_TAIL)
        if body.startswith("<div>") and at != -1:
            values["body"] = body[len("<div>") : at]
    values.pop(_ENCLOSURES_KEY, None)
    return list(values.items())


def attachments_from_json(text: str) -> list[dict]:
    """Attachment JSON, as [Attachment].json() writes it, as fixture tables."""
    tables = []
    for attachment in json.loads(text or "[]") or []:
        table = {
            name: attachment[key]
            for key, name in _ATTACHMENT_KEYS
            if attachment.get(key) is not None
        }
        if table.get("url"):
            tables.append(table)
    return tables


def _toml_value_line(key: str, value) -> str:
    if isinstance(value, bool) or not isinstance(value, int):
        return toml_line(key, str(value))
    return f"{key} = {value}"


def fixture_text(pairs: list[tuple[str, str]], name: str, attachments: list[dict] = ()) -> str:
    ordered = sorted(pairs, key=lambda pair: (pair[0] in _HTML_KEYS, pair[0]))
    header = (
        "# NetNewsWire article captured with nnwdump.\n"
        f"# Preview with: npx nnw-theme@2 render {name}\n\n"
    )
    text = header + "\n".join(toml_line(key, value) for key, value in ordered) + "\n"
    for table in attachments:
        lines = [_toml_value_line(key, value) for key, value in table.items()]
        text += "\n[[attachments]]\n" + "\n".join(lines) + "\n"
    return text


def _evaluate(interpreter, expression: str):
    """The exact text of a Swift String expression, or (None, error)."""
    import lldb

    wrapped = f"Data(({expression}).utf8).base64EncodedString()"
    result = lldb.SBCommandReturnObject()
    interpreter.HandleCommand("expression -l Swift -O -- " + wrapped, result)
    if not result.Succeeded():
        return None, (result.GetError() or "").strip()
    token = (result.GetOutput() or "").strip().strip('"').strip()
    try:
        return base64.b64decode(token).decode("utf-8"), None
    except ValueError as error:
        return None, f"could not decode debugger output: {error}"


def _icon_data_url(interpreter, article: str):
    # Mirrors ArticleIconSchemeHandler: the feed icon as PNG data.
    encoded, _ = _evaluate(
        interpreter,
        f'{article}.iconImage()?.image.dataRepresentation()?.base64EncodedString() ?? ""',
    )
    return f"data:image/png;base64,{encoded}" if encoded else None


def nnwdump(debugger, command, result, internal_dict):
    parser = optparse.OptionParser(prog="nnwdump", usage=USAGE)
    parser.add_option("--var", default="d", help="substitution dictionary (default: d)")
    parser.add_option("--article", default="article", help="Article value (default: article)")
    parser.add_option("--no-icon", action="store_true", help="keep the generated feed icon")
    try:
        options, arguments = parser.parse_args(shlex.split(command))
    except SystemExit:
        result.SetError(f"usage: {USAGE}")
        return
    output = resolve_output(arguments[0] if arguments else DEFAULT_OUTPUT)

    frame = debugger.GetSelectedTarget().GetProcess().GetSelectedThread().GetSelectedFrame()
    if not frame or not frame.IsValid():
        result.SetError("no stack frame; stop at the breakpoint first")
        return
    debugger.HandleCommand("settings set target.max-string-summary-length 0")

    # One "key<TAB>base64(value)" line per entry; base64 never contains either separator.
    interpreter = debugger.GetCommandInterpreter()
    raw, error = _evaluate(
        interpreter,
        f'{options.var}.map {{ $0.key + "\\t" + Data($0.value.utf8).base64EncodedString() }}'
        '.joined(separator: "\\n")',
    )
    if raw is None:
        result.SetError(f"could not read `{options.var}`: {error}. Stop at `return d` first.")
        return
    pairs = []
    for line in raw.strip().splitlines():
        key, _, encoded = line.partition("\t")
        if key and encoded:
            pairs.append((key.strip(), base64.b64decode(encoded).decode("utf-8")))
    if not pairs:
        result.SetError(f"`{options.var}` is empty; is this the substitution dictionary?")
        return

    # Older NetNewsWire has no attachments to read; capture the article without them.
    pairs = without_enclosures(pairs)
    attachments = []
    raw, _ = _evaluate(interpreter, f'({options.article}.attachments ?? []).json() ?? "[]"')
    if raw:
        attachments = attachments_from_json(raw)
    for key, link in (("image_url", "imageLink"), ("thumbnail_url", "thumbnailLink")):
        value, _ = _evaluate(interpreter, f'{options.article}.{link} ?? ""')
        if value:
            pairs.append((key, value))

    note = ""
    if attachments:
        note = f" and {len(attachments)} attachment{'s' if len(attachments) > 1 else ''}"
    if not options.no_icon:
        icon = _icon_data_url(interpreter, options.article)
        if icon:
            pairs = [(key, value) for key, value in pairs if key != "avatar_src"]
            pairs.append(("avatar_src", icon))
            note += " with the feed's icon"
        else:
            note += "; the feed has no icon, so previews generate one"

    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(fixture_text(pairs, output.stem, attachments), encoding="utf-8")
    except OSError as error:
        result.SetError(f"could not write {output}: {error}")
        return
    result.AppendMessage(f"nnwdump: wrote {len(pairs)} values to {output}{note}")


def __lldb_init_module(debugger, internal_dict):
    debugger.HandleCommand("command script add -f nnwdump.nnwdump nnwdump")
    print(f"nnwdump is ready. At the breakpoint: {USAGE}")
