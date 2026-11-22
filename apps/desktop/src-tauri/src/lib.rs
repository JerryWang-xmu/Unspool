use serde::{Deserialize, Serialize};
use std::{fs, net::Ipv4Addr, net::Ipv6Addr, path::PathBuf};
use url::{Host, Url};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppEnvironment {
    app_version: &'static str,
    platform: &'static str,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunnerConnection {
    schema_version: u64,
    runner_url: String,
    token: String,
}

#[tauri::command]
fn app_environment() -> AppEnvironment {
    AppEnvironment {
        app_version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
    }
}

fn runner_connection_path() -> Result<PathBuf, String> {
    if let Some(path) =
        std::env::var_os("UNSPOOL_RUNNER_CONNECTION_FILE").filter(|value| !value.is_empty())
    {
        return Ok(PathBuf::from(path));
    }
    let local_app_data = std::env::var_os("LOCALAPPDATA").ok_or_else(|| {
        "LOCALAPPDATA is unavailable; cannot locate Runner connection.".to_owned()
    })?;
    Ok(PathBuf::from(local_app_data)
        .join("Unspool")
        .join("runner-connection.json"))
}

fn has_explicit_port(value: &str) -> bool {
    let Some((_, after_scheme)) = value.split_once("://") else {
        return false;
    };
    let authority = after_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();
    let port = if authority.starts_with('[') {
        authority.rsplit_once("]:").map(|(_, port)| port)
    } else {
        authority.rsplit_once(':').map(|(_, port)| port)
    };
    port.is_some_and(|port| !port.is_empty() && port.bytes().all(|byte| byte.is_ascii_digit()))
}

fn valid_loopback_runner_url(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    let loopback = matches!(
        url.host(),
        Some(Host::Domain("localhost"))
            | Some(Host::Ipv4(Ipv4Addr::LOCALHOST))
            | Some(Host::Ipv6(Ipv6Addr::LOCALHOST))
    );
    url.scheme() == "http"
        && loopback
        && url.username().is_empty()
        && url.password().is_none()
        && has_explicit_port(value)
        && matches!(url.port_or_known_default(), Some(port) if port > 0)
        && url.path() == "/v1"
        && url.query().is_none()
        && url.fragment().is_none()
}

#[tauri::command]
fn runner_connection() -> Result<RunnerConnection, String> {
    let path = runner_connection_path()?;
    let bytes = fs::read(&path).map_err(|error| {
        format!(
            "Runner connection is unavailable at {}: {error}. Start the local Runner first.",
            path.display()
        )
    })?;
    let connection: RunnerConnection = serde_json::from_slice(&bytes)
        .map_err(|_| "Runner connection is not valid JSON.".to_owned())?;
    if connection.schema_version != 1 {
        return Err("Runner connection uses an unsupported schema version.".to_owned());
    }
    if !valid_loopback_runner_url(&connection.runner_url) {
        return Err("Runner connection must use an HTTP loopback URL ending in /v1.".to_owned());
    }
    if connection.token.trim().len() < 32 {
        return Err("Runner connection token is missing or too short.".to_owned());
    }
    Ok(connection)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_environment, runner_connection])
        .run(tauri::generate_context!())
        .expect("failed to run the Unspool desktop shell");
}

#[cfg(test)]
mod tests {
    use super::valid_loopback_runner_url;

    #[test]
    fn accepts_only_loopback_v1_runner_urls() {
        assert!(valid_loopback_runner_url("http://127.0.0.1:8080/v1"));
        assert!(valid_loopback_runner_url("http://127.0.0.1:80/v1"));
        assert!(valid_loopback_runner_url("http://localhost:80/v1"));
        assert!(valid_loopback_runner_url("http://localhost:9000/v1"));
        assert!(valid_loopback_runner_url("http://[::1]:8080/v1"));
        assert!(!valid_loopback_runner_url("https://example.com/v1"));
        assert!(!valid_loopback_runner_url("http://127.0.0.1:8080"));
        assert!(!valid_loopback_runner_url("http://127.0.0.1/v1"));
        assert!(!valid_loopback_runner_url("http://192.168.1.10:8080/v1"));
        assert!(!valid_loopback_runner_url(
            "http://127.0.0.1:8080@example.com/v1"
        ));
        assert!(!valid_loopback_runner_url("http://user@127.0.0.1:8080/v1"));
        assert!(!valid_loopback_runner_url("http://127.0.0.1:8080/v1?x=1"));
        assert!(!valid_loopback_runner_url("http://127.0.0.1:8080/v1/"));
        assert!(!valid_loopback_runner_url("http://127.0.0.2:8080/v1"));
        assert!(!valid_loopback_runner_url("http://127.0.0.1:0/v1"));
    }
}
