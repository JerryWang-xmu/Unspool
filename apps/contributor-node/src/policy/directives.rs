#[derive(Debug, Clone, PartialEq)]
pub enum DirectiveState {
    Active,
    Paused,
    Revoked,
    Quarantined,
}

pub fn can_use(state: &DirectiveState) -> bool {
    matches!(state, DirectiveState::Active)
}

pub fn unquarantine(local_owner: bool) -> Result<DirectiveState, String> {
    if !local_owner {
        return Err("unquarantine_local_only".into());
    }
    Ok(DirectiveState::Active)
}
