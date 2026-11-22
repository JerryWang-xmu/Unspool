use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributorNode {
    pub id: String,
    pub owner_id: String,
    pub team_id: String,
    pub name: String,
    pub public_key: String,
    pub owner_approval_public_key: String,
    pub platform: String,
    pub agent_version: String,
    pub state: String,
    pub support_state: String,
    pub security_posture: String,
    pub capabilities: Vec<String>,
    pub policy_revision: u64,
    pub last_heartbeat_at: String,
}

impl ContributorNode {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty()
            || self.owner_id.is_empty()
            || self.public_key.is_empty()
            || self.owner_approval_public_key.is_empty()
        {
            return Err("contributor_node_identity_invalid".into());
        }
        if self.policy_revision == 0 {
            return Err("contributor_node_policy_revision_invalid".into());
        }
        Ok(())
    }
}
