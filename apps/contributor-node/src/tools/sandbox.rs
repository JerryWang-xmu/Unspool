use std::collections::BTreeMap;

pub fn sandbox_environment() -> BTreeMap<String, String> {
    BTreeMap::new()
}

pub fn assert_no_shell_or_network(
    network_policy: &str,
    extra_top_level_fields: usize,
) -> Result<(), String> {
    if network_policy != "disabled" {
        return Err("network_denied".into());
    }
    if extra_top_level_fields > 0 {
        return Err("invalid_request".into());
    }
    Ok(())
}
