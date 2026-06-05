// vdfedit.rs - surgical, lossless text edits of Steam VDF files.
//
// We do NOT round-trip through a VDF parser (keyvalues-parser reorders keys via its
// BTreeMap and isn't byte-faithful). Steam's localconfig.vdf is ~150 KB of unrelated
// data; we must change ONLY the targeted value and leave every other byte untouched.
//
// Strategy: tokenize into quoted-strings / braces with byte offsets, walk the structure
// to locate the exact span to change, then splice the original text. Indentation is
// inferred from the surrounding lines (Steam uses tabs).

/// A lexical token with its full byte span [start, end) in the source text.
struct Tok {
    kind: Kind,
    start: usize,
    end: usize,
}

enum Kind {
    Str(String), // unescaped content
    Open,
    Close,
}

fn tokenize(text: &str) -> Result<Vec<Tok>, String> {
    let b = text.as_bytes();
    let mut i = 0;
    let mut out = Vec::new();
    while i < b.len() {
        let c = b[i];
        if c == b' ' || c == b'\t' || c == b'\r' || c == b'\n' {
            i += 1;
            continue;
        }
        // // line comment
        if c == b'/' && i + 1 < b.len() && b[i + 1] == b'/' {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if c == b'{' {
            out.push(Tok { kind: Kind::Open, start: i, end: i + 1 });
            i += 1;
            continue;
        }
        if c == b'}' {
            out.push(Tok { kind: Kind::Close, start: i, end: i + 1 });
            i += 1;
            continue;
        }
        if c == b'"' {
            let start = i;
            i += 1;
            let mut content = String::new();
            loop {
                if i >= b.len() {
                    return Err("unterminated quoted string".into());
                }
                match b[i] {
                    b'\\' if i + 1 < b.len() => {
                        // VDF escapes: \\ \" \n \t - keep it simple, decode the common ones
                        let next = b[i + 1];
                        content.push(match next {
                            b'n' => '\n',
                            b't' => '\t',
                            other => other as char, // covers \" and \\
                        });
                        i += 2;
                    }
                    b'"' => {
                        i += 1;
                        break;
                    }
                    other => {
                        content.push(other as char);
                        i += 1;
                    }
                }
            }
            out.push(Tok { kind: Kind::Str(content), start, end: i });
            continue;
        }
        // unquoted token (Steam quotes everything in these files; bail to be safe)
        return Err(format!("unexpected unquoted byte 0x{c:02x} at offset {i}"));
    }
    Ok(out)
}

/// Index just past the value starting at token `i` (a Str, or a balanced { } object).
fn skip_value(toks: &[Tok], i: usize) -> Result<usize, String> {
    match toks.get(i).map(|t| &t.kind) {
        Some(Kind::Str(_)) => Ok(i + 1),
        Some(Kind::Open) => {
            let mut depth = 1;
            let mut j = i + 1;
            while j < toks.len() && depth > 0 {
                match toks[j].kind {
                    Kind::Open => depth += 1,
                    Kind::Close => depth -= 1,
                    _ => {}
                }
                j += 1;
            }
            if depth != 0 {
                return Err("unbalanced braces".into());
            }
            Ok(j)
        }
        _ => Err("expected a value".into()),
    }
}

enum KeyLoc {
    /// key found: token index of the key, and of its value
    Found { val_idx: usize },
    /// key absent: token index of the object's closing brace
    Absent { close_idx: usize },
}

/// Find `key` (case-insensitive) directly inside the object whose body starts at
/// token `body_start` (the index right after the object's `{`).
fn find_key(toks: &[Tok], body_start: usize, key: &str) -> Result<KeyLoc, String> {
    let mut i = body_start;
    loop {
        match toks.get(i).map(|t| &t.kind) {
            Some(Kind::Close) => return Ok(KeyLoc::Absent { close_idx: i }),
            Some(Kind::Str(k)) => {
                let val_idx = i + 1;
                if val_idx >= toks.len() {
                    return Err("key without value".into());
                }
                if k.eq_ignore_ascii_case(key) {
                    return Ok(KeyLoc::Found { val_idx });
                }
                i = skip_value(toks, val_idx)?;
            }
            _ => return Err("malformed object".into()),
        }
    }
}

/// Navigate `path` (keys under the root object) and return the body-start token index
/// and closing-brace token index of the final object. Every segment must be an object.
fn nav_obj(toks: &[Tok], path: &[&str]) -> Result<(usize, usize), String> {
    // root: toks[0] = Str(root key), toks[1] = Open
    if toks.len() < 2 || !matches!(toks[0].kind, Kind::Str(_)) || !matches!(toks[1].kind, Kind::Open)
    {
        return Err("not a VDF object document".into());
    }
    let mut body_start = 2usize;
    let mut close_idx = skip_value(toks, 1)? - 1; // close of root object
    for seg in path {
        match find_key(toks, body_start, seg)? {
            KeyLoc::Found { val_idx } => {
                if !matches!(toks.get(val_idx).map(|t| &t.kind), Some(Kind::Open)) {
                    return Err(format!("path segment {seg:?} is not an object"));
                }
                body_start = val_idx + 1;
                close_idx = skip_value(toks, val_idx)? - 1;
            }
            KeyLoc::Absent { .. } => {
                return Err(format!("path segment {seg:?} not found"));
            }
        }
    }
    Ok((body_start, close_idx))
}

fn escape(v: &str) -> String {
    let mut s = String::with_capacity(v.len());
    for c in v.chars() {
        match c {
            '\\' => s.push_str("\\\\"),
            '"' => s.push_str("\\\""),
            '\n' => s.push_str("\\n"),
            '\t' => s.push_str("\\t"),
            other => s.push(other),
        }
    }
    s
}

/// The leading whitespace (indentation) of the line containing byte `pos`.
fn line_indent(text: &str, pos: usize) -> &str {
    let line_start = text[..pos].rfind('\n').map(|n| n + 1).unwrap_or(0);
    let after = &text[line_start..pos];
    let nonws = after
        .find(|c: char| c != ' ' && c != '\t')
        .unwrap_or(after.len());
    &after[..nonws]
}

fn line_start_of(text: &str, pos: usize) -> usize {
    text[..pos].rfind('\n').map(|n| n + 1).unwrap_or(0)
}

/// Set `key` = `value` (a string) inside the object reached by `obj_path`. Replaces the
/// value if the key exists, otherwise inserts the pair just before the object's `}`.
fn set_field_in_obj(text: &str, obj_path: &[&str], key: &str, value: &str) -> Result<String, String> {
    let toks = tokenize(text)?;
    let (body_start, close_idx) = nav_obj(&toks, obj_path)?;
    match find_key(&toks, body_start, key)? {
        KeyLoc::Found { val_idx } => {
            let v = &toks[val_idx];
            if !matches!(v.kind, Kind::Str(_)) {
                return Err(format!("{key:?} is an object, not a string value"));
            }
            let mut out = String::with_capacity(text.len() + value.len());
            out.push_str(&text[..v.start]);
            out.push('"');
            out.push_str(&escape(value));
            out.push('"');
            out.push_str(&text[v.end..]);
            Ok(out)
        }
        KeyLoc::Absent { close_idx } => {
            let close_byte = toks[close_idx].start;
            let indent = format!("{}\t", line_indent(text, close_byte));
            let ins = format!("{indent}\"{}\"\t\t\"{}\"\n", escape(key), escape(value));
            let at = line_start_of(text, close_byte);
            let mut out = String::with_capacity(text.len() + ins.len());
            out.push_str(&text[..at]);
            out.push_str(&ins);
            out.push_str(&text[at..]);
            Ok(out)
        }
    }
    .map(|s| {
        let _ = close_idx;
        s
    })
}

/// Insert a brand-new appid block `"<appid>" { <fields> }` into the parent object.
fn insert_app_block(
    text: &str,
    parent_path: &[&str],
    appid: &str,
    fields: &[(&str, &str)],
) -> Result<String, String> {
    let toks = tokenize(text)?;
    let (_body_start, close_idx) = nav_obj(&toks, parent_path)?;
    let close_byte = toks[close_idx].start;
    let child_indent = format!("{}\t", line_indent(text, close_byte));
    let field_indent = format!("{child_indent}\t");
    let mut block = String::new();
    block.push_str(&format!("{child_indent}\"{}\"\n{child_indent}{{\n", escape(appid)));
    for (k, v) in fields {
        block.push_str(&format!("{field_indent}\"{}\"\t\t\"{}\"\n", escape(k), escape(v)));
    }
    block.push_str(&format!("{child_indent}}}\n"));
    let at = line_start_of(text, close_byte);
    let mut out = String::with_capacity(text.len() + block.len());
    out.push_str(&text[..at]);
    out.push_str(&block);
    out.push_str(&text[at..]);
    Ok(out)
}

/// Upsert one or more string fields on the `appid` block under `parent_path`. Creates the
/// block if absent; otherwise replaces/inserts each field within it.
pub fn upsert_app_fields(
    text: &str,
    parent_path: &[&str],
    appid: &str,
    fields: &[(&str, &str)],
) -> Result<String, String> {
    let toks = tokenize(text)?;
    let (parent_body, _parent_close) = nav_obj(&toks, parent_path)?;
    match find_key(&toks, parent_body, appid)? {
        KeyLoc::Found { val_idx } => {
            if !matches!(toks[val_idx].kind, Kind::Open) {
                return Err(format!("appid {appid:?} entry is not an object"));
            }
            // Re-tokenize per field (byte offsets shift as we edit). Cheap for our sizes.
            let mut cur = text.to_string();
            let mut child_path: Vec<&str> = parent_path.to_vec();
            child_path.push(appid);
            for (k, v) in fields {
                cur = set_field_in_obj(&cur, &child_path, k, v)?;
            }
            Ok(cur)
        }
        KeyLoc::Absent { .. } => insert_app_block(text, parent_path, appid, fields),
    }
}

/// Remove the entire `"<appid>" { ... }` block under `parent_path`. No-op if absent.
pub fn remove_app_block(text: &str, parent_path: &[&str], appid: &str) -> Result<String, String> {
    let toks = tokenize(text)?;
    let (parent_body, _) = nav_obj(&toks, parent_path)?;
    match find_key(&toks, parent_body, appid)? {
        KeyLoc::Absent { .. } => Ok(text.to_string()),
        KeyLoc::Found { val_idx } => {
            // key token is val_idx - 1
            let key_idx = val_idx - 1;
            if !matches!(toks[val_idx].kind, Kind::Open) {
                return Err(format!("appid {appid:?} entry is not an object"));
            }
            let after_close = skip_value(&toks, val_idx)?; // index past matching close
            let close_byte = toks[after_close - 1].start; // the `}`
            let del_start = line_start_of(text, toks[key_idx].start);
            // delete through the end of the `}` line (including its trailing newline)
            let nl = text[close_byte..].find('\n').map(|n| close_byte + n + 1);
            let del_end = nl.unwrap_or(text.len());
            let mut out = String::with_capacity(text.len());
            out.push_str(&text[..del_start]);
            out.push_str(&text[del_end..]);
            Ok(out)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\"UserLocalConfigStore\"\n{\n\t\"Software\"\n\t{\n\t\t\"Valve\"\n\t\t{\n\t\t\t\"Steam\"\n\t\t\t{\n\t\t\t\t\"apps\"\n\t\t\t\t{\n\t\t\t\t\t\"730\"\n\t\t\t\t\t{\n\t\t\t\t\t\t\"LaunchOptions\"\t\t\"game %command%\"\n\t\t\t\t\t\t\"LastPlayed\"\t\t\"123\"\n\t\t\t\t\t}\n\t\t\t\t\t\"570\"\n\t\t\t\t\t{\n\t\t\t\t\t\t\"LastPlayed\"\t\t\"456\"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n";

    const APPS: &[&str] = &["Software", "Valve", "Steam", "apps"];

    fn launch_of(text: &str, appid: &str) -> Option<String> {
        // read back via keyvalues-parser (reordering irrelevant for reads)
        let vdf = keyvalues_parser::Vdf::from(keyvalues_parser::parse(text).ok()?);
        let v = &vdf.value;
        crate::steam::test_read(v, &["Software", "Valve", "Steam", "apps", appid, "LaunchOptions"])
    }

    #[test]
    fn replace_existing_value() {
        let out = upsert_app_fields(SAMPLE, APPS, "730", &[("LaunchOptions", "mangohud %command%")]).unwrap();
        assert_eq!(launch_of(&out, "730").as_deref(), Some("mangohud %command%"));
        // unrelated key preserved
        assert!(out.contains("\"LastPlayed\"\t\t\"123\""));
        // only the value changed - byte length differs only by the value delta
        assert!(out.contains("\"LaunchOptions\"\t\t\"mangohud %command%\""));
    }

    #[test]
    fn insert_missing_field() {
        // 570 has no LaunchOptions - should be inserted
        let out = upsert_app_fields(SAMPLE, APPS, "570", &[("LaunchOptions", "game %command%")]).unwrap();
        assert_eq!(launch_of(&out, "570").as_deref(), Some("game %command%"));
        assert!(out.contains("\"LastPlayed\"\t\t\"456\""));
    }

    #[test]
    fn create_missing_app_block() {
        let out = upsert_app_fields(SAMPLE, APPS, "999", &[("LaunchOptions", "game %command%")]).unwrap();
        assert_eq!(launch_of(&out, "999").as_deref(), Some("game %command%"));
        // existing apps still intact
        assert_eq!(launch_of(&out, "730").as_deref(), Some("game %command%"));
        assert!(keyvalues_parser::parse(&out).is_ok());
    }

    #[test]
    fn clear_to_empty() {
        let out = upsert_app_fields(SAMPLE, APPS, "730", &[("LaunchOptions", "")]).unwrap();
        assert_eq!(launch_of(&out, "730").as_deref(), Some(""));
    }

    #[test]
    fn remove_block() {
        let out = remove_app_block(SAMPLE, APPS, "570").unwrap();
        assert!(launch_of(&out, "570").is_none());
        assert!(!out.contains("\"570\""));
        // 730 untouched, doc still valid
        assert_eq!(launch_of(&out, "730").as_deref(), Some("game %command%"));
        assert!(keyvalues_parser::parse(&out).is_ok());
    }

    #[test]
    fn escaping_roundtrips() {
        let tricky = "PATH=\"a b\" game %command%";
        let out = upsert_app_fields(SAMPLE, APPS, "730", &[("LaunchOptions", tricky)]).unwrap();
        assert_eq!(launch_of(&out, "730").as_deref(), Some(tricky));
        assert!(keyvalues_parser::parse(&out).is_ok());
    }

    #[test]
    fn multi_field_upsert() {
        const MAP: &[&str] = &["Software", "Valve", "Steam", "CompatToolMapping"];
        let text = "\"InstallConfigStore\"\n{\n\t\"Software\"\n\t{\n\t\t\"Valve\"\n\t\t{\n\t\t\t\"Steam\"\n\t\t\t{\n\t\t\t\t\"CompatToolMapping\"\n\t\t\t\t{\n\t\t\t\t\t\"0\"\n\t\t\t\t\t{\n\t\t\t\t\t\t\"name\"\t\t\"proton_x\"\n\t\t\t\t\t\t\"config\"\t\t\"\"\n\t\t\t\t\t\t\"priority\"\t\t\"75\"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n";
        // new appid block with three fields
        let out = upsert_app_fields(text, MAP, "730", &[("name", "proton-cachyos-slr"), ("config", ""), ("priority", "250")]).unwrap();
        assert!(keyvalues_parser::parse(&out).is_ok());
        let vdf = keyvalues_parser::Vdf::from(keyvalues_parser::parse(&out).unwrap());
        assert_eq!(
            crate::steam::test_read(&vdf.value, &["Software", "Valve", "Steam", "CompatToolMapping", "730", "name"]).as_deref(),
            Some("proton-cachyos-slr")
        );
        // existing default mapping untouched
        assert!(out.contains("\"name\"\t\t\"proton_x\""));
    }
}
