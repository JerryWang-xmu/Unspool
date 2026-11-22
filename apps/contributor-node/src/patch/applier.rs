pub struct PatchFileResult {
    pub path: String,
    pub outcome: String,
    pub result_digest: Option<String>,
}

pub fn apply(
    changes: &[(String, String, String)],
    current_digests: &[(String, String)],
    independent_grant: bool,
) -> Result<(String, Vec<PatchFileResult>, usize), String> {
    if !independent_grant {
        return Err("independent_grant_required".into());
    }
    let mut results = Vec::new();
    let mut writes = 0;
    let mut conflicts = 0;
    for (path, base, replacement) in changes {
        let matches = current_digests
            .iter()
            .any(|(candidate, digest)| candidate == path && digest == base);
        if matches {
            writes += 1;
            results.push(PatchFileResult {
                path: path.clone(),
                outcome: "applied".into(),
                result_digest: Some(replacement.clone()),
            });
        } else {
            conflicts += 1;
            results.push(PatchFileResult {
                path: path.clone(),
                outcome: "conflict".into(),
                result_digest: None,
            });
        }
    }
    let state = if conflicts == 0 {
        "applied"
    } else if writes == 0 {
        "conflict"
    } else {
        "partially_applied"
    };
    Ok((state.to_string(), results, writes))
}
