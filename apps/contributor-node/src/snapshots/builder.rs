pub fn validate_logical_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path.starts_with('/') || path.starts_with('\\') || path.contains('\0') {
        return Err("snapshot_path_denied".into());
    }
    if path
        .replace('\\', "/")
        .split('/')
        .any(|segment| segment == ".." || segment.is_empty())
    {
        return Err("snapshot_path_denied".into());
    }
    Ok(())
}

pub fn reject_non_regular_file(
    is_symlink: bool,
    is_file: bool,
    cross_mount: bool,
    unconfirmed_hardlink: bool,
) -> Result<(), String> {
    if is_symlink || !is_file {
        return Err("snapshot_non_regular_file".into());
    }
    if cross_mount {
        return Err("snapshot_cross_mount_denied".into());
    }
    if unconfirmed_hardlink {
        return Err("snapshot_unconfirmed_hardlink_denied".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_traversal() {
        assert!(validate_logical_path("../secret").is_err());
    }
    #[test]
    fn accepts_a_relative_file() {
        assert!(validate_logical_path("in/brief.md").is_ok());
    }
}
