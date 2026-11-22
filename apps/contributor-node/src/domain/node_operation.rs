use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeOperation {
    pub id: String,
    pub request_id: String,
    pub node_id: String,
    pub grant_id: String,
    pub execution_id: String,
    pub kind: String,
    pub state: String,
    pub authorized_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dispatched_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unknown_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_digest: Option<String>,
}

impl NodeOperation {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() || self.request_id.is_empty() || self.execution_id.is_empty() {
            return Err("node_operation_identity_invalid".into());
        }
        if self.completed_at.is_some() && self.unknown_reason.is_some() {
            return Err("node_operation_outcome_conflict".into());
        }
        Ok(())
    }
}
