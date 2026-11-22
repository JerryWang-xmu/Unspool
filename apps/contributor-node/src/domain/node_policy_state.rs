use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePolicyState {
    pub node_id: String,
    pub state_revision: u64,
    pub beta_enabled: bool,
    pub pause_state: String,
    pub quarantine_state: String,
    pub revocation_tombstones: Vec<String>,
    pub denied_intent_digests: Vec<String>,
    pub budget_watermarks: BTreeMap<String, u64>,
}

impl Default for NodePolicyState {
    fn default() -> Self {
        Self {
            node_id: String::new(),
            state_revision: 0,
            beta_enabled: false,
            pause_state: "active".into(),
            quarantine_state: "none".into(),
            revocation_tombstones: Vec::new(),
            denied_intent_digests: Vec::new(),
            budget_watermarks: BTreeMap::new(),
        }
    }
}
