use std::collections::HashMap;
use std::fs;
use std::path::Path;

const OAUTH_ENV_KEYS: [&str; 4] = [
    "RAPIDCAL_GOOGLE_CLIENT_ID",
    "RAPIDCAL_GOOGLE_CLIENT_SECRET",
    "RAPIDCAL_MS_CLIENT_ID",
    "RAPIDCAL_MS_TENANT_ID",
];

fn parse_dotenv_file(path: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(contents) = fs::read_to_string(path) else {
        return map;
    };
    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line).trim();
        if let Some((k, v)) = line.split_once('=') {
            let key = k.trim();
            let mut val = v.trim();
            if (val.starts_with('"') && val.ends_with('"') && val.len() >= 2)
                || (val.starts_with('\'') && val.ends_with('\'') && val.len() >= 2)
            {
                val = &val[1..val.len() - 1];
            }
            map.insert(key.to_string(), val.trim().to_string());
        }
    }
    map
}

fn main() {
    println!("cargo:rerun-if-changed=../.env");
    println!("cargo:rerun-if-changed=.env");

    let mut dotenv_vars = parse_dotenv_file(Path::new("../.env"));
    for (k, v) in parse_dotenv_file(Path::new(".env")) {
        dotenv_vars.entry(k).or_insert(v);
    }

    for key in OAUTH_ENV_KEYS {
        println!("cargo:rerun-if-env-changed={}", key);
        let resolved = std::env::var(key)
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .or_else(|| dotenv_vars.get(key).cloned().filter(|v| !v.is_empty()));

        if let Some(val) = resolved {
            println!("cargo:rustc-env={}={}", key, val);
        }
    }

    tauri_build::build()
}
