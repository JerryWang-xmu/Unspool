pub fn reduce_operations<'a>(
    current: &'a [String],
    requested: &'a [String],
) -> Result<Vec<String>, String> {
    if !requested
        .iter()
        .all(|operation| current.contains(operation))
    {
        return Err("grant_expansion_denied".into());
    }
    Ok(requested.to_vec())
}

pub fn assert_terminal(state: &str) -> bool {
    matches!(state, "expired" | "revoked" | "rejected")
}
