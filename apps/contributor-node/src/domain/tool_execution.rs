use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolExecution {
    pub id: String,
    pub node_operation_id: String,
    pub template_digest: String,
    pub canonical_args: serde_json::Value,
    pub resource_budget: serde_json::Value,
    pub state: String,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_artifact_id: Option<String>,
}

impl ToolExecution {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty()
            || self.node_operation_id.is_empty()
            || self.template_digest.is_empty()
        {
            return Err("tool_execution_invalid".into());
        }
        if self.ended_at.is_some() && self.state == "running" {
            return Err("tool_execution_state_conflict".into());
        }
        Ok(())
    }
}
