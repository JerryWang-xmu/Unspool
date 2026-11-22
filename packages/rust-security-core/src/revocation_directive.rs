use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevocationDirective {
    pub id: String,
    pub target_type: String,
    pub target_id: String,
    pub state_revision: u64,
    pub effective_at: String,
    pub reason: String,
    pub scope: String,
    pub owner_or_security_signature: String,
}

impl RevocationDirective {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty()
            || self.target_id.is_empty()
            || self.owner_or_security_signature.is_empty()
        {
            return Err("revocation_directive_invalid".into());
        }
        if !["node", "grant", "resource", "operation"].contains(&self.target_type.as_str()) {
            return Err("revocation_target_invalid".into());
        }
        if self.state_revision == 0 {
            return Err("revocation_revision_invalid".into());
        }
        if self.reason.trim().is_empty() {
            return Err("revocation_reason_required".into());
        }
        Ok(())
    }

    pub fn precedes(&self, other: &Self) -> bool {
        self.state_revision > other.state_revision
            || (self.state_revision == other.state_revision
                && self.effective_at >= other.effective_at)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directive(revision: u64) -> RevocationDirective {
        RevocationDirective {
            id: "revoke".into(),
            target_type: "node".into(),
            target_id: "node".into(),
            state_revision: revision,
            effective_at: "2026-01-01T00:00:00.000Z".into(),
            reason: "compromise".into(),
            scope: "local".into(),
            owner_or_security_signature: "signature".into(),
        }
    }

    #[test]
    fn validates_and_orders_by_revision() {
        assert!(directive(1).validate().is_ok());
        assert!(directive(2).precedes(&directive(1)));
        assert_eq!(
            directive(0).validate().unwrap_err(),
            "revocation_revision_invalid"
        );
    }
}
