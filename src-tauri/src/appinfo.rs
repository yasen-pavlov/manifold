// appinfo.rs - resolve appid -> game name from Steam's local binary cache
// (appcache/appinfo.vdf). Used to name owned/uninstalled games that have no
// appmanifest. Fully offline; no network.
//
// Format: u32 magic, u32 universe, [v29: i64 string-table offset], then app
// entries until appid 0. Each entry has a fixed header followed by a binary
// key-values blob. In v29 the KV keys are u32 indices into a trailing string
// table; in v27/v28 they are inline NUL-terminated strings.
//
// All reads are bounds-checked and return None on malformed input - this parser
// must never panic on a file we didn't write.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

const MAGIC_V27: u32 = 0x07564427;
const MAGIC_V28: u32 = 0x07564428;
const MAGIC_V29: u32 = 0x07564429;

struct Reader<'a> {
    b: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(b: &'a [u8]) -> Self {
        Reader { b, pos: 0 }
    }
    fn u8(&mut self) -> Option<u8> {
        let v = *self.b.get(self.pos)?;
        self.pos += 1;
        Some(v)
    }
    fn u32(&mut self) -> Option<u32> {
        let end = self.pos.checked_add(4)?;
        let s = self.b.get(self.pos..end)?;
        self.pos = end;
        Some(u32::from_le_bytes(s.try_into().ok()?))
    }
    fn u64(&mut self) -> Option<u64> {
        let end = self.pos.checked_add(8)?;
        let s = self.b.get(self.pos..end)?;
        self.pos = end;
        Some(u64::from_le_bytes(s.try_into().ok()?))
    }
    fn i64(&mut self) -> Option<i64> {
        self.u64().map(|v| v as i64)
    }
    fn skip(&mut self, n: usize) -> Option<()> {
        let end = self.pos.checked_add(n)?;
        if end > self.b.len() {
            return None;
        }
        self.pos = end;
        Some(())
    }
    fn cstring(&mut self) -> Option<String> {
        let start = self.pos;
        let rel = self.b.get(start..)?.iter().position(|&c| c == 0)?;
        let bytes = &self.b[start..start + rel];
        self.pos = start + rel + 1;
        Some(String::from_utf8_lossy(bytes).into_owned())
    }
}

fn parse_string_table(buf: &[u8], offset: usize) -> Option<Vec<String>> {
    let mut r = Reader { b: buf, pos: offset };
    let count = r.u32()? as usize;
    let mut out = Vec::with_capacity(count.min(1 << 20));
    for _ in 0..count {
        out.push(r.cstring()?);
    }
    Some(out)
}

fn read_key(r: &mut Reader, strtab: Option<&[String]>) -> Option<String> {
    match strtab {
        Some(tab) => {
            let idx = r.u32()? as usize;
            tab.get(idx).cloned()
        }
        None => r.cstring(),
    }
}

fn skip_value(r: &mut Reader, ty: u8, strtab: Option<&[String]>) -> Option<()> {
    match ty {
        0x00 => skip_object(r, strtab),
        0x01 => r.cstring().map(|_| ()),
        0x02 | 0x03 | 0x06 => r.u32().map(|_| ()), // int32 / float32 / color
        0x07 | 0x0A => r.u64().map(|_| ()),        // uint64 / int64
        _ => None,
    }
}

fn skip_object(r: &mut Reader, strtab: Option<&[String]>) -> Option<()> {
    loop {
        let ty = r.u8()?;
        if ty == 0x08 {
            return Some(());
        }
        let _k = read_key(r, strtab)?;
        skip_value(r, ty, strtab)?;
    }
}

/// Within an object's body, return the value of a string key named "name".
fn name_in_object(r: &mut Reader, strtab: Option<&[String]>) -> Option<String> {
    let mut found = None;
    loop {
        let ty = r.u8()?;
        if ty == 0x08 {
            break;
        }
        let key = read_key(r, strtab)?;
        if ty == 0x01 {
            let val = r.cstring()?;
            if found.is_none() && key.eq_ignore_ascii_case("name") {
                found = Some(val);
            }
        } else {
            skip_value(r, ty, strtab)?;
        }
    }
    found
}

/// Recursively search an object body for a nested "common" object and return its
/// "name". (In appinfo.vdf, common lives under a top-level "appinfo" object.)
/// Per-app parsing is bounded by the entry size, so finding-and-returning early is safe.
fn search_common(r: &mut Reader, strtab: Option<&[String]>, depth: u32) -> Option<String> {
    if depth > 12 {
        return None;
    }
    loop {
        let ty = r.u8()?;
        if ty == 0x08 {
            return None; // end of this object; not found here
        }
        let key = read_key(r, strtab)?;
        if ty == 0x00 {
            if key.eq_ignore_ascii_case("common") {
                return name_in_object(r, strtab);
            }
            if let Some(n) = search_common(r, strtab, depth + 1) {
                return Some(n);
            }
            // recursion consumed this child up to its 0x08; continue with siblings
        } else {
            skip_value(r, ty, strtab)?;
        }
    }
}

fn extract_name(buf: &[u8], start: usize, end: usize, strtab: Option<&[String]>) -> Option<String> {
    let slice = buf.get(..end)?;
    let mut r = Reader { b: slice, pos: start };
    search_common(&mut r, strtab, 0)
}

fn appinfo_paths() -> Vec<PathBuf> {
    let home = PathBuf::from(std::env::var("HOME").unwrap_or_default());
    vec![
        home.join(".steam/steam/appcache/appinfo.vdf"),
        home.join(".local/share/Steam/appcache/appinfo.vdf"),
    ]
}

/// Read one app entry, inserting its name into `out` if wanted. Returns None to
/// stop (terminator appid 0, or any malformed/truncated read).
fn read_entry(
    r: &mut Reader,
    buf: &[u8],
    wanted: &HashSet<u32>,
    v28plus: bool,
    strtab: Option<&[String]>,
    out: &mut HashMap<u32, String>,
) -> Option<()> {
    let appid = r.u32()?;
    if appid == 0 {
        return None;
    }
    let size = r.u32()? as usize;
    let next = r.pos.checked_add(size).filter(|n| *n <= buf.len())?;
    // fixed header: infoState(4) lastUpdated(4) picsToken(8) textSha1(20) changeNumber(4)
    // + binarySha1(20) on v28+
    let header = 4 + 4 + 8 + 20 + 4 + if v28plus { 20 } else { 0 };
    r.skip(header)?;
    if wanted.contains(&appid) {
        if let Some(name) = extract_name(buf, r.pos, next, strtab) {
            out.insert(appid, name);
        }
    }
    r.pos = next;
    Some(())
}

fn parse(buf: &[u8], wanted: &HashSet<u32>) -> HashMap<u32, String> {
    let mut out = HashMap::new();
    let mut r = Reader::new(buf);
    let Some(magic) = r.u32() else { return out };
    let _universe = r.u32();
    if magic != MAGIC_V27 && magic != MAGIC_V28 && magic != MAGIC_V29 {
        return out;
    }
    let v28plus = magic == MAGIC_V28 || magic == MAGIC_V29;
    let strtab = if magic == MAGIC_V29 {
        match r.i64() {
            Some(off) if off >= 0 => parse_string_table(buf, off as usize),
            _ => return out,
        }
    } else {
        None
    };
    let strtab_ref = strtab.as_deref();

    while read_entry(&mut r, buf, wanted, v28plus, strtab_ref, &mut out).is_some() {
        if !wanted.is_empty() && out.len() == wanted.len() {
            break;
        }
    }
    out
}

/// Resolve names for the requested appids from the local appinfo.vdf cache.
/// Returns only the ones found; missing/unparseable entries are simply absent.
pub fn resolve_names(appids: &HashSet<u32>) -> HashMap<u32, String> {
    if appids.is_empty() {
        return HashMap::new();
    }
    for path in appinfo_paths() {
        if let Ok(buf) = fs::read(&path) {
            let names = parse(&buf, appids);
            if !names.is_empty() {
                return names;
            }
        }
    }
    HashMap::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn le32(v: u32) -> [u8; 4] {
        v.to_le_bytes()
    }

    /// Build a synthetic v29 appinfo.vdf with one app whose nested `common` object
    /// holds a `name`. Exercises the string table, recursion, and the skip paths.
    fn build_v29(appid: u32, name: &str) -> Vec<u8> {
        // string table indices: common=0, name=1, meta=2, foo=3, big=4
        let mut kv = Vec::new();
        // top-level non-common object -> search_common recurses past it
        kv.push(0x00);
        kv.extend(le32(2)); // "meta"
        kv.push(0x02);
        kv.extend(le32(3)); // "foo" int32
        kv.extend(le32(9));
        kv.push(0x08); // end meta
                       // common object
        kv.push(0x00);
        kv.extend(le32(0)); // "common"
                            // nested object inside common -> name_in_object hits skip_object
        kv.push(0x00);
        kv.extend(le32(2)); // "meta"
        kv.push(0x07);
        kv.extend(le32(4)); // "big" uint64
        kv.extend(123u64.to_le_bytes());
        kv.push(0x08); // end nested
                       // the name we want
        kv.push(0x01);
        kv.extend(le32(1)); // "name" string
        kv.extend(name.as_bytes());
        kv.push(0);
        kv.push(0x08); // end common
        kv.push(0x08); // end root

        let mut entry = vec![0u8; 60]; // infoState+lastUpdated+token+textSha1+change+binarySha1
        entry.extend(&kv);

        let mut buf = Vec::new();
        buf.extend(le32(MAGIC_V29));
        buf.extend(le32(1)); // universe
        let strtab_off = 16 + 4 + 4 + entry.len() + 4;
        buf.extend((strtab_off as i64).to_le_bytes());
        buf.extend(le32(appid));
        buf.extend(le32(entry.len() as u32));
        buf.extend(&entry);
        buf.extend(le32(0)); // appid 0 terminator
        buf.extend(le32(5)); // string table count
        for s in ["common", "name", "meta", "foo", "big"] {
            buf.extend(s.as_bytes());
            buf.push(0);
        }
        buf
    }

    /// Build a synthetic v27 appinfo.vdf (inline string keys, no string table).
    fn build_v27(appid: u32, name: &str) -> Vec<u8> {
        let mut kv = Vec::new();
        kv.push(0x00);
        kv.extend(b"common");
        kv.push(0);
        kv.push(0x01);
        kv.extend(b"name");
        kv.push(0);
        kv.extend(name.as_bytes());
        kv.push(0);
        kv.push(0x08);
        kv.push(0x08);

        let mut entry = vec![0u8; 40]; // no binarySha1 on v27
        entry.extend(&kv);

        let mut buf = Vec::new();
        buf.extend(le32(MAGIC_V27));
        buf.extend(le32(1));
        buf.extend(le32(appid));
        buf.extend(le32(entry.len() as u32));
        buf.extend(&entry);
        buf.extend(le32(0));
        buf
    }

    #[test]
    fn parses_v29_with_string_table() {
        let buf = build_v29(4032340, "1492: A New World Demo");
        let want: HashSet<u32> = [4032340u32].into_iter().collect();
        let got = parse(&buf, &want);
        assert_eq!(got.get(&4032340).map(|s| s.as_str()), Some("1492: A New World Demo"));
    }

    #[test]
    fn parses_v27_inline_keys() {
        let buf = build_v27(281990, "Stellaris");
        let want: HashSet<u32> = [281990u32].into_iter().collect();
        let got = parse(&buf, &want);
        assert_eq!(got.get(&281990).map(|s| s.as_str()), Some("Stellaris"));
    }

    #[test]
    fn ignores_unwanted_appids() {
        let buf = build_v29(111, "Game");
        let want: HashSet<u32> = [999u32].into_iter().collect();
        assert!(parse(&buf, &want).is_empty());
    }

    #[test]
    fn rejects_bad_magic_and_truncation_without_panicking() {
        assert!(parse(&[1, 2, 3, 4, 5, 6, 7, 8], &HashSet::new()).is_empty());
        let buf = build_v29(111, "Game");
        assert!(parse(&buf[..10], &[111u32].into_iter().collect()).is_empty());
        assert!(parse(&[], &HashSet::new()).is_empty());
    }

    #[test]
    fn resolve_names_empty_input_is_empty() {
        assert!(resolve_names(&HashSet::new()).is_empty());
    }

    #[test]
    fn resolve_names_reads_a_temp_cache() {
        let _g = crate::TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let prev = std::env::var("HOME").ok();
        let dir = std::env::temp_dir().join(format!("manifold_ai_{}", std::process::id()));
        let cache = dir.join(".steam/steam/appcache");
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("appinfo.vdf"), build_v29(555, "Cache Game")).unwrap();
        std::env::set_var("HOME", &dir);

        let got = resolve_names(&[555u32].into_iter().collect());
        assert_eq!(got.get(&555).map(|s| s.as_str()), Some("Cache Game"));

        match prev {
            Some(h) => std::env::set_var("HOME", h),
            None => std::env::remove_var("HOME"),
        }
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    #[ignore = "reads the real appinfo.vdf; run with --ignored --nocapture"]
    fn resolves_real_names() {
        // 4032340 = "1492: A New World Demo" (owned/played, not installed)
        // 281990  = Stellaris (installed) - sanity that installed apps resolve too
        let want: HashSet<u32> = [4032340u32, 281990].into_iter().collect();
        let names = resolve_names(&want);
        eprintln!("resolved: {names:?}");
        assert_eq!(names.get(&4032340).map(|s| s.as_str()), Some("1492: A New World Demo"));
        assert_eq!(names.get(&281990).map(|s| s.as_str()), Some("Stellaris"));
    }
}
