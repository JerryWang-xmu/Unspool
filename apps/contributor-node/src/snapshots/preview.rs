pub fn expose_logical_path(visibility: &str, logical_path: &str) -> Option<String> {
    match visibility {
        "authorized_recipients" => Some(logical_path.to_string()),
        "opaque_only" | "owner_only" => None,
        _ => None,
    }
}
