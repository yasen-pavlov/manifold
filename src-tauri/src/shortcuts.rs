// shortcuts.rs - read and edit Steam's non-Steam-game shortcuts (shortcuts.vdf).
//
// shortcuts.vdf lives at userdata/<id>/config/shortcuts.vdf and holds the user's
// "Add a Non-Steam Game" entries. Unlike real Steam games, a shortcut's launch
// options live HERE (the per-entry "LaunchOptions" field), not in localconfig.vdf -
// so this file is both the read source and the write target for non-Steam launch
// options. Compat tools still go through config.vdf's CompatToolMapping, keyed by
// the shortcut's appid, so that path needs no special handling.
//
// Binary format (type-tagged, no length prefixes and no offset/string tables):
//   0x00 <key\0> <children...> 0x08   nested map
//   0x01 <key\0> <value\0>            string
//   0x02 <key\0> <i32-le>            int32
//   0x08                             end of the current map
// The whole file is one implicit root map holding a single "shortcuts" map; each of
// its children is one entry keyed by a decimal index ("0", "1", ...). Steam treats
// keys case-insensitively, so we match them that way (e.g. "appname" vs "AppName").
//
// All reads are bounds-checked and bail (empty list / None) on malformed input - this
// parser must never panic on a file we did not write. Because the format carries no
// offsets, a length-changing edit to one value is safe; we still re-parse and verify
// before the caller commits the bytes to disk.

use std::ops::Range;

/// One non-Steam shortcut, reduced to the fields Manifold manages.
pub struct Shortcut {
    /// The shortcut appid as Steam stores it (the int32 reinterpreted as u32). This
    /// is the key used in config.vdf's CompatToolMapping, and is always >= 2^31.
    pub appid: u32,
    pub name: String,
    pub launch_options: String,
}

// Parsed value, retaining byte spans so edits can splice the original buffer.
enum Node {
    Str { value: String, value_span: Range<usize> },
    Int(i32),
    Map(MapNode),
}

struct MapNode {
    entries: Vec<(String, Node)>,
    /// Byte position of this map's closing 0x08 (an insertion point for new fields).
    end_pos: usize,
}

impl MapNode {
    fn get(&self, key: &str) -> Option<&Node> {
        self.entries
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, n)| n)
    }
}

struct Reader<'a> {
    b: &'a [u8],
    pos: usize,
}

impl Reader<'_> {
    fn u8(&mut self) -> Option<u8> {
        let v = *self.b.get(self.pos)?;
        self.pos += 1;
        Some(v)
    }
    fn i32(&mut self) -> Option<i32> {
        let end = self.pos.checked_add(4)?;
        let s = self.b.get(self.pos..end)?;
        self.pos = end;
        Some(i32::from_le_bytes(s.try_into().ok()?))
    }
    /// A NUL-terminated string. Returns the (lossy) text and the byte span of the
    /// value excluding the terminator, then advances past the terminator.
    fn cstr(&mut self) -> Option<(String, Range<usize>)> {
        let start = self.pos;
        let rel = self.b.get(start..)?.iter().position(|&c| c == 0)?;
        let end = start + rel;
        let text = String::from_utf8_lossy(&self.b[start..end]).into_owned();
        self.pos = end + 1;
        Some((text, start..end))
    }
}

// Guards against unbounded recursion on a crafted file; real shortcuts.vdf nests at
// most root -> shortcuts -> entry -> tags (depth 4).
const MAX_DEPTH: usize = 32;

fn parse_map(r: &mut Reader, depth: usize) -> Option<MapNode> {
    if depth > MAX_DEPTH {
        return None;
    }
    let mut entries = Vec::new();
    loop {
        let close_pos = r.pos;
        let t = r.u8()?;
        if t == 0x08 {
            return Some(MapNode { entries, end_pos: close_pos });
        }
        let (key, _) = r.cstr()?;
        let node = match t {
            0x00 => Node::Map(parse_map(r, depth + 1)?),
            0x01 => {
                let (value, value_span) = r.cstr()?;
                Node::Str { value, value_span }
            }
            0x02 => Node::Int(r.i32()?),
            _ => return None, // unknown type byte -> treat the whole file as unparseable
        };
        entries.push((key, node));
    }
}

fn parse_root(bytes: &[u8]) -> Option<MapNode> {
    parse_map(&mut Reader { b: bytes, pos: 0 }, 0)
}

fn read_shortcut(entry: &MapNode) -> Option<Shortcut> {
    let appid = match entry.get("appid")? {
        Node::Int(n) => *n as u32,
        _ => return None,
    };
    let name = match entry.get("appname") {
        Some(Node::Str { value, .. }) => value.clone(),
        _ => String::new(),
    };
    let launch_options = match entry.get("LaunchOptions") {
        Some(Node::Str { value, .. }) => value.clone(),
        _ => String::new(),
    };
    Some(Shortcut { appid, name, launch_options })
}

/// Parse every shortcut entry. Returns an empty list on a missing or malformed file.
pub fn parse(bytes: &[u8]) -> Vec<Shortcut> {
    let Some(root) = parse_root(bytes) else { return Vec::new() };
    let Some(Node::Map(scs)) = root.get("shortcuts") else { return Vec::new() };
    scs.entries
        .iter()
        .filter_map(|(_, node)| match node {
            Node::Map(entry) => read_shortcut(entry),
            _ => None,
        })
        .collect()
}

/// Return a copy of `bytes` with the LaunchOptions of the shortcut whose appid is
/// `target_appid` set to `value`, inserting the field if the entry lacks one.
///
/// Errors if the file does not parse or holds no shortcut with that appid - the
/// caller treats either as a hard failure and writes nothing.
pub fn set_launch_options(bytes: &[u8], target_appid: u32, value: &str) -> Result<Vec<u8>, String> {
    let root = parse_root(bytes).ok_or("shortcuts.vdf: could not parse")?;
    let scs = match root.get("shortcuts") {
        Some(Node::Map(m)) => m,
        _ => return Err("shortcuts.vdf: no shortcuts map".into()),
    };

    let entry = scs
        .entries
        .iter()
        .find_map(|(_, node)| match node {
            Node::Map(e) => match e.get("appid") {
                Some(Node::Int(n)) if *n as u32 == target_appid => Some(e),
                _ => None,
            },
            _ => None,
        })
        .ok_or_else(|| format!("shortcuts.vdf: no shortcut with appid {target_appid}"))?;

    let mut out = Vec::with_capacity(bytes.len() + value.len() + 16);
    match entry.get("LaunchOptions") {
        Some(Node::Str { value_span, .. }) => {
            // Splice the new value over the old; the trailing NUL at value_span.end stays.
            out.extend_from_slice(&bytes[..value_span.start]);
            out.extend_from_slice(value.as_bytes());
            out.extend_from_slice(&bytes[value_span.end..]);
        }
        Some(_) => return Err("shortcuts.vdf: LaunchOptions is not a string field".into()),
        None => {
            // Insert a fresh string field just before the entry's closing 0x08.
            let at = entry.end_pos;
            out.extend_from_slice(&bytes[..at]);
            out.push(0x01);
            out.extend_from_slice(b"LaunchOptions\0");
            out.extend_from_slice(value.as_bytes());
            out.push(0x00);
            out.extend_from_slice(&bytes[at..]);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Build a minimal but realistic shortcuts.vdf. Each entry carries appid + appname
    // (+ optional LaunchOptions) and an empty "tags" sub-map, so the parser's nested-map
    // recursion and the "insert before closing 0x08" path are both exercised.
    fn build(entries: &[(u32, &str, Option<&str>)]) -> Vec<u8> {
        let mut b = Vec::new();
        let str_field = |b: &mut Vec<u8>, key: &str, val: &str| {
            b.push(0x01);
            b.extend_from_slice(key.as_bytes());
            b.push(0x00);
            b.extend_from_slice(val.as_bytes());
            b.push(0x00);
        };
        b.push(0x00);
        b.extend_from_slice(b"shortcuts\0");
        for (i, (appid, name, launch)) in entries.iter().enumerate() {
            b.push(0x00);
            b.extend_from_slice(i.to_string().as_bytes());
            b.push(0x00);
            b.push(0x02);
            b.extend_from_slice(b"appid\0");
            b.extend_from_slice(&(*appid as i32).to_le_bytes());
            str_field(&mut b, "appname", name);
            if let Some(l) = launch {
                str_field(&mut b, "LaunchOptions", l);
            }
            b.push(0x00); // tags map
            b.extend_from_slice(b"tags\0");
            b.push(0x08); // empty
            b.push(0x08); // end entry
        }
        b.push(0x08); // end shortcuts
        b.push(0x08); // end root
        b
    }

    #[test]
    fn parses_appid_name_and_launch() {
        let bytes = build(&[
            (2_338_049_609, "DoomRunner", None),
            (2_716_050_835, "Thief Gold", Some("gamescope_proton %command%")),
        ]);
        let scs = parse(&bytes);
        assert_eq!(scs.len(), 2);
        assert_eq!(scs[0].appid, 2_338_049_609);
        assert_eq!(scs[0].name, "DoomRunner");
        assert_eq!(scs[0].launch_options, "");
        assert_eq!(scs[1].name, "Thief Gold");
        assert_eq!(scs[1].launch_options, "gamescope_proton %command%");
    }

    #[test]
    fn replaces_existing_launch_options() {
        let bytes = build(&[(2_716_050_835, "Thief Gold", Some("old %command%"))]);
        let out = set_launch_options(&bytes, 2_716_050_835, "mangohud %command%").unwrap();
        let scs = parse(&out);
        assert_eq!(scs[0].launch_options, "mangohud %command%");
        // every other field survives the splice
        assert_eq!(scs[0].appid, 2_716_050_835);
        assert_eq!(scs[0].name, "Thief Gold");
    }

    #[test]
    fn clearing_to_empty_works() {
        let bytes = build(&[(7, "X", Some("gamescope %command%"))]);
        let out = set_launch_options(&bytes, 7, "").unwrap();
        assert_eq!(parse(&out)[0].launch_options, "");
    }

    #[test]
    fn inserts_launch_options_when_absent() {
        let bytes = build(&[(2_338_049_609, "DoomRunner", None)]);
        let out = set_launch_options(&bytes, 2_338_049_609, "mangohud %command%").unwrap();
        let scs = parse(&out);
        assert_eq!(scs.len(), 1);
        assert_eq!(scs[0].appid, 2_338_049_609);
        assert_eq!(scs[0].name, "DoomRunner");
        assert_eq!(scs[0].launch_options, "mangohud %command%");
    }

    #[test]
    fn edits_only_the_targeted_entry() {
        let bytes = build(&[
            (10, "A", Some("a %command%")),
            (20, "B", Some("b %command%")),
        ]);
        let out = set_launch_options(&bytes, 20, "NEW %command%").unwrap();
        let scs = parse(&out);
        assert_eq!(scs[0].launch_options, "a %command%");
        assert_eq!(scs[1].launch_options, "NEW %command%");
    }

    #[test]
    fn unknown_appid_is_an_error() {
        let bytes = build(&[(10, "A", None)]);
        assert!(set_launch_options(&bytes, 999, "x %command%").is_err());
    }

    #[test]
    fn malformed_input_never_panics() {
        assert!(parse(&[]).is_empty());
        assert!(parse(&[0x00, 0x01, 0x02]).is_empty());
        assert!(parse(b"\x00shortcuts\x00\x09bad").is_empty()); // unknown type byte 0x09
        assert!(set_launch_options(&[], 1, "x").is_err());
    }
}
