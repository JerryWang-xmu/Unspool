pub fn effective_level(
    global: &str,
    team: Option<&str>,
    workspace: Option<&str>,
    node: Option<&str>,
) -> String {
    let rank = |level: &str| match level {
        "disabled" => 0,
        "snapshot" => 1,
        "snapshot_tools" => 2,
        "snapshot_tools_patch" => 3,
        _ => 0,
    };
    let mut effective = global.to_string();
    for candidate in [team, workspace, node].into_iter().flatten() {
        if rank(candidate) < rank(&effective) {
            effective = candidate.to_string();
        }
    }
    effective
}

pub fn upgrade_does_not_widen(current: &str, requested: &str) -> String {
    let rank = |level: &str| match level {
        "disabled" => 0,
        "snapshot" => 1,
        "snapshot_tools" => 2,
        "snapshot_tools_patch" => 3,
        _ => 0,
    };
    if rank(requested) < rank(current) {
        requested.to_string()
    } else {
        current.to_string()
    }
}
