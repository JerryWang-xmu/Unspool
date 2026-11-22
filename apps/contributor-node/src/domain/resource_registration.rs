use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRegistration {
    pub id: String,
    pub node_id: String,
    pub kind: String,
    pub local_alias: String,
    pub display_metadata: serde_json::Value,
    pub allowed_operations: Vec<String>,
    pub template_digest: Option<String>,
    pub registered_at: String,
}

impl ResourceRegistration {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() || self.node_id.is_empty() || self.local_alias.trim().is_empty() {
            return Err("resource_registration_invalid".into());
        }
        if self.allowed_operations.is_empty() {
            return Err("resource_operations_empty".into());
        }
        Ok(())
    }
}
